import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Excalidraw, serializeAsJSON } from "@excalidraw/excalidraw";

import {
  createDiagram,
  deleteDiagram,
  listDiagrams,
  renameDiagram,
  saveDiagramScene,
  type DiagramRecord,
} from "./features/diagrams/diagramRepository";
import { deserializeScene } from "./features/diagrams/sceneStorage";

type View = "workspace" | "editor";
type SaveStatus = "Saved" | "Unsaved" | "Saving…";

type InitialScene = Awaited<ReturnType<typeof deserializeScene>>;

const formatUpdatedAt = (timestamp: number) =>
  new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestamp));

export default function App() {
  const [view, setView] = useState<View>("workspace");
  const [diagrams, setDiagrams] = useState<DiagramRecord[]>([]);
  const [activeDiagram, setActiveDiagram] = useState<DiagramRecord | null>(null);
  const [initialScene, setInitialScene] = useState<InitialScene | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("Saved");

  const saveTimerRef = useRef<number | null>(null);
  const latestSceneRef = useRef<string | null>(null);

  const refreshDiagrams = useCallback(async () => {
    try {
      setError(null);
      setDiagrams(await listDiagrams());
    } catch (cause) {
      console.error(cause);
      setError("Could not open the local workspace database.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshDiagrams();
  }, [refreshDiagrams]);

  useEffect(
    () => () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
      }
    },
    [],
  );

  const filteredDiagrams = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) {
      return diagrams;
    }

    return diagrams.filter((diagram) =>
      diagram.name.toLowerCase().includes(query),
    );
  }, [diagrams, search]);

  const openDiagram = useCallback(async (diagram: DiagramRecord) => {
    setLoading(true);
    setError(null);

    try {
      const scene = await deserializeScene(diagram.scene_data);
      latestSceneRef.current = diagram.scene_data;
      setInitialScene(scene);
      setActiveDiagram(diagram);
      setSaveStatus("Saved");
      setView("editor");
    } catch (cause) {
      console.error(cause);
      setError("Could not open this diagram.");
    } finally {
      setLoading(false);
    }
  }, []);

  const handleCreateDiagram = useCallback(async () => {
    try {
      const diagram = await createDiagram();
      setDiagrams((current) => [diagram, ...current]);
      await openDiagram(diagram);
    } catch (cause) {
      console.error(cause);
      setError("Could not create a new diagram.");
    }
  }, [openDiagram]);

  const persistScene = useCallback(
    async (diagramId: string, sceneData: string) => {
      setSaveStatus("Saving…");

      try {
        const updatedAt = await saveDiagramScene(diagramId, sceneData);
        setActiveDiagram((current) =>
          current?.id === diagramId
            ? { ...current, scene_data: sceneData, updated_at: updatedAt }
            : current,
        );
        setSaveStatus("Saved");
      } catch (cause) {
        console.error(cause);
        setSaveStatus("Unsaved");
      }
    },
    [],
  );

  const scheduleAutosave = useCallback(
    (sceneData: string) => {
      if (!activeDiagram) {
        return;
      }

      latestSceneRef.current = sceneData;
      setSaveStatus("Unsaved");

      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
      }

      const diagramId = activeDiagram.id;
      saveTimerRef.current = window.setTimeout(() => {
        saveTimerRef.current = null;
        void persistScene(diagramId, sceneData);
      }, 700);
    },
    [activeDiagram, persistScene],
  );

  const flushAutosave = useCallback(async () => {
    if (!activeDiagram || !latestSceneRef.current) {
      return;
    }

    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }

    if (saveStatus !== "Saved") {
      await persistScene(activeDiagram.id, latestSceneRef.current);
    }
  }, [activeDiagram, persistScene, saveStatus]);

  const handleBackToWorkspace = useCallback(async () => {
    await flushAutosave();
    setView("workspace");
    setActiveDiagram(null);
    setInitialScene(null);
    latestSceneRef.current = null;
    await refreshDiagrams();
  }, [flushAutosave, refreshDiagrams]);

  const handleRename = useCallback(
    async (diagram: DiagramRecord) => {
      const nextName = window.prompt("Diagram name", diagram.name)?.trim();
      if (!nextName || nextName === diagram.name) {
        return;
      }

      try {
        const updatedAt = await renameDiagram(diagram.id, nextName);
        const updateRecord = (item: DiagramRecord) =>
          item.id === diagram.id
            ? { ...item, name: nextName, updated_at: updatedAt }
            : item;

        setDiagrams((current) => current.map(updateRecord));
        setActiveDiagram((current) =>
          current?.id === diagram.id ? updateRecord(current) : current,
        );
      } catch (cause) {
        console.error(cause);
        setError("Could not rename this diagram.");
      }
    },
    [],
  );

  const handleDelete = useCallback(async (diagram: DiagramRecord) => {
    if (!window.confirm(`Delete “${diagram.name}”? This cannot be undone.`)) {
      return;
    }

    try {
      await deleteDiagram(diagram.id);
      setDiagrams((current) =>
        current.filter((item) => item.id !== diagram.id),
      );
    } catch (cause) {
      console.error(cause);
      setError("Could not delete this diagram.");
    }
  }, []);

  if (view === "workspace") {
    return (
      <main className="workspace-shell">
        <header className="workspace-header">
          <div>
            <p className="eyebrow">Local workspace</p>
            <h1>FocusCanvas</h1>
            <p className="muted">Your diagrams stay on this device.</p>
          </div>
          <button className="primary-button" onClick={handleCreateDiagram}>
            + New diagram
          </button>
        </header>

        <section className="workspace-toolbar">
          <input
            className="search-input"
            type="search"
            placeholder="Search diagrams"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <span className="muted">
            {diagrams.length} {diagrams.length === 1 ? "diagram" : "diagrams"}
          </span>
        </section>

        {error && <div className="error-banner">{error}</div>}

        {loading ? (
          <div className="empty-state">Loading workspace…</div>
        ) : filteredDiagrams.length === 0 ? (
          <div className="empty-state">
            <h2>{search ? "No matching diagrams" : "No diagrams yet"}</h2>
            <p>
              {search
                ? "Try another search."
                : "Create your first diagram and it will appear here automatically."}
            </p>
            {!search && (
              <button className="primary-button" onClick={handleCreateDiagram}>
                Create diagram
              </button>
            )}
          </div>
        ) : (
          <section className="diagram-grid" aria-label="Recent diagrams">
            {filteredDiagrams.map((diagram) => (
              <article className="diagram-card" key={diagram.id}>
                <button
                  className="diagram-preview"
                  onClick={() => void openDiagram(diagram)}
                  aria-label={`Open ${diagram.name}`}
                >
                  <span>Open canvas</span>
                </button>
                <div className="diagram-card-body">
                  <button
                    className="diagram-title"
                    onClick={() => void openDiagram(diagram)}
                  >
                    {diagram.name}
                  </button>
                  <p className="muted">{formatUpdatedAt(diagram.updated_at)}</p>
                  <div className="card-actions">
                    <button onClick={() => void handleRename(diagram)}>Rename</button>
                    <button
                      className="danger-text"
                      onClick={() => void handleDelete(diagram)}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </section>
        )}
      </main>
    );
  }

  if (!activeDiagram || !initialScene) {
    return <main className="empty-state">Opening diagram…</main>;
  }

  return (
    <main className="editor-shell">
      <header className="editor-header">
        <button className="text-button" onClick={() => void handleBackToWorkspace()}>
          ← Workspace
        </button>
        <button
          className="editor-title"
          onClick={() => void handleRename(activeDiagram)}
          title="Rename diagram"
        >
          {activeDiagram.name}
        </button>
        <span
          className={`save-status ${saveStatus === "Unsaved" ? "is-unsaved" : ""}`}
        >
          {saveStatus}
        </span>
      </header>

      <section className="canvas-shell">
        <Excalidraw
          key={activeDiagram.id}
          initialData={initialScene}
          name={activeDiagram.name}
          autoFocus={true}
          onChange={(elements, appState, files) => {
            scheduleAutosave(
              serializeAsJSON(elements, appState, files, "local"),
            );
          }}
        />
      </section>
    </main>
  );
}
