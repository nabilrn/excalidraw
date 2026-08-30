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
  await database.execute("DELETE FROM canvas_groups WHERE id = ?", [id]);
}

export async function createDiagram(
  name = "Untitled diagram",
  taskId: string | null = null,
  groupId: string | null = null,
) {
  const database = await getDatabase();
  const now = Date.now();
  const diagram: DiagramRecord = {
    id: crypto.randomUUID(),
    name,
    scene_data: EMPTY_SCENE,
    task_id: taskId,
    group_id: groupId,
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
