import { getDatabase } from "../../lib/db";
import { getSetting, setSetting } from "../settings/settingsRepository";

const DRIVE_SCOPE = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/drive.appdata",
].join(" ");
const BACKUP_FILE_NAME = "focuscanvas-workspace.json";
const LAST_REVISION_KEY = "drive_last_synced_revision";
const LAST_SYNC_AT_KEY = "drive_last_sync_at";

export const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim() ?? "";

export type GoogleAccount = {
  email: string;
  name: string;
};

type WorkspaceData = {
  tasks: Record<string, unknown>[];
  diagrams: Record<string, unknown>[];
  canvasGroups: Record<string, unknown>[];
  focusSessions: Record<string, unknown>[];
  settings: { key: string; value: string }[];
};

type WorkspaceSnapshot = {
  schemaVersion: 1;
  revision: string;
  exportedAt: number;
  data: WorkspaceData;
};

type DriveFile = {
  id: string;
  modifiedTime?: string;
};

export type SyncResult =
  | { status: "uploaded" | "downloaded" | "up-to-date"; syncedAt: number }
  | { status: "conflict"; localRevision: string; remoteRevision: string };

type GoogleTokenResponse = {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
};

type GoogleTokenClient = {
  requestAccessToken: (options?: { prompt?: string }) => void;
};

declare global {
  interface Window {
    google?: {
      accounts?: {
        oauth2?: {
          initTokenClient: (options: {
            client_id: string;
            scope: string;
            callback: (response: GoogleTokenResponse) => void;
            error_callback?: (error: unknown) => void;
          }) => GoogleTokenClient;
        };
      };
    };
  }
}

let identityScriptPromise: Promise<void> | null = null;

function loadGoogleIdentityScript() {
  if (window.google?.accounts?.oauth2) {
    return Promise.resolve();
  }
  if (identityScriptPromise) {
    return identityScriptPromise;
  }

  identityScriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      'script[data-focuscanvas-google-identity="true"]',
    );
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener(
        "error",
        () => reject(new Error("Could not load Google Identity Services.")),
        { once: true },
      );
      return;
    }

    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.dataset.focuscanvasGoogleIdentity = "true";
    script.onload = () => resolve();
    script.onerror = () =>
      reject(new Error("Could not load Google Identity Services."));
    document.head.appendChild(script);
  });

  return identityScriptPromise;
}

export async function connectGoogleDrive() {
  if (!GOOGLE_CLIENT_ID) {
    throw new Error(
      "Google OAuth is not configured. Set VITE_GOOGLE_CLIENT_ID before building FocusCanvas.",
    );
  }

  await loadGoogleIdentityScript();
  const oauth = window.google?.accounts?.oauth2;
  if (!oauth) {
    throw new Error("Google OAuth could not be initialized.");
  }

  const accessToken = await new Promise<string>((resolve, reject) => {
    const client = oauth.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: DRIVE_SCOPE,
      callback: (response) => {
        if (response.error || !response.access_token) {
          reject(
            new Error(
              response.error_description ?? response.error ?? "Google OAuth failed.",
            ),
          );
          return;
        }
        resolve(response.access_token);
      },
      error_callback: () => reject(new Error("Google OAuth window was closed.")),
    });

    client.requestAccessToken({ prompt: "consent" });
  });

  const response = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    throw new Error("Connected to Google, but account information could not be read.");
  }
  const account = (await response.json()) as Partial<GoogleAccount>;

  return {
    accessToken,
    account: {
      email: account.email ?? "Google account",
      name: account.name ?? account.email ?? "Google account",
    } satisfies GoogleAccount,
  };
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function readWorkspaceData(): Promise<WorkspaceData> {
  const database = await getDatabase();
  const [tasks, diagrams, canvasGroups, focusSessions, settings] =
    await Promise.all([
      database.select<Record<string, unknown>[]>("SELECT * FROM tasks ORDER BY id"),
      database.select<Record<string, unknown>[]>(
        "SELECT * FROM diagrams ORDER BY id",
      ),
      database.select<Record<string, unknown>[]>(
        "SELECT * FROM canvas_groups ORDER BY id",
      ),
      database.select<Record<string, unknown>[]>(
        "SELECT * FROM focus_sessions ORDER BY id",
      ),
      database.select<{ key: string; value: string }[]>(
        `SELECT key, value FROM settings
         WHERE key NOT LIKE 'drive_%'
         ORDER BY key`,
      ),
    ]);

  return { tasks, diagrams, canvasGroups, focusSessions, settings };
}

async function createSnapshot(): Promise<WorkspaceSnapshot> {
  const data = await readWorkspaceData();
  return {
    schemaVersion: 1,
    revision: await sha256(JSON.stringify(data)),
    exportedAt: Date.now(),
    data,
  };
}

function authHeaders(accessToken: string) {
  return { Authorization: `Bearer ${accessToken}` };
}

async function findDriveFile(accessToken: string): Promise<DriveFile | null> {
  const params = new URLSearchParams({
    spaces: "appDataFolder",
    q: `name='${BACKUP_FILE_NAME}' and trashed=false`,
    fields: "files(id,modifiedTime)",
    orderBy: "modifiedTime desc",
    pageSize: "1",
  });
  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files?${params.toString()}`,
    { headers: authHeaders(accessToken) },
  );
  if (!response.ok) {
    throw new Error("Could not inspect the FocusCanvas backup in Google Drive.");
  }
  const payload = (await response.json()) as { files?: DriveFile[] };
  return payload.files?.[0] ?? null;
}

async function downloadSnapshot(
  accessToken: string,
  fileId: string,
): Promise<WorkspaceSnapshot> {
  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`,
    { headers: authHeaders(accessToken) },
  );
  if (!response.ok) {
    throw new Error("Could not download the FocusCanvas backup from Google Drive.");
  }
  const snapshot = (await response.json()) as WorkspaceSnapshot;
  if (snapshot.schemaVersion !== 1 || !snapshot.data || !snapshot.revision) {
    throw new Error("The Google Drive backup is not a supported FocusCanvas snapshot.");
  }
  return snapshot;
}

async function uploadSnapshot(
  accessToken: string,
  snapshot: WorkspaceSnapshot,
  fileId?: string,
) {
  if (fileId) {
    const response = await fetch(
      `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(fileId)}?uploadType=media`,
      {
        method: "PATCH",
        headers: {
          ...authHeaders(accessToken),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(snapshot),
      },
    );
    if (!response.ok) {
      throw new Error("Could not update the FocusCanvas backup in Google Drive.");
    }
    return;
  }

  const boundary = `focuscanvas_${crypto.randomUUID()}`;
  const metadata = JSON.stringify({
    name: BACKUP_FILE_NAME,
    parents: ["appDataFolder"],
  });
  const body = [
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    metadata,
    `--${boundary}`,
    "Content-Type: application/json",
    "",
    JSON.stringify(snapshot),
    `--${boundary}--`,
    "",
  ].join("\r\n");

  const response = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart",
    {
      method: "POST",
      headers: {
        ...authHeaders(accessToken),
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body,
    },
  );
  if (!response.ok) {
    throw new Error("Could not create the FocusCanvas backup in Google Drive.");
  }
}

async function restoreSnapshot(snapshot: WorkspaceSnapshot) {
  const database = await getDatabase();
  const { tasks, diagrams, canvasGroups, focusSessions, settings } = snapshot.data;

  await database.execute("BEGIN TRANSACTION");
  try {
    await database.execute("DELETE FROM focus_sessions");
    await database.execute("DELETE FROM diagrams");
    await database.execute("DELETE FROM tasks");
    await database.execute("DELETE FROM canvas_groups");
    await database.execute("DELETE FROM settings WHERE key NOT LIKE 'drive_%'");

    for (const group of canvasGroups) {
      await database.execute(
        `INSERT INTO canvas_groups (id, name, created_at, updated_at)
         VALUES (?, ?, ?, ?)`,
        [group.id, group.name, group.created_at, group.updated_at],
      );
    }

    for (const task of tasks) {
      await database.execute(
        `INSERT INTO tasks (
           id, title, description, status, priority, estimated_minutes,
           due_at, linked_diagram_id, created_at, updated_at, completed_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
        [
          task.id,
          task.title,
          task.description,
          task.status,
          task.priority,
          task.estimated_minutes,
          task.due_at,
          task.created_at,
          task.updated_at,
          task.completed_at,
        ],
      );
    }

    for (const diagram of diagrams) {
      await database.execute(
        `INSERT INTO diagrams (
           id, name, scene_data, thumbnail, task_id, group_id,
           created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          diagram.id,
          diagram.name,
          diagram.scene_data,
          diagram.thumbnail ?? null,
          diagram.task_id ?? null,
          diagram.group_id ?? null,
          diagram.created_at,
          diagram.updated_at,
        ],
      );
    }

    for (const task of tasks) {
      if (task.linked_diagram_id) {
        await database.execute(
          "UPDATE tasks SET linked_diagram_id = ? WHERE id = ?",
          [task.linked_diagram_id, task.id],
        );
      }
    }

    for (const session of focusSessions) {
      await database.execute(
        `INSERT INTO focus_sessions (
           id, task_id, planned_seconds, actual_seconds, status,
           started_at, ended_at, paused_at, paused_total_seconds
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          session.id,
          session.task_id ?? null,
          session.planned_seconds,
          session.actual_seconds,
          session.status,
          session.started_at,
          session.ended_at ?? null,
          session.paused_at ?? null,
          session.paused_total_seconds ?? 0,
        ],
      );
    }

    for (const setting of settings) {
      await database.execute(
        `INSERT INTO settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        [setting.key, setting.value],
      );
    }

    await database.execute("COMMIT");
  } catch (cause) {
    await database.execute("ROLLBACK");
    throw cause;
  }

  window.dispatchEvent(new CustomEvent("focuscanvas:workspace-synced"));
}

async function markSynced(revision: string) {
  const syncedAt = Date.now();
  await Promise.all([
    setSetting(LAST_REVISION_KEY, revision),
    setSetting(LAST_SYNC_AT_KEY, String(syncedAt)),
  ]);
  return syncedAt;
}

export async function getLastSyncAt() {
  const value = await getSetting(LAST_SYNC_AT_KEY);
  const parsed = value ? Number(value) : 0;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export async function syncWorkspaceWithDrive(
  accessToken: string,
  strategy: "auto" | "push" | "pull" = "auto",
): Promise<SyncResult> {
  const local = await createSnapshot();
  const driveFile = await findDriveFile(accessToken);

  if (!driveFile) {
    await uploadSnapshot(accessToken, local);
    return { status: "uploaded", syncedAt: await markSynced(local.revision) };
  }

  const remote = await downloadSnapshot(accessToken, driveFile.id);

  if (strategy === "push") {
    await uploadSnapshot(accessToken, local, driveFile.id);
    return { status: "uploaded", syncedAt: await markSynced(local.revision) };
  }
  if (strategy === "pull") {
    await restoreSnapshot(remote);
    return { status: "downloaded", syncedAt: await markSynced(remote.revision) };
  }

  if (local.revision === remote.revision) {
    return {
      status: "up-to-date",
      syncedAt: await markSynced(local.revision),
    };
  }

  const lastRevision = await getSetting(LAST_REVISION_KEY);
  if (lastRevision) {
    const localChanged = local.revision !== lastRevision;
    const remoteChanged = remote.revision !== lastRevision;

    if (localChanged && remoteChanged) {
      return {
        status: "conflict",
        localRevision: local.revision,
        remoteRevision: remote.revision,
      };
    }
    if (remoteChanged) {
      await restoreSnapshot(remote);
      return {
        status: "downloaded",
        syncedAt: await markSynced(remote.revision),
      };
    }

    await uploadSnapshot(accessToken, local, driveFile.id);
    return { status: "uploaded", syncedAt: await markSynced(local.revision) };
  }

  const localHasData =
    local.data.tasks.length > 0 ||
    local.data.diagrams.length > 0 ||
    local.data.canvasGroups.length > 0 ||
    local.data.focusSessions.length > 0;
  const remoteHasData =
    remote.data.tasks.length > 0 ||
    remote.data.diagrams.length > 0 ||
    remote.data.canvasGroups.length > 0 ||
    remote.data.focusSessions.length > 0;

  if (localHasData && remoteHasData) {
    return {
      status: "conflict",
      localRevision: local.revision,
      remoteRevision: remote.revision,
    };
  }

  if (remoteHasData) {
    await restoreSnapshot(remote);
    return { status: "downloaded", syncedAt: await markSynced(remote.revision) };
  }

  await uploadSnapshot(accessToken, local, driveFile.id);
  return { status: "uploaded", syncedAt: await markSynced(local.revision) };
}
