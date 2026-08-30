use std::{
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use rand::{rngs::OsRng, RngCore};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::Emitter;
use url::Url;

const AUTH_ENDPOINT: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT: &str = "https://oauth2.googleapis.com/token";
const USERINFO_ENDPOINT: &str = "https://www.googleapis.com/oauth2/v3/userinfo";
const REVOKE_ENDPOINT: &str = "https://oauth2.googleapis.com/revoke";
const DRIVE_SCOPE: &str = "openid email profile https://www.googleapis.com/auth/drive.appdata";
const CALLBACK_TIMEOUT: Duration = Duration::from_secs(180);
const KEYRING_SERVICE: &str = "com.nabilrn.focuscanvas.google-oauth";
const KEYRING_USER: &str = "google-drive-refresh-token";
const AUTH_URL_EVENT: &str = "focuscanvas-google-oauth-url";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GoogleAccount {
    email: String,
    name: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GoogleAuthConnection {
    access_token: String,
    expires_at: u64,
    account: GoogleAccount,
}

#[derive(Debug, Deserialize)]
struct GoogleTokenPayload {
    access_token: Option<String>,
    expires_in: Option<u64>,
    refresh_token: Option<String>,
    error: Option<String>,
    error_description: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GoogleUserInfo {
    email: Option<String>,
    name: Option<String>,
}

fn random_urlsafe(byte_len: usize) -> String {
    let mut bytes = vec![0_u8; byte_len];
    OsRng.fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

fn pkce_challenge(verifier: &str) -> String {
    let digest = Sha256::digest(verifier.as_bytes());
    URL_SAFE_NO_PAD.encode(digest)
}

fn unix_time_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn browser_response(stream: &mut TcpStream, success: bool) {
    let (title, message) = if success {
        (
            "FocusCanvas connected",
            "Google Drive is connected. You can close this tab and return to FocusCanvas.",
        )
    } else {
        (
            "FocusCanvas authorization failed",
            "The Google authorization request was not completed. Return to FocusCanvas for details.",
        )
    };

    let body = format!(
        "<!doctype html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>{title}</title><style>body{{font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:72px auto;padding:0 24px;color:#111}}h1{{font-size:24px}}p{{line-height:1.6;color:#555}}</style></head><body><h1>{title}</h1><p>{message}</p></body></html>"
    );
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n{}",
        body.as_bytes().len(),
        body
    );
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();
}

fn wait_for_authorization_code(
    listener: TcpListener,
    expected_state: String,
) -> Result<String, String> {
    listener
        .set_nonblocking(true)
        .map_err(|error| format!("Could not configure the OAuth callback listener: {error}"))?;

    let deadline = Instant::now() + CALLBACK_TIMEOUT;
    while Instant::now() < deadline {
        match listener.accept() {
            Ok((mut stream, _)) => {
                let mut buffer = [0_u8; 16 * 1024];
                let bytes_read = stream
                    .read(&mut buffer)
                    .map_err(|error| format!("Could not read the OAuth callback: {error}"))?;
                if bytes_read == 0 {
                    continue;
                }

                let request = String::from_utf8_lossy(&buffer[..bytes_read]);
                let request_target = request
                    .lines()
                    .next()
                    .and_then(|line| line.split_whitespace().nth(1))
                    .unwrap_or("/");
                let callback_url = match Url::parse(&format!("http://127.0.0.1{request_target}")) {
                    Ok(url) => url,
                    Err(_) => {
                        browser_response(&mut stream, false);
                        continue;
                    }
                };

                let mut code = None;
                let mut returned_state = None;
                let mut oauth_error = None;
                let mut oauth_error_description = None;

                for (key, value) in callback_url.query_pairs() {
                    match key.as_ref() {
                        "code" => code = Some(value.into_owned()),
                        "state" => returned_state = Some(value.into_owned()),
                        "error" => oauth_error = Some(value.into_owned()),
                        "error_description" => {
                            oauth_error_description = Some(value.into_owned())
                        }
                        _ => {}
                    }
                }

                if code.is_none() && oauth_error.is_none() {
                    browser_response(&mut stream, false);
                    continue;
                }

                if returned_state.as_deref() != Some(expected_state.as_str()) {
                    browser_response(&mut stream, false);
                    return Err("Google OAuth returned an invalid state value.".to_string());
                }

                if let Some(error) = oauth_error {
                    browser_response(&mut stream, false);
                    let description = oauth_error_description.unwrap_or(error);
                    return Err(format!("Google authorization was not completed: {description}"));
                }

                browser_response(&mut stream, true);
                return code
                    .ok_or_else(|| "Google OAuth did not return an authorization code.".to_string());
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                thread::sleep(Duration::from_millis(100));
            }
            Err(error) => {
                return Err(format!("OAuth callback listener failed: {error}"));
            }
        }
    }

    Err("Google authorization timed out. Try connecting again.".to_string())
}

async fn parse_token_response(response: reqwest::Response) -> Result<GoogleTokenPayload, String> {
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|error| format!("Could not read Google's token response: {error}"))?;
    let payload = serde_json::from_str::<GoogleTokenPayload>(&body)
        .map_err(|error| format!("Google returned an invalid token response: {error}"))?;

    if !status.is_success() || payload.access_token.is_none() {
        let description = payload
            .error_description
            .clone()
            .or(payload.error.clone())
            .unwrap_or_else(|| format!("Google token request failed with HTTP {status}."));
        return Err(description);
    }

    Ok(payload)
}

async fn exchange_authorization_code(
    client_id: &str,
    code: &str,
    redirect_uri: &str,
    verifier: &str,
) -> Result<GoogleTokenPayload, String> {
    let response = reqwest::Client::new()
        .post(TOKEN_ENDPOINT)
        .form(&[
            ("client_id", client_id),
            ("code", code),
            ("code_verifier", verifier),
            ("grant_type", "authorization_code"),
            ("redirect_uri", redirect_uri),
        ])
        .send()
        .await
        .map_err(|error| format!("Could not reach Google's token endpoint: {error}"))?;

    parse_token_response(response).await
}

async fn refresh_access_token(
    client_id: &str,
    refresh_token: &str,
) -> Result<GoogleTokenPayload, String> {
    let response = reqwest::Client::new()
        .post(TOKEN_ENDPOINT)
        .form(&[
            ("client_id", client_id),
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh_token),
        ])
        .send()
        .await
        .map_err(|error| format!("Could not refresh Google authorization: {error}"))?;

    parse_token_response(response).await
}

async fn fetch_account(access_token: &str) -> Result<GoogleAccount, String> {
    let response = reqwest::Client::new()
        .get(USERINFO_ENDPOINT)
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|error| format!("Could not read the connected Google account: {error}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "Google account lookup failed with HTTP {}.",
            response.status()
        ));
    }

    let info = response
        .json::<GoogleUserInfo>()
        .await
        .map_err(|error| format!("Google returned invalid account information: {error}"))?;
    let email = info.email.unwrap_or_else(|| "Google account".to_string());
    let name = info.name.unwrap_or_else(|| email.clone());

    Ok(GoogleAccount { email, name })
}

fn connection_from_token(
    token: GoogleTokenPayload,
    account: GoogleAccount,
) -> Result<GoogleAuthConnection, String> {
    let access_token = token
        .access_token
        .ok_or_else(|| "Google did not return an access token.".to_string())?;
    let expires_at = unix_time_ms() + token.expires_in.unwrap_or(3600) * 1000;

    Ok(GoogleAuthConnection {
        access_token,
        expires_at,
        account,
    })
}

#[cfg(target_os = "windows")]
fn store_refresh_token(refresh_token: &str) -> Result<(), String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER)
        .map_err(|error| format!("Could not open Windows Credential Manager: {error}"))?;
    entry
        .set_password(refresh_token)
        .map_err(|error| format!("Could not store Google authorization securely: {error}"))
}

#[cfg(not(target_os = "windows"))]
fn store_refresh_token(_refresh_token: &str) -> Result<(), String> {
    Ok(())
}

#[cfg(target_os = "windows")]
fn read_refresh_token() -> Result<Option<String>, String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER)
        .map_err(|error| format!("Could not open Windows Credential Manager: {error}"))?;
    match entry.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(format!("Could not read stored Google authorization: {error}")),
    }
}

#[cfg(not(target_os = "windows"))]
fn read_refresh_token() -> Result<Option<String>, String> {
    Ok(None)
}

#[cfg(target_os = "windows")]
fn delete_refresh_token() -> Result<(), String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER)
        .map_err(|error| format!("Could not open Windows Credential Manager: {error}"))?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(format!("Could not clear stored Google authorization: {error}")),
    }
}

#[cfg(not(target_os = "windows"))]
fn delete_refresh_token() -> Result<(), String> {
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn google_oauth_connect(
    app: tauri::AppHandle,
    client_id: String,
) -> Result<GoogleAuthConnection, String> {
    if client_id.trim().is_empty() {
        return Err("Google OAuth client ID is not configured.".to_string());
    }

    let listener = TcpListener::bind("127.0.0.1:0")
        .map_err(|error| format!("Could not start the local OAuth callback listener: {error}"))?;
    let port = listener
        .local_addr()
        .map_err(|error| format!("Could not determine the OAuth callback port: {error}"))?
        .port();
    let redirect_uri = format!("http://127.0.0.1:{port}");

    let verifier = random_urlsafe(64);
    let challenge = pkce_challenge(&verifier);
    let state = random_urlsafe(32);

    let mut authorization_url = Url::parse(AUTH_ENDPOINT)
        .map_err(|error| format!("Could not build the Google authorization URL: {error}"))?;
    {
        let mut query = authorization_url.query_pairs_mut();
        query
            .append_pair("client_id", client_id.trim())
            .append_pair("redirect_uri", &redirect_uri)
            .append_pair("response_type", "code")
            .append_pair("scope", DRIVE_SCOPE)
            .append_pair("code_challenge", &challenge)
            .append_pair("code_challenge_method", "S256")
            .append_pair("state", &state)
            .append_pair("access_type", "offline")
            .append_pair("prompt", "consent");
    }

    let authorization_url = authorization_url.to_string();
    let _ = app.emit(AUTH_URL_EVENT, authorization_url.clone());

    // Best-effort auto-open. If Windows cannot open the URL automatically,
    // the app still shows the exact authorization URL so the user can open
    // or copy it manually while the loopback callback keeps listening.
    let _ = open::that(&authorization_url);

    let expected_state = state.clone();
    let code = tauri::async_runtime::spawn_blocking(move || {
        wait_for_authorization_code(listener, expected_state)
    })
    .await
    .map_err(|error| format!("OAuth callback task failed: {error}"))??;

    let token =
        exchange_authorization_code(client_id.trim(), &code, &redirect_uri, &verifier).await?;
    if let Some(refresh_token) = token.refresh_token.as_deref() {
        store_refresh_token(refresh_token)?;
    } else if read_refresh_token()?.is_none() {
        return Err(
            "Google did not return a refresh token. Revoke FocusCanvas access in your Google Account, then connect again."
                .to_string(),
        );
    }

    let access_token = token
        .access_token
        .as_deref()
        .ok_or_else(|| "Google did not return an access token.".to_string())?;
    let account = fetch_account(access_token).await?;
    connection_from_token(token, account)
}

#[tauri::command]
pub fn google_oauth_open_url(url: String) -> Result<(), String> {
    let parsed = Url::parse(url.trim())
        .map_err(|error| format!("The Google authorization URL is invalid: {error}"))?;

    if parsed.scheme() != "https"
        || parsed.host_str() != Some("accounts.google.com")
        || !parsed.path().starts_with("/o/oauth2/")
    {
        return Err("Refusing to open a non-Google OAuth URL.".to_string());
    }

    open::that(parsed.as_str())
        .map_err(|error| format!("Could not open the system browser: {error}"))
}

#[tauri::command(rename_all = "camelCase")]
pub async fn google_oauth_restore(
    client_id: String,
) -> Result<Option<GoogleAuthConnection>, String> {
    if client_id.trim().is_empty() {
        return Ok(None);
    }

    let Some(refresh_token) = read_refresh_token()? else {
        return Ok(None);
    };

    let token = match refresh_access_token(client_id.trim(), &refresh_token).await {
        Ok(token) => token,
        Err(error) if error.contains("invalid_grant") || error.contains("invalid_client") => {
            let _ = delete_refresh_token();
            return Ok(None);
        }
        Err(error) => return Err(error),
    };
    let access_token = token
        .access_token
        .as_deref()
        .ok_or_else(|| "Google did not return an access token.".to_string())?;
    let account = fetch_account(access_token).await?;

    connection_from_token(token, account).map(Some)
}

#[tauri::command]
pub async fn google_oauth_disconnect() -> Result<(), String> {
    if let Some(refresh_token) = read_refresh_token()? {
        let _ = reqwest::Client::new()
            .post(REVOKE_ENDPOINT)
            .form(&[("token", refresh_token.as_str())])
            .send()
            .await;
    }

    delete_refresh_token()
}
