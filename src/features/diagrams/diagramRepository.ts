import { getDatabase } from "../../lib/db";

export type DiagramRecord = {
  id: string;
  name: string;
  scene_data: string;
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
    `SELECT id, name, scene_data, created_at, updated_at
     FROM diagrams
     ORDER BY updated_at DESC`,
  );
}

export async function createDiagram(name = "Untitled diagram") {
  const database = await getDatabase();
  const now = Date.now();
  const diagram: DiagramRecord = {
    id: crypto.randomUUID(),
    name,
    scene_data: EMPTY_SCENE,
    created_at: now,
    updated_at: now,
  };

  await database.execute(
    `INSERT INTO diagrams (id, name, scene_data, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
    [diagram.id, diagram.name, diagram.scene_data, now, now],
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

export async function deleteDiagram(id: string) {
  const database = await getDatabase();
  await database.execute("DELETE FROM diagrams WHERE id = ?", [id]);
}
