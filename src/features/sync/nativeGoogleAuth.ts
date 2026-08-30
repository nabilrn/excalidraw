import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export const GOOGLE_CLIENT_ID =
  import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim() ?? "";

const GOOGLE_OAUTH_URL_EVENT = "focuscanvas-google-oauth-url";

export type GoogleAccount = {
  email: string;
  name: string;
};

export type GoogleDriveConnection = {
  accessToken: string;
  expiresAt: number;
  account: GoogleAccount;
};

function requireClientId() {
  if (!GOOGLE_CLIENT_ID) {
    throw new Error(
      "Google OAuth is not configured. Set VITE_GOOGLE_CLIENT_ID before building FocusCanvas.",
    );
  }
  return GOOGLE_CLIENT_ID;
}

export async function connectGoogleDrive(
  onAuthorizationUrl?: (authorizationUrl: string) => void,
) {
  let unlisten: (() => void) | null = null;

  if (onAuthorizationUrl) {
    unlisten = await listen<string>(GOOGLE_OAUTH_URL_EVENT, (event) => {
      const authorizationUrl = event.payload?.trim();
      if (authorizationUrl) {
        onAuthorizationUrl(authorizationUrl);
      }
    });
  }

  try {
    return await invoke<GoogleDriveConnection>("google_oauth_connect", {
      clientId: requireClientId(),
    });
  } finally {
    unlisten?.();
  }
}

export async function openGoogleAuthorizationUrl(url: string) {
  await invoke("google_oauth_open_url", { url });
}

export async function restoreGoogleDriveConnection() {
  if (!GOOGLE_CLIENT_ID) {
    return null;
  }

  return invoke<GoogleDriveConnection | null>("google_oauth_restore", {
    clientId: GOOGLE_CLIENT_ID,
  });
}

export async function disconnectGoogleDrive() {
  await invoke("google_oauth_disconnect");
}
