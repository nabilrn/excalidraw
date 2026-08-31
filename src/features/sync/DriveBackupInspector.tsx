import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { ConfirmDialog } from "../../components/ConfirmDialog";
import {
  GOOGLE_CLIENT_ID,
  restoreGoogleDriveConnection,
  syncWorkspaceWithDrive,
} from "./googleDriveSync";
import "./driveBackupInspector.css";

const BACKUP_FILE_NAME = "focuscanvas-workspace.json";

type DriveFile = {
  id: string;
  modifiedTime?: string;
};

type WorkspaceSnapshot = {
  schemaVersion?: number;
  exportedAt?: number;
  data?: {
    tasks?: unknown[];
    diagrams?: unknown[];
    canvasGroups?: unknown[];
    focusSessions?: unknown[];
  };
};

type DriveBackupInfo = {
  fileId: string;
  modifiedAt: number | null;
  exportedAt: number | null;
  tasks: number;
  canvases: number;
  groups: number;
  sessions: number;
};

function authHeaders(accessToken: string) {
  return { Authorization: `Bearer ${accessToken}` };
}

async function inspectDriveBackup(accessToken: string): Promise<DriveBackupInfo | null> {
  const params = new URLSearchParams({
    spaces: "appDataFolder",
    q: `name='${BACKUP_FILE_NAME}' and trashed=false`,
    fields: "files(id,modifiedTime)",
    orderBy: "modifiedTime desc",
    pageSize: "1",
  });
  const listResponse = await fetch(
    `https://www.googleapis.com/drive/v3/files?${params.toString()}`,
    { headers: authHeaders(accessToken) },
  );
  if (!listResponse.ok) {
    throw new Error("Could not inspect the FocusCanvas backup in Google Drive.");
  }

  const listPayload = (await listResponse.json()) as { files?: DriveFile[] };
  const driveFile = listPayload.files?.[0];
  if (!driveFile) {
    return null;
  }

  const backupResponse = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(driveFile.id)}?alt=media`,
    { headers: authHeaders(accessToken) },
  );
  if (!backupResponse.ok) {
    throw new Error("Could not read the FocusCanvas backup from Google Drive.");
  }

  const snapshot = (await backupResponse.json()) as WorkspaceSnapshot;
  if (snapshot.schemaVersion !== 1 || !snapshot.data) {
    throw new Error("The Google Drive backup is not a supported FocusCanvas snapshot.");
  }

  const modifiedAt = driveFile.modifiedTime
    ? new Date(driveFile.modifiedTime).getTime()
    : NaN;
  const exportedAt = Number(snapshot.exportedAt);

  return {
    fileId: driveFile.id,
    modifiedAt: Number.isFinite(modifiedAt) ? modifiedAt : null,
    exportedAt: Number.isFinite(exportedAt) && exportedAt > 0 ? exportedAt : null,
    tasks: snapshot.data.tasks?.length ?? 0,
    canvases: snapshot.data.diagrams?.length ?? 0,
    groups: snapshot.data.canvasGroups?.length ?? 0,
    sessions: snapshot.data.focusSessions?.length ?? 0,
  };
}

function formatBackupTime(timestamp: number | null) {
  if (!timestamp) {
    return "Unknown time";
  }
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
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

export function DriveBackupInspector() {
  const [portalTarget, setPortalTarget] = useState<Element | null>(null);
  const [connectedUi, setConnectedUi] = useState(false);
  const [backup, setBackup] = useState<DriveBackupInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [message, setMessage] = useState("Checking Drive backup…");

  useEffect(() => {
    const syncTarget = () => {
      const next = document.querySelector(".drive-setting-card");
      setPortalTarget((current) => (current === next ? current : next));
      setConnectedUi(Boolean(next?.querySelector(".drive-account-row")));
    };

    syncTarget();
    const observer = new MutationObserver(syncTarget);
    observer.observe(document.getElementById("root") ?? document.body, {
      childList: true,
      subtree: true,
    });
    return () => observer.disconnect();
  }, []);

  const refreshBackup = useCallback(async () => {
    if (!GOOGLE_CLIENT_ID || !connectedUi) {
      setBackup(null);
      return;
    }

    setLoading(true);
    try {
      const connection = await restoreGoogleDriveConnection();
      if (!connection) {
        setBackup(null);
        setMessage("Connect Google Drive to inspect cloud backup.");
        return;
      }

      const info = await inspectDriveBackup(connection.accessToken);
      setBackup(info);
      setMessage(
        info
          ? "Backup found in hidden Google Drive app data."
          : "No Drive backup exists yet. Sync this device to create one.",
      );
    } catch (cause) {
      console.error(cause);
      setBackup(null);
      setMessage(errorMessage(cause, "Could not inspect the Drive backup."));
    } finally {
      setLoading(false);
    }
  }, [connectedUi]);

  useEffect(() => {
    if (!portalTarget || !connectedUi) {
      setBackup(null);
      return;
    }
    void refreshBackup();
  }, [connectedUi, portalTarget, refreshBackup]);

  useEffect(() => {
    if (!portalTarget || !connectedUi) {
      return;
    }
    const handleWorkspaceSync = () => void refreshBackup();
    window.addEventListener("focuscanvas:workspace-synced", handleWorkspaceSync);
    return () =>
      window.removeEventListener("focuscanvas:workspace-synced", handleWorkspaceSync);
  }, [connectedUi, portalTarget, refreshBackup]);

  const runSync = async () => {
    setBusy(true);
    setMessage("Syncing this device with Drive…");
    try {
      const connection = await restoreGoogleDriveConnection();
      if (!connection) {
        throw new Error("Google Drive connection is no longer available.");
      }

      const result = await syncWorkspaceWithDrive(connection.accessToken, "auto");
      if (result.status === "conflict") {
        setMessage(
          "Both copies changed. Use the existing conflict controls above to choose which copy should win.",
        );
      } else if (result.status === "uploaded") {
        setMessage("This device was backed up to Drive.");
      } else if (result.status === "downloaded") {
        setMessage("Drive backup was restored to this device.");
      } else {
        setMessage("This device and Drive are already up to date.");
      }
      await refreshBackup();
    } catch (cause) {
      console.error(cause);
      setMessage(errorMessage(cause, "Google Drive sync failed."));
    } finally {
      setBusy(false);
    }
  };

  const restoreThisDevice = async () => {
    setConfirmRestore(false);
    setBusy(true);
    setMessage("Restoring this device from Drive…");
    try {
      const connection = await restoreGoogleDriveConnection();
      if (!connection) {
        throw new Error("Google Drive connection is no longer available.");
      }
      if (!backup) {
        throw new Error("No FocusCanvas Drive backup was found.");
      }

      await syncWorkspaceWithDrive(connection.accessToken, "pull");
      setMessage("Drive backup restored. Your workspace is ready on this device.");
      await refreshBackup();
    } catch (cause) {
      console.error(cause);
      setMessage(errorMessage(cause, "Could not restore this device from Drive."));
    } finally {
      setBusy(false);
    }
  };

  if (!portalTarget || !connectedUi) {
    return null;
  }

  return createPortal(
    <>
      <div className="drive-backup-inspector">
        <div className="drive-backup-heading">
          <div>
            <p>DRIVE BACKUP</p>
            <strong>
              {loading ? "Checking backup…" : backup ? "Backup found" : "No backup yet"}
            </strong>
          </div>
          <span>hidden app data</span>
        </div>

        {backup && (
          <>
            <div className="drive-backup-stats">
              <span><strong>{backup.canvases}</strong> canvases</span>
              <span><strong>{backup.tasks}</strong> tasks</span>
              <span><strong>{backup.sessions}</strong> sessions</span>
              <span><strong>{backup.groups}</strong> groups</span>
            </div>
            <div className="drive-backup-meta">
              <span>Backup updated</span>
              <strong>{formatBackupTime(backup.modifiedAt ?? backup.exportedAt)}</strong>
            </div>
          </>
        )}

        <p className="drive-backup-message">{message}</p>
        <p className="drive-backup-note">
          FocusCanvas stores one private workspace snapshot in Google Drive app data.
          It is intentionally hidden from My Drive, but follows your Google account to a new device.
        </p>

        <div className="drive-backup-actions">
          {backup && (
            <button
              className="is-primary"
              disabled={busy || loading}
              onClick={() => setConfirmRestore(true)}
            >
              Restore this device
            </button>
          )}
          <button disabled={busy || loading} onClick={() => void runSync()}>
            {busy ? "Working…" : backup ? "Sync now" : "Create backup"}
          </button>
          <button disabled={busy || loading} onClick={() => void refreshBackup()}>
            Refresh
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmRestore}
        title="Restore this device from Drive?"
        message="The Drive backup will replace the current local FocusCanvas workspace on this device. Local changes that are not present in the Drive copy will be lost."
        confirmLabel="Restore this device"
        busy={busy}
        onCancel={() => setConfirmRestore(false)}
        onConfirm={() => void restoreThisDevice()}
      />
    </>,
    portalTarget,
  );
}
