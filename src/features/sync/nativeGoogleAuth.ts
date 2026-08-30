import { invoke } from "@tauri-apps/api/core";

export const GOOGLE_CLIENT_ID =
  import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim() ?? "";

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

export async function connectGoogleDrive() {
  return invoke<GoogleDriveConnection>("google_oauth_connect", {
    clientId: requireClientId(),
  });
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
