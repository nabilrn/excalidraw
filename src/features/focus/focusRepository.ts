import { getDatabase } from "../../lib/db";

export type FocusSessionRecord = {
  id: string;
  task_id: string | null;
  task_title: string | null;
  planned_seconds: number;
  actual_seconds: number;
  status: "running" | "paused" | "completed" | "cancelled";
  started_at: number;
  ended_at: number | null;
  paused_at: number | null;
  paused_total_seconds: number;
};

const activeSessionQuery = `
  SELECT fs.id, fs.task_id, t.title AS task_title, fs.planned_seconds,
         fs.actual_seconds, fs.status, fs.started_at, fs.ended_at,
         fs.paused_at, fs.paused_total_seconds
  FROM focus_sessions fs
  LEFT JOIN tasks t ON t.id = fs.task_id
  WHERE fs.status IN ('running', 'paused')
  ORDER BY fs.started_at DESC
  LIMIT 1
`;

export function getElapsedSeconds(
  session: FocusSessionRecord,
  now = Date.now(),
) {
  const effectiveEnd =
    session.status === "paused" && session.paused_at
      ? session.paused_at
      : session.ended_at ?? now;

  const wallSeconds = Math.max(
    0,
    Math.floor((effectiveEnd - session.started_at) / 1000),
  );

  return Math.max(0, wallSeconds - session.paused_total_seconds);
}

export async function getActiveFocusSession() {
  const database = await getDatabase();
  const rows = await database.select<FocusSessionRecord[]>(activeSessionQuery);
  return rows[0] ?? null;
}

export async function startFocusSession(
  taskId: string | null,
  plannedSeconds: number,
) {
  const database = await getDatabase();
  const active = await getActiveFocusSession();

  if (active) {
    throw new Error("A focus session is already active.");
  }

  const now = Date.now();
  const id = crypto.randomUUID();

  await database.execute(
    `INSERT INTO focus_sessions (
       id, task_id, planned_seconds, actual_seconds, status,
       started_at, ended_at, paused_at, paused_total_seconds
     ) VALUES (?, ?, ?, 0, 'running', ?, NULL, NULL, 0)`,
    [id, taskId, plannedSeconds, now],
  );

  return getActiveFocusSession();
}

export async function pauseFocusSession(session: FocusSessionRecord) {
  if (session.status !== "running") {
    return session;
  }

  const database = await getDatabase();
  await database.execute(
    `UPDATE focus_sessions
     SET status = 'paused', paused_at = ?
     WHERE id = ?`,
    [Date.now(), session.id],
  );

  return getActiveFocusSession();
}

export async function resumeFocusSession(session: FocusSessionRecord) {
  if (session.status !== "paused" || !session.paused_at) {
    return session;
  }

  const database = await getDatabase();
  const now = Date.now();
  const additionalPausedSeconds = Math.max(
    0,
    Math.floor((now - session.paused_at) / 1000),
  );

  await database.execute(
    `UPDATE focus_sessions
     SET status = 'running', paused_at = NULL,
         paused_total_seconds = paused_total_seconds + ?
     WHERE id = ?`,
    [additionalPausedSeconds, session.id],
  );

  return getActiveFocusSession();
}

async function closeSession(
  session: FocusSessionRecord,
  status: "completed" | "cancelled",
) {
  const database = await getDatabase();
  const endedAt = Date.now();
  const actualSeconds = Math.min(
    session.planned_seconds,
    getElapsedSeconds(session, endedAt),
  );

  await database.execute(
    `UPDATE focus_sessions
     SET status = ?, actual_seconds = ?, ended_at = ?, paused_at = NULL
     WHERE id = ?`,
    [status, actualSeconds, endedAt, session.id],
  );
}

export async function finishFocusSession(session: FocusSessionRecord) {
  await closeSession(session, "completed");
}

export async function cancelFocusSession(session: FocusSessionRecord) {
  await closeSession(session, "cancelled");
}

export async function listRecentFocusSessions(limit = 20) {
  const database = await getDatabase();
  return database.select<FocusSessionRecord[]>(
    `SELECT fs.id, fs.task_id, t.title AS task_title, fs.planned_seconds,
            fs.actual_seconds, fs.status, fs.started_at, fs.ended_at,
            fs.paused_at, fs.paused_total_seconds
     FROM focus_sessions fs
     LEFT JOIN tasks t ON t.id = fs.task_id
     WHERE fs.status IN ('completed', 'cancelled')
     ORDER BY fs.started_at DESC
     LIMIT ?`,
    [limit],
  );
}
