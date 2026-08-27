import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Excalidraw, serializeAsJSON } from "@excalidraw/excalidraw";

import {
  assignDiagramToTask,
  createDiagram,
  deleteDiagram,
  listDiagrams,
  renameDiagram,
  saveDiagramScene,
  type DiagramRecord,
} from "./features/diagrams/diagramRepository";
import { deserializeScene } from "./features/diagrams/sceneStorage";
import { FocusTimerDock } from "./features/focus/FocusTimerDock";
import { SessionHistory } from "./features/focus/SessionHistory";
import { useFocusTimer } from "./features/focus/useFocusTimer";
import { TodoPanel } from "./features/tasks/TodoPanel";
import type { TaskRecord } from "./features/tasks/taskRepository";

type View = "workspace" | "editor";
type SaveStatus = "Saved" | "Unsaved" | "Saving…";

type InitialScene = Awaited<ReturnType<typeof deserializeScene>>;

type DiagramGroup = {
  id: string;
  title: string;
  diagrams: DiagramRecord[];
};

const formatUpdatedAt = (timestamp: number) =>
  new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestamp));

export default function App() {
  const [view, setView] = useState<View>("workspace");
  const [diagrams, setDiagrams] = useState<DiagramRecord[]>([]);
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [activeDiagram, setActiveDiagram] = useState<DiagramRecord | null>(null);
  const [initialScene, setInitialScene] = useState<InitialScene | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("Saved");

  const focus = useFocusTimer();
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

  const diagramGroups = useMemo<DiagramGroup[]>(() => {
    const taskIds = new Set(tasks.map((task) => task.id));
    const byTask = new Map<string, DiagramRecord[]>();

    for (const diagram of filteredDiagrams) {
      if (diagram.task_id && taskIds.has(diagram.task_id)) {
        const bucket = byTask.get(diagram.task_id) ?? [];
        bucket.push(diagram);
        byTask.set(diagram.task_id, bucket);
      }
    }

    const grouped = tasks
      .map((task) => ({
        id: task.id,
        title: task.title,
        diagrams: byTask.get(task.id) ?? [],
      }))
      .filter((group) => group.diagrams.length > 0);

    const ungrouped = filteredDiagrams.filter(
      (diagram) => !diagram.task_id || !taskIds.has(diagram.task_id),
    );

    if (ungrouped.length > 0) {
      grouped.push({
        id: "ungrouped",
        title: "Ungrouped",
        diagrams: ungrouped,
      });
    }

    return grouped;
  }, [filteredDiagrams, tasks]);

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

  const handleDiagramTaskChange = useCallback(
    async (diagram: DiagramRecord, taskId: string) => {
      const nextTaskId = taskId || null;

      try {
        const updatedAt = await assignDiagramToTask(diagram.id, nextTaskId);
        setDiagrams((current) =>
          current.map((item) =>
            item.id === diagram.id
              ? { ...item, task_id: nextTaskId, updated_at: updatedAt }
              : item,
          ),
        );
        setActiveDiagram((current) =>
          current?.id === diagram.id
            ? { ...current, task_id: nextTaskId, updated_at: updatedAt }
            : current,
        );
      } catch (cause) {
        console.error(cause);
        setError("Could not move this diagram to the selected task.");
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

  const handleStartFocus = useCallback(
    async (
      taskId: string,
      seconds: number,
      linkedDiagramId: string | null,
    ) => {
      const started = await focus.start(taskId, seconds);
      if (!started || !linkedDiagramId) {
        return;
      }

      const diagram = diagrams.find((item) => item.id === linkedDiagramId);
      if (diagram) {
        await openDiagram(diagram);
      }
    },
    [diagrams, focus.start, openDiagram],
  );

  const timerDock = (
    <FocusTimerDock
      session={focus.session}
      onPause={focus.pause}
      onResume={focus.resume}
      onFinish={focus.finish}
      onCancel={focus.cancel}
    />
  );

  if (view === "workspace") {
    return (
      <>
        <main className="workspace-shell">
          <header className="workspace-header">
            <div>
              <p className="eyebrow">Local workspace</p>
              <h1>FocusCanvas</h1>
              <p className="muted">
                Tasks, focus sessions, and diagrams stay on this device.
              </p>
            </div>
            <button className="primary-button" onClick={handleCreateDiagram}>
              + New diagram
            </button>
          </header>

          {(error || focus.error) && (
            <div className="error-banner">{error ?? focus.error}</div>
          )}

          <section className="dashboard-grid">
            <TodoPanel
              diagrams={diagrams}
              focusActive={Boolean(focus.session)}
              onTasksChange={setTasks}
              onStartFocus={handleStartFocus}
            />
            <SessionHistory revision={focus.historyRevision} />
          </section>

          <div className="section-heading">
            <div>
              <p className="eyebrow">Workspace</p>
              <h2>Diagrams by main task</h2>
            </div>
          </div>

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
            <section className="diagram-groups" aria-label="Diagrams grouped by main task">
              {diagramGroups.map((group) => (
                <section className="diagram-group" key={group.id}>
                  <div className="diagram-group-heading">
                    <h3>{group.title}</h3>
                    <span className="muted">
                      {group.diagrams.length} {group.diagrams.length === 1 ? "diagram" : "diagrams"}
                    </span>
                  </div>

                  <div className="diagram-grid">
                    {group.diagrams.map((diagram) => {
                      const validTaskId = tasks.some(
                        (task) => task.id === diagram.task_id,
                      )
                        ? diagram.task_id ?? ""
                        : "";

                      return (
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
                            <p className="muted">
                              {formatUpdatedAt(diagram.updated_at)}
                            </p>

                            <label className="diagram-task-field">
                              <span>Main task</span>
                              <select
                                value={validTaskId}
                                onChange={(event) =>
                                  void handleDiagramTaskChange(
                                    diagram,
                                    event.target.value,
                                  )
                                }
                                aria-label={`Main task for ${diagram.name}`}
                              >
                                <option value="">Ungrouped</option>
                                {tasks.map((task) => (
                                  <option value={task.id} key={task.id}>
                                    {task.title}
                                  </option>
                                ))}
                              </select>
                            </label>

                            <div className="card-actions">
                              <button onClick={() => void handleRename(diagram)}>
                                Rename
                              </button>
                              <button
                                className="danger-text"
                                onClick={() => void handleDelete(diagram)}
                              >
                                Delete
                              </button>
                            </div>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </section>
              ))}
            </section>
          )}
        </main>
        {timerDock}
      </>
    );
  }

  if (!activeDiagram || !initialScene) {
    return <main className="empty-state">Opening diagram…</main>;
  }

  return (
    <>
      <main className="editor-shell">
        <header className="editor-header">
          <button
            className="text-button"
            onClick={() => void handleBackToWorkspace()}
          >
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
            className={`save-status ${
              saveStatus === "Unsaved" ? "is-unsaved" : ""
            }`}
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
      {timerDock}
    </>
  );
}
