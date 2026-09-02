import { getDatabase } from "../../lib/db";

export type TaskRecord = {
  id: string;
  title: string;
  description: string;
  status: "open" | "completed";
  priority: number;
  estimated_minutes: number | null;
  due_at: number | null;
  linked_diagram_id: string | null;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
};

function notifyTasksChanged() {
  window.dispatchEvent(new Event("focuscanvas:tasks-changed"));
}

function notifyWorkspaceChanged() {
  // App.tsx already refreshes all workspace collections on this event.
  window.dispatchEvent(new Event("focuscanvas:workspace-synced"));
}

export async function listTasks(): Promise<TaskRecord[]> {
  const database = await getDatabase();
  return database.select<TaskRecord[]>(
    `SELECT id, title, description, status, priority, estimated_minutes,
            due_at, linked_diagram_id, created_at, updated_at, completed_at
     FROM tasks
     ORDER BY CASE WHEN status = 'open' THEN 0 ELSE 1 END,
              created_at DESC`,
  );
}

export async function createTask(
  title: string,
  estimatedMinutes: number,
): Promise<TaskRecord> {
  const database = await getDatabase();
  const now = Date.now();
  const task: TaskRecord = {
    id: crypto.randomUUID(),
    title,
    description: "",
    status: "open",
    priority: 0,
    estimated_minutes: estimatedMinutes,
    due_at: null,
    linked_diagram_id: null,
    created_at: now,
    updated_at: now,
    completed_at: null,
  };

  await database.execute("BEGIN TRANSACTION");
  try {
    await database.execute(
      `INSERT INTO tasks (
         id, title, description, status, priority, estimated_minutes,
         due_at, linked_diagram_id, created_at, updated_at, completed_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        task.id,
        task.title,
        task.description,
        task.status,
        task.priority,
        task.estimated_minutes,
        task.due_at,
        task.linked_diagram_id,
        task.created_at,
        task.updated_at,
        task.completed_at,
      ],
    );

    // Task groups deliberately reuse the task id. This preserves the mapping
    // without adding another schema column while manual groups keep UUID ids.
    await database.execute(
      `INSERT INTO canvas_groups (id, name, created_at, updated_at)
       VALUES (?, ?, ?, ?)`,
      [task.id, task.title, task.created_at, task.updated_at],
    );

    await database.execute("COMMIT");
  } catch (cause) {
    await database.execute("ROLLBACK");
    throw cause;
  }

  notifyTasksChanged();
  notifyWorkspaceChanged();
  return task;
}

export async function setTaskCompleted(id: string, completed: boolean) {
  const database = await getDatabase();
  const now = Date.now();

  await database.execute(
    `UPDATE tasks
     SET status = ?, completed_at = ?, updated_at = ?
     WHERE id = ?`,
    [completed ? "completed" : "open", completed ? now : null, now, id],
  );
  notifyTasksChanged();
  notifyWorkspaceChanged();
}

export async function setTaskEstimatedMinutes(id: string, minutes: number) {
  const database = await getDatabase();
  await database.execute(
    `UPDATE tasks
     SET estimated_minutes = ?, updated_at = ?
     WHERE id = ?`,
    [Math.max(1, Math.floor(minutes)), Date.now(), id],
  );
}

export async function deleteTask(id: string) {
  const database = await getDatabase();
  await database.execute("DELETE FROM tasks WHERE id = ?", [id]);
  notifyTasksChanged();
}

export async function linkTaskToDiagram(
  taskId: string,
  diagramId: string | null,
) {
  const database = await getDatabase();
  await database.execute(
    `UPDATE tasks
     SET linked_diagram_id = ?, updated_at = ?
     WHERE id = ?`,
    [diagramId, Date.now(), taskId],
  );
}
