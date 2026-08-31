import { getDatabase } from "../../lib/db";

export type DiagramRecord = {
  id: string;
  name: string;
  scene_data: string;
  task_id: string | null;
  group_id: string | null;
  created_at: number;
  updated_at: number;
};

export type CanvasGroupRecord = {
  id: string;
  name: string;
  created_at: number;
  updated_at: number;
};

const EMPTY_SCENE = JSON.stringify({
  type: "excalidraw",
  version: 2,
  source: "focuscanvas",
  elements: [],
  appState: {},
  files: {},
});

export async function listDiagrams(): Promise<DiagramRecord[]> {
  const database = await getDatabase();
  return database.select<DiagramRecord[]>(
    `SELECT id, name, scene_data, task_id, group_id, created_at, updated_at
     FROM diagrams
     ORDER BY updated_at DESC`,
  );
}

export async function listCanvasGroups(): Promise<CanvasGroupRecord[]> {
  const database = await getDatabase();

  // Every task owns a matching canvas group. INSERT OR IGNORE keeps manually
  // renamed task groups intact while backfilling groups from older workspaces
  // and restored Drive snapshots that predate this behavior.
  await database.execute(
    `INSERT OR IGNORE INTO canvas_groups (id, name, created_at, updated_at)
     SELECT id, title, created_at, updated_at
     FROM tasks`,
  );

  return database.select<CanvasGroupRecord[]>(
    `SELECT id, name, created_at, updated_at
     FROM canvas_groups
     ORDER BY created_at ASC`,
  );
}

export async function createCanvasGroup(name: string): Promise<CanvasGroupRecord> {
  const database = await getDatabase();
  const now = Date.now();
  const group: CanvasGroupRecord = {
    id: crypto.randomUUID(),
    name: name.trim() || "New group",
    created_at: now,
    updated_at: now,
  };

  await database.execute(
    `INSERT INTO canvas_groups (id, name, created_at, updated_at)
     VALUES (?, ?, ?, ?)`,
    [group.id, group.name, group.created_at, group.updated_at],
  );

  return group;
}

export async function renameCanvasGroup(id: string, name: string) {
  const database = await getDatabase();
  const updatedAt = Date.now();

  await database.execute(
    `UPDATE canvas_groups SET name = ?, updated_at = ? WHERE id = ?`,
    [name.trim(), updatedAt, id],
  );

  return updatedAt;
}

export async function deleteCanvasGroup(id: string) {
  const database = await getDatabase();
  const linkedTask = await database.select<{ id: string }[]>(
    "SELECT id FROM tasks WHERE id = ? LIMIT 1",
    [id],
  );

  if (linkedTask.length > 0) {
    throw new Error(
      "This group belongs to a task and is created automatically. Delete the task instead.",
    );
  }

  await database.execute(
    "UPDATE diagrams SET group_id = NULL, updated_at = ? WHERE group_id = ?",
    [Date.now(), id],
  );
  await database.execute("DELETE FROM canvas_groups WHERE id = ?", [id]);
}

export async function createDiagram(
  name = "Untitled diagram",
  taskId: string | null = null,
  groupId: string | null = null,
) {
  const database = await getDatabase();
  const now = Date.now();
  let resolvedTaskId = taskId;
  let resolvedGroupId = groupId;

  if (groupId) {
    const taskGroup = await database.select<{ id: string }[]>(
      "SELECT id FROM tasks WHERE id = ? LIMIT 1",
      [groupId],
    );
    if (taskGroup.length > 0) {
      resolvedTaskId = groupId;
    }
  } else if (taskId) {
    // Creating a canvas while a task is active places it in that task's group.
    resolvedGroupId = taskId;
  }

  if (resolvedGroupId && resolvedGroupId === resolvedTaskId) {
    await database.execute(
      `INSERT OR IGNORE INTO canvas_groups (id, name, created_at, updated_at)
       SELECT id, title, created_at, updated_at
       FROM tasks
       WHERE id = ?`,
      [resolvedGroupId],
    );
  }

  const diagram: DiagramRecord = {
    id: crypto.randomUUID(),
    name,
    scene_data: EMPTY_SCENE,
    task_id: resolvedTaskId,
    group_id: resolvedGroupId,
    created_at: now,
    updated_at: now,
  };

  await database.execute(
    `INSERT INTO diagrams (
       id, name, scene_data, task_id, group_id, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      diagram.id,
      diagram.name,
      diagram.scene_data,
      diagram.task_id,
      diagram.group_id,
      now,
      now,
    ],
  );

  return diagram;
}

export async function saveDiagramScene(id: string, sceneData: string) {
  const database = await getDatabase();
  const updatedAt = Date.now();

  await database.execute(
    `UPDATE diagrams
     SET scene_data = ?, updated_at = ?
     WHERE id = ?`,
    [sceneData, updatedAt, id],
  );

  return updatedAt;
}

export async function renameDiagram(id: string, name: string) {
  const database = await getDatabase();
  const updatedAt = Date.now();

  await database.execute(
    `UPDATE diagrams
     SET name = ?, updated_at = ?
     WHERE id = ?`,
    [name, updatedAt, id],
  );

  return updatedAt;
}

export async function assignDiagramToTask(
  id: string,
  taskId: string | null,
) {
  const database = await getDatabase();
  const updatedAt = Date.now();

  await database.execute(
    `UPDATE diagrams
     SET task_id = ?, updated_at = ?
     WHERE id = ?`,
    [taskId, updatedAt, id],
  );

  return updatedAt;
}

export async function assignDiagramToGroup(
  id: string,
  groupId: string | null,
) {
  const database = await getDatabase();
  const updatedAt = Date.now();

  if (groupId) {
    const taskGroup = await database.select<{ id: string }[]>(
      "SELECT id FROM tasks WHERE id = ? LIMIT 1",
      [groupId],
    );
    if (taskGroup.length > 0) {
      await database.execute(
        `UPDATE diagrams
         SET group_id = ?, task_id = ?, updated_at = ?
         WHERE id = ?`,
        [groupId, groupId, updatedAt, id],
      );
      return updatedAt;
    }
  }

  await database.execute(
    `UPDATE diagrams
     SET group_id = ?, updated_at = ?
     WHERE id = ?`,
    [groupId, updatedAt, id],
  );

  return updatedAt;
}

export async function deleteDiagram(id: string) {
  const database = await getDatabase();
  await database.execute("DELETE FROM diagrams WHERE id = ?", [id]);
}
