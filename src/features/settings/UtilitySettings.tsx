import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { ConfirmDialog } from "../../components/ConfirmDialog";
import {
  GOOGLE_CLIENT_ID,
  connectGoogleDrive,
  disconnectGoogleDrive,
  getLastSyncAt,
  restoreGoogleDriveConnection,
  syncWorkspaceWithDrive,
  type GoogleAccount,
  type SyncResult,
} from "../sync/googleDriveSync";
import { openGoogleAuthorizationUrl } from "../sync/nativeGoogleAuth";
import { getSetting, setSetting } from "./settingsRepository";
import "./settings.css";

const FONT_SCALE_KEY = "utility_font_scale";
const AUTO_SYNC_KEY = "drive_auto_sync";
const MIN_SCALE = 85;
const MAX_SCALE = 140;
const DEFAULT_SCALE = 100;

const clampScale = (value: number) =>
  Math.max(MIN_SCALE, Math.min(MAX_SCALE, Math.round(value)));

const applyScale = (value: number) => {
  document.documentElement.style.setProperty(
    "--utility-font-scale",
    String(clampScale(value) / 100),
  );
};

const presets = [
  { label: "Compact", value: 90 },
  { label: "Default", value: 100 },
  { label: "Large", value: 115 },
  { label: "XL", value: 130 },
];

type SyncState =
  | "idle"
  | "connecting"
  | "connected"
  | "syncing"
  | "conflict"
  | "error";
type PendingDriveAction = "disconnect" | "push" | "pull" | null;

function formatSyncTime(timestamp: number | null) {
  if (!timestamp) {
    return "Never synced";
  }
  return `Last synced ${new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp))}`;
}

function errorMessage(cause: unknown, fallback: string) {
  if (cause instanceof Error) {
    return cause.message;
  }
  if (typeof cause === "string" && cause.trim()) {
    return cause;
  }
  return fallback;
}

async function copyText(value: string) {
  try {
    await navigator.clipboard.writeText(value);
    return;
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    if (!copied) {
      throw new Error("Could not copy the Google authorization link.");
    }
  }
}

export function UtilitySettings() {
  const [open, setOpen] = useState(false);
  const [scale, setScale] = useState(DEFAULT_SCALE);
  const [portalTarget, setPortalTarget] = useState<Element | null>(null);
  const [saved, setSaved] = useState(true);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [tokenExpiresAt, setTokenExpiresAt] = useState(0);
  const [account, setAccount] = useState<GoogleAccount | null>(null);
  const [syncState, setSyncState] = useState<SyncState>("idle");
  const [syncMessage, setSyncMessage] = useState(
    "Local data has not been connected to Drive.",
  );
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
  const [autoSync, setAutoSync] = useState(false);
  const [pendingDriveAction, setPendingDriveAction] =
    useState<PendingDriveAction>(null);
  const [authorizationUrl, setAuthorizationUrl] = useState<string | null>(null);
  const [authorizationCopied, setAuthorizationCopied] = useState(false);
  const [authorizationOpening, setAuthorizationOpening] = useState(false);
  const saveTimerRef = useRef<number | null>(null);
  const loadedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    void Promise.all([
      getSetting(FONT_SCALE_KEY),
      getSetting(AUTO_SYNC_KEY),
      getLastSyncAt(),
    ])
      .then(([fontValue, autoValue, syncAt]) => {
        if (cancelled) {
          return;
        }
        const parsed = fontValue ? Number(fontValue) : DEFAULT_SCALE;
        const next = Number.isFinite(parsed)
          ? clampScale(parsed)
          : DEFAULT_SCALE;
        setScale(next);
        applyScale(next);
        setAutoSync(autoValue === "true");
        setLastSyncAt(syncAt);
      })
      .catch((cause) => {
        console.error(cause);
        applyScale(DEFAULT_SCALE);
      })
      .finally(() => {
        loadedRef.current = true;
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) {
      return;
    }

    let cancelled = false;
    void restoreGoogleDriveConnection()
      .then((connection) => {
        if (cancelled || !connection) {
          return;
        }
        setAccessToken(connection.accessToken);
        setTokenExpiresAt(connection.expiresAt);
        setAccount(connection.account);
        setSyncState("connected");
        setSyncMessage("Connected to Google Drive.");
      })
      .catch((cause) => {
        console.error(cause);
        if (!cancelled) {
          setSyncState("error");
          setSyncMessage(
            errorMessage(cause, "Could not restore Google Drive connection."),
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const syncTarget = () => {
      const next = document.querySelector(".topbar-actions");
      setPortalTarget((current) => (current === next ? current : next));
      if (!next) {
        setOpen(false);
      }
    };

    syncTarget();
    const observer = new MutationObserver(syncTarget);
    observer.observe(document.getElementById("root") ?? document.body, {
      childList: true,
      subtree: true,
    });

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    applyScale(scale);

    if (!loadedRef.current) {
      return;
    }

    setSaved(false);
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
    }

    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      void setSetting(FONT_SCALE_KEY, String(scale))
        .then(() => setSaved(true))
        .catch((cause) => {
          console.error(cause);
          setSaved(false);
        });
    }, 250);

    return () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
      }
    };
  }, [scale]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key === "Escape" &&
        !pendingDriveAction &&
        !authorizationUrl
      ) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, pendingDriveAction, authorizationUrl]);

  const runSync = useCallback(
    async (token: string, strategy: "auto" | "push" | "pull" = "auto") => {
      setSyncState("syncing");
      setSyncMessage("Syncing workspace…");
      try {
        const result: SyncResult = await syncWorkspaceWithDrive(token, strategy);
        if (result.status === "conflict") {
          setSyncState("conflict");
          setSyncMessage(
            "This device and the Drive copy both changed. Nothing was overwritten.",
          );
          return;
        }

        setLastSyncAt(result.syncedAt);
        setSyncState("connected");
        setSyncMessage(
          result.status === "uploaded"
            ? "This device was backed up to Drive."
            : result.status === "downloaded"
              ? "Drive data was restored to this device."
              : "Workspace is already up to date.",
        );
      } catch (cause) {
        console.error(cause);
        setSyncState("error");
        setSyncMessage(errorMessage(cause, "Google Drive sync failed."));
      }
    },
    [],
  );

  useEffect(() => {
    if (!accessToken || !autoSync) {
      return;
    }
    const interval = window.setInterval(() => {
      void runSync(accessToken);
    }, 120_000);
    return () => window.clearInterval(interval);
  }, [accessToken, autoSync, runSync]);

  useEffect(() => {
    if (!accessToken || !account || !tokenExpiresAt) {
      return;
    }

    const refreshDelay = Math.max(
      10_000,
      tokenExpiresAt - Date.now() - 60_000,
    );
    const timer = window.setTimeout(() => {
      void restoreGoogleDriveConnection()
        .then((connection) => {
          if (!connection) {
            setAccessToken(null);
            setTokenExpiresAt(0);
            setAccount(null);
            setSyncState("idle");
            setSyncMessage("Google Drive authorization expired. Connect again.");
            return;
          }
          setAccessToken(connection.accessToken);
          setTokenExpiresAt(connection.expiresAt);
          setAccount(connection.account);
          setSyncState("connected");
        })
        .catch((cause) => {
          console.error(cause);
          setSyncState("error");
          setSyncMessage(
            errorMessage(cause, "Could not refresh Google Drive authorization."),
          );
        });
    }, refreshDelay);

    return () => window.clearTimeout(timer);
  }, [accessToken, account, tokenExpiresAt]);

  const setFontScale = (value: number) => setScale(clampScale(value));

  const handleConnect = async () => {
    setSyncState("connecting");
    setAuthorizationUrl(null);
    setAuthorizationCopied(false);
    setSyncMessage("Preparing Google authorization…");
    try {
      const connected = await connectGoogleDrive((url) => {
        setAuthorizationUrl(url);
        setAuthorizationCopied(false);
        setSyncMessage("Finish signing in with Google in your browser.");
      });
      setAuthorizationUrl(null);
      setAccessToken(connected.accessToken);
      setTokenExpiresAt(connected.expiresAt);
      setAccount(connected.account);
      setSyncState("connected");
      setSyncMessage("Connected. Checking workspace state…");
      await runSync(connected.accessToken);
    } catch (cause) {
      console.error(cause);
      setAuthorizationUrl(null);
      setSyncState("error");
      setSyncMessage(errorMessage(cause, "Could not connect Google Drive."));
    }
  };

  const handleOpenAuthorizationUrl = async () => {
    if (!authorizationUrl) {
      return;
    }
    setAuthorizationOpening(true);
    try {
      await openGoogleAuthorizationUrl(authorizationUrl);
      setSyncMessage("Google sign-in opened in your browser.");
    } catch (cause) {
      console.error(cause);
      setSyncMessage(
        `${errorMessage(cause, "Could not open your browser.")} Copy the link and paste it into your browser instead.`,
      );
    } finally {
      setAuthorizationOpening(false);
    }
  };

  const handleCopyAuthorizationUrl = async () => {
    if (!authorizationUrl) {
      return;
    }
    try {
      await copyText(authorizationUrl);
      setAuthorizationCopied(true);
      setSyncMessage("Authorization link copied. Paste it into any browser.");
    } catch (cause) {
      console.error(cause);
      setSyncMessage(errorMessage(cause, "Could not copy the authorization link."));
    }
  };

  const handleAutoSync = (enabled: boolean) => {
    setAutoSync(enabled);
    void setSetting(AUTO_SYNC_KEY, String(enabled)).catch(console.error);
  };

  const confirmDriveAction = async () => {
    const action = pendingDriveAction;
    setPendingDriveAction(null);
    if (!action) {
      return;
    }

    if (action === "disconnect") {
      try {
        await disconnectGoogleDrive();
      } catch (cause) {
        console.error(cause);
      }
      setAccessToken(null);
      setTokenExpiresAt(0);
      setAccount(null);
      setSyncState("idle");
      setSyncMessage("Google Drive disconnected.");
      return;
    }

    if (accessToken) {
      await runSync(accessToken, action);
    }
  };

  const pendingDialogCopy =
    pendingDriveAction === "disconnect"
      ? {
          title: "Disconnect Google Drive?",
          message:
            "Local workspace data stays on this device. Stored Google authorization will be revoked and automatic sync will stop.",
          label: "Disconnect",
        }
      : pendingDriveAction === "push"
        ? {
            title: "Replace the Drive copy?",
            message:
              "The current workspace on this device will become the Drive copy. Use this only if this device has the version you want to keep.",
            label: "Use this device",
          }
        : {
            title: "Replace local workspace?",
            message:
              "The Drive copy will replace this device's workspace. Local changes that are not in Drive will be lost.",
            label: "Use Drive copy",
          };

  return (
    <>
      {portalTarget &&
        createPortal(
          <button
            className={`utility-settings-launcher ${open ? "is-active" : ""}`}
            onClick={() => setOpen(true)}
            aria-expanded={open}
            aria-label="Open utility settings"
          >
            Settings
          </button>,
          portalTarget,
        )}

      {open && portalTarget &&
        createPortal(
          <div
            className="utility-settings-backdrop"
            role="presentation"
            onMouseDown={() => {
              if (!authorizationUrl) {
                setOpen(false);
              }
            }}
          >
            <section
              className="utility-settings-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="utility-settings-title"
              onMouseDown={(event) => event.stopPropagation()}
            >
              <header className="utility-settings-heading">
                <div>
                  <p>SETTINGS</p>
                  <h1 id="utility-settings-title">Workspace utility</h1>
                  <span>
                    Home workspace preferences and optional Google Drive sync.
                    Excalidraw editor sizing stays unchanged.
                  </span>
                </div>
                <button
                  className="utility-settings-close"
                  aria-label="Close settings"
                  disabled={Boolean(authorizationUrl)}
                  onClick={() => setOpen(false)}
                >
                  ×
                </button>
              </header>

              <div className="utility-settings-content">
                <section className="utility-setting-card">
                  <div className="utility-setting-copy">
                    <div>
                      <p>INTERFACE</p>
                      <h2>Font size</h2>
                    </div>
                    <strong>{scale}%</strong>
                  </div>

                  <input
                    className="utility-font-slider"
                    type="range"
                    min={MIN_SCALE}
                    max={MAX_SCALE}
                    step={5}
                    value={scale}
                    onChange={(event) => setFontScale(Number(event.target.value))}
                    aria-label="Workspace font size"
                  />

                  <div className="utility-scale-labels">
                    <span>Smaller</span>
                    <span>Default</span>
                    <span>Larger</span>
                  </div>

                  <div className="utility-presets">
                    {presets.map((preset) => (
                      <button
                        className={scale === preset.value ? "is-active" : ""}
                        key={preset.label}
                        onClick={() => setFontScale(preset.value)}
                      >
                        <strong>{preset.label}</strong>
                        <span>{preset.value}%</span>
                      </button>
                    ))}
                  </div>

                  <footer className="utility-setting-footer">
                    <span>{saved ? "Saved locally" : "Saving…"}</span>
                    <button onClick={() => setFontScale(DEFAULT_SCALE)}>
                      Reset to default
                    </button>
                  </footer>
                </section>

                <section className="utility-setting-card drive-setting-card">
                  <div className="utility-setting-copy">
                    <div>
                      <p>SYNC</p>
                      <h2>Google Drive</h2>
                    </div>
                    <span className={`drive-status-dot is-${syncState}`} />
                  </div>

                  {!GOOGLE_CLIENT_ID ? (
                    <div className="drive-config-note">
                      <strong>OAuth client not configured</strong>
                      <span>
                        Set <code>VITE_GOOGLE_CLIENT_ID</code> for the desktop
                        build. FocusCanvas requests only the hidden Drive
                        app-data scope plus basic Google identity.
                      </span>
                    </div>
                  ) : account && accessToken ? (
                    <div className="drive-account-row">
                      <div>
                        <strong>{account.name}</strong>
                        <span>{account.email}</span>
                      </div>
                      <button onClick={() => setPendingDriveAction("disconnect")}>
                        Disconnect
                      </button>
                    </div>
                  ) : (
                    <button
                      className="drive-connect-button"
                      disabled={syncState === "connecting"}
                      onClick={() => void handleConnect()}
                    >
                      {syncState === "connecting"
                        ? "Waiting for Google…"
                        : "Connect Google Drive"}
                    </button>
                  )}

                  <div className="drive-sync-copy">
                    <span>{syncMessage}</span>
                    <strong>{formatSyncTime(lastSyncAt)}</strong>
                  </div>

                  {accessToken && account && (
                    <>
                      <div className="drive-controls">
                        <label>
                          <input
                            type="checkbox"
                            checked={autoSync}
                            onChange={(event) =>
                              handleAutoSync(event.target.checked)
                            }
                          />
                          <span>Sync automatically while FocusCanvas is open</span>
                        </label>
                        <button
                          disabled={syncState === "syncing"}
                          onClick={() => void runSync(accessToken)}
                        >
                          {syncState === "syncing" ? "Syncing…" : "Sync now"}
                        </button>
                      </div>

                      {syncState === "conflict" && (
                        <div className="drive-conflict-actions">
                          <span>Choose which copy should win:</span>
                          <div>
                            <button onClick={() => setPendingDriveAction("push")}>
                              Use this device
                            </button>
                            <button onClick={() => setPendingDriveAction("pull")}>
                              Use Drive copy
                            </button>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </section>
              </div>
            </section>
          </div>,
          document.body,
        )}

      {authorizationUrl &&
        createPortal(
          <div className="drive-oauth-backdrop" role="presentation">
            <section
              className="drive-oauth-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="drive-oauth-title"
            >
              <p className="drive-oauth-eyebrow">GOOGLE AUTHORIZATION</p>
              <h2 id="drive-oauth-title">Continue in your browser</h2>
              <p className="drive-oauth-description">
                FocusCanvas tried to open Google automatically. If nothing
                opened, use the button below or copy the link and paste it into
                Chrome, Firefox, or Edge.
              </p>

              <label className="drive-oauth-url-field">
                <span>Authorization link</span>
                <input
                  value={authorizationUrl}
                  readOnly
                  onFocus={(event) => event.currentTarget.select()}
                  aria-label="Google authorization link"
                />
              </label>

              <div className="drive-oauth-actions">
                <button
                  className="drive-oauth-primary"
                  disabled={authorizationOpening}
                  onClick={() => void handleOpenAuthorizationUrl()}
                >
                  {authorizationOpening ? "Opening…" : "Open browser"}
                </button>
                <button onClick={() => void handleCopyAuthorizationUrl()}>
                  {authorizationCopied ? "Copied" : "Copy link"}
                </button>
              </div>

              <p className="drive-oauth-waiting">
                Waiting for Google… Keep FocusCanvas open. After approval,
                Google redirects to the local FocusCanvas callback and this
                dialog closes automatically.
              </p>
            </section>
          </div>,
          document.body,
        )}

      <ConfirmDialog
        open={pendingDriveAction !== null}
        title={pendingDialogCopy.title}
        message={pendingDialogCopy.message}
        confirmLabel={pendingDialogCopy.label}
        onCancel={() => setPendingDriveAction(null)}
        onConfirm={() => void confirmDriveAction()}
      />
    </>
  );
}
