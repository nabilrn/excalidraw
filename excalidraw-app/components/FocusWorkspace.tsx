import { useExcalidrawAPI } from "@excalidraw/excalidraw";
import React, { useCallback, useEffect, useMemo, useState } from "react";

import type { AppState, BinaryFiles } from "@excalidraw/excalidraw/types";
import type { OrderedExcalidrawElement } from "@excalidraw/element/types";

import "./FocusWorkspace.scss";

type Task = {
  id: string;
  title: string;
  completed: boolean;
  createdAt: number;
};

type FocusSession = {
  id: string;
  taskId: string | null;
  taskTitle: string | null;
  durationSeconds: number;
  completedAt: number;
};

type TimerState = {
  durationSeconds: number;
  remainingSeconds: number;
  endsAt: number | null;
  running: boolean;
};

type DiagramSnapshot = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  elements: readonly OrderedExcalidrawElement[];
  files: BinaryFiles;
  appState: Pick<
    AppState,
    "viewBackgroundColor" | "gridSize" | "gridStep" | "gridModeEnabled"
  >;
};

type DiagramMeta = Pick<DiagramSnapshot, "id" | "name" | "createdAt" | "updatedAt">;

type WorkspaceState = {
  tasks: Task[];
  sessions: FocusSession[];
  selectedTaskId: string | null;
  timer: TimerState;
};

const WORKSPACE_STORAGE_KEY = "excalidraw-focus-workspace-v1";
const DB_NAME = "excalidraw-focus-workspace";
const DB_VERSION = 1;
const DIAGRAM_STORE = "diagrams";
const DEFAULT_DURATION_SECONDS = 25 * 60;

const createId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

const DEFAULT_STATE: WorkspaceState = {
  tasks: [],
  sessions: [],
  selectedTaskId: null,
  timer: {
    durationSeconds: DEFAULT_DURATION_SECONDS,
    remainingSeconds: DEFAULT_DURATION_SECONDS,
    endsAt: null,
    running: false,
  },
};

const readWorkspaceState = (): WorkspaceState => {
  try {
    const raw = window.localStorage.getItem(WORKSPACE_STORAGE_KEY);
    if (!raw) {
      return DEFAULT_STATE;
    }

    const parsed = JSON.parse(raw) as Partial<WorkspaceState>;
    return {
      tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
      selectedTaskId: parsed.selectedTaskId ?? null,
      timer: {
        ...DEFAULT_STATE.timer,
        ...(parsed.timer ?? {}),
      },
    };
  } catch {
    return DEFAULT_STATE;
  }
};

const openDiagramDb = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DIAGRAM_STORE)) {
        db.createObjectStore(DIAGRAM_STORE, { keyPath: "id" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const withDiagramStore = async <T,>(
  mode: IDBTransactionMode,
  callback: (store: IDBObjectStore) => IDBRequest<T>,
) => {
  const db = await openDiagramDb();

  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(DIAGRAM_STORE, mode);
      const request = callback(transaction.objectStore(DIAGRAM_STORE));

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
};

const listDiagrams = async (): Promise<DiagramMeta[]> => {
  const diagrams = await withDiagramStore<DiagramSnapshot[]>("readonly", (store) =>
    store.getAll(),
  );

  return diagrams
    .map(({ id, name, createdAt, updatedAt }) => ({
      id,
      name,
      createdAt,
      updatedAt,
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
};

const formatTime = (seconds: number) => {
  const safeSeconds = Math.max(0, seconds);
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(
    2,
    "0",
  )}`;
};

const FocusWorkspace = () => {
  const excalidrawAPI = useExcalidrawAPI();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"tasks" | "diagrams">("tasks");
  const [state, setState] = useState<WorkspaceState>(() => readWorkspaceState());
  const [taskTitle, setTaskTitle] = useState("");
  const [timerMinutes, setTimerMinutes] = useState(25);
  const [diagramName, setDiagramName] = useState("");
  const [diagrams, setDiagrams] = useState<DiagramMeta[]>([]);
  const [diagramStatus, setDiagramStatus] = useState<string | null>(null);

  const selectedTask = useMemo(
    () => state.tasks.find((task) => task.id === state.selectedTaskId) ?? null,
    [state.selectedTaskId, state.tasks],
  );

  const refreshDiagrams = useCallback(async () => {
    try {
      setDiagrams(await listDiagrams());
    } catch {
      setDiagramStatus("Could not read local diagrams.");
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  useEffect(() => {
    void refreshDiagrams();
  }, [refreshDiagrams]);

  useEffect(() => {
    if (!state.timer.running || !state.timer.endsAt) {
      return undefined;
    }

    const tick = () => {
      setState((current) => {
        if (!current.timer.running || !current.timer.endsAt) {
          return current;
        }

        const remainingSeconds = Math.max(
          0,
          Math.ceil((current.timer.endsAt - Date.now()) / 1000),
        );

        if (remainingSeconds > 0) {
          return {
            ...current,
            timer: { ...current.timer, remainingSeconds },
          };
        }

        const task =
          current.tasks.find((item) => item.id === current.selectedTaskId) ?? null;
        const session: FocusSession = {
          id: createId(),
          taskId: task?.id ?? null,
          taskTitle: task?.title ?? null,
          durationSeconds: current.timer.durationSeconds,
          completedAt: Date.now(),
        };

        return {
          ...current,
          sessions: [session, ...current.sessions].slice(0, 100),
          timer: {
            ...current.timer,
            remainingSeconds: current.timer.durationSeconds,
            endsAt: null,
            running: false,
          },
        };
      });
    };

    tick();
    const interval = window.setInterval(tick, 1000);
    return () => window.clearInterval(interval);
  }, [state.timer.endsAt, state.timer.running]);

  const addTask = () => {
    const title = taskTitle.trim();
    if (!title) {
      return;
    }

    const task: Task = {
      id: createId(),
      title,
      completed: false,
      createdAt: Date.now(),
    };

    setState((current) => ({
      ...current,
      tasks: [task, ...current.tasks],
      selectedTaskId: current.selectedTaskId ?? task.id,
    }));
    setTaskTitle("");
  };

  const toggleTask = (id: string) => {
    setState((current) => ({
      ...current,
      tasks: current.tasks.map((task) =>
        task.id === id ? { ...task, completed: !task.completed } : task,
      ),
    }));
  };

  const deleteTask = (id: string) => {
    setState((current) => ({
      ...current,
      tasks: current.tasks.filter((task) => task.id !== id),
      selectedTaskId:
        current.selectedTaskId === id ? null : current.selectedTaskId,
    }));
  };

  const setDuration = (minutes: number) => {
    const safeMinutes = Math.min(180, Math.max(1, Math.round(minutes || 1)));
    const durationSeconds = safeMinutes * 60;
    setTimerMinutes(safeMinutes);
    setState((current) => ({
      ...current,
      timer: {
        durationSeconds,
        remainingSeconds: durationSeconds,
        endsAt: null,
        running: false,
      },
    }));
  };

  const toggleTimer = () => {
    setState((current) => {
      if (current.timer.running) {
        const remainingSeconds = current.timer.endsAt
          ? Math.max(0, Math.ceil((current.timer.endsAt - Date.now()) / 1000))
          : current.timer.remainingSeconds;
        return {
          ...current,
          timer: {
            ...current.timer,
            remainingSeconds,
            endsAt: null,
            running: false,
          },
        };
      }

      return {
        ...current,
        timer: {
          ...current.timer,
          endsAt: Date.now() + current.timer.remainingSeconds * 1000,
          running: true,
        },
      };
    });
  };

  const resetTimer = () => {
    setState((current) => ({
      ...current,
      timer: {
        ...current.timer,
        remainingSeconds: current.timer.durationSeconds,
        endsAt: null,
        running: false,
      },
    }));
  };

  const saveDiagram = async () => {
    const name = diagramName.trim();
    if (!name) {
      setDiagramStatus("Give the diagram a name first.");
      return;
    }

    try {
      const existing = diagrams.find(
        (diagram) => diagram.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
      );
      const now = Date.now();
      const appState = excalidrawAPI.getAppState();
      const snapshot: DiagramSnapshot = {
        id: existing?.id ?? createId(),
        name,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        elements: excalidrawAPI.getSceneElementsIncludingDeleted(),
        files: excalidrawAPI.getFiles(),
        appState: {
          viewBackgroundColor: appState.viewBackgroundColor,
          gridSize: appState.gridSize,
          gridStep: appState.gridStep,
          gridModeEnabled: appState.gridModeEnabled,
        },
      };

      await withDiagramStore("readwrite", (store) => store.put(snapshot));
      setDiagramName("");
      setDiagramStatus(existing ? "Diagram updated locally." : "Diagram saved locally.");
      await refreshDiagrams();
    } catch {
      setDiagramStatus("Could not save this diagram locally.");
    }
  };

  const loadDiagram = async (id: string) => {
    try {
      const snapshot = await withDiagramStore<DiagramSnapshot>("readonly", (store) =>
        store.get(id),
      );
      if (!snapshot) {
        setDiagramStatus("Diagram not found.");
        return;
      }

      excalidrawAPI.addFiles(Object.values(snapshot.files));
      excalidrawAPI.updateScene({
        elements: snapshot.elements,
        appState: snapshot.appState,
      });
      setDiagramStatus(`Loaded ${snapshot.name}.`);
      setOpen(false);
    } catch {
      setDiagramStatus("Could not load this diagram.");
    }
  };

  const deleteDiagram = async (id: string) => {
    try {
      await withDiagramStore("readwrite", (store) => store.delete(id));
      setDiagramStatus("Diagram deleted.");
      await refreshDiagrams();
    } catch {
      setDiagramStatus("Could not delete this diagram.");
    }
  };

  const totalFocusSeconds = state.sessions.reduce(
    (total, session) => total + session.durationSeconds,
    0,
  );

  return (
    <div className="focus-workspace" data-open={open}>
      <button
        className="focus-workspace__launcher"
        type="button"
        title="Focus workspace"
        aria-label="Open focus workspace"
        onClick={() => setOpen((current) => !current)}
      >
        {state.timer.running ? formatTime(state.timer.remainingSeconds) : "Focus"}
      </button>

      {open && (
        <aside className="focus-workspace__panel" aria-label="Focus workspace">
          <header className="focus-workspace__header">
            <div>
              <strong>Focus workspace</strong>
              <span>Local only</span>
            </div>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close">
              ×
            </button>
          </header>

          <div className="focus-workspace__tabs">
            <button
              type="button"
              data-active={tab === "tasks"}
              onClick={() => setTab("tasks")}
            >
              Tasks & timer
            </button>
            <button
              type="button"
              data-active={tab === "diagrams"}
              onClick={() => setTab("diagrams")}
            >
              Diagrams
            </button>
          </div>

          {tab === "tasks" ? (
            <div className="focus-workspace__content">
              <section className="focus-workspace__timer">
                <span className="focus-workspace__eyebrow">
                  {selectedTask ? selectedTask.title : "No task selected"}
                </span>
                <div className="focus-workspace__clock">
                  {formatTime(state.timer.remainingSeconds)}
                </div>
                <div className="focus-workspace__timer-actions">
                  <button type="button" onClick={toggleTimer}>
                    {state.timer.running ? "Pause" : "Start"}
                  </button>
                  <button type="button" onClick={resetTimer}>
                    Reset
                  </button>
                </div>
                <div className="focus-workspace__presets">
                  {[25, 45, 60].map((minutes) => (
                    <button key={minutes} type="button" onClick={() => setDuration(minutes)}>
                      {minutes}m
                    </button>
                  ))}
                  <label>
                    <input
                      type="number"
                      min={1}
                      max={180}
                      value={timerMinutes}
                      onChange={(event) => setTimerMinutes(Number(event.target.value))}
                      onBlur={() => setDuration(timerMinutes)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          setDuration(timerMinutes);
                        }
                      }}
                    />
                    min
                  </label>
                </div>
              </section>

              <section>
                <div className="focus-workspace__section-title">
                  <strong>Tasks</strong>
                  <span>{Math.round(totalFocusSeconds / 60)} focused min</span>
                </div>
                <div className="focus-workspace__add-row">
                  <input
                    type="text"
                    value={taskTitle}
                    placeholder="Add a task"
                    onChange={(event) => setTaskTitle(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        addTask();
                      }
                    }}
                  />
                  <button type="button" onClick={addTask}>
                    Add
                  </button>
                </div>
                <div className="focus-workspace__list">
                  {state.tasks.length === 0 && (
                    <p className="focus-workspace__empty">No tasks yet.</p>
                  )}
                  {state.tasks.map((task) => (
                    <div
                      className="focus-workspace__task"
                      data-selected={task.id === state.selectedTaskId}
                      key={task.id}
                    >
                      <input
                        type="checkbox"
                        checked={task.completed}
                        onChange={() => toggleTask(task.id)}
                      />
                      <button
                        className="focus-workspace__task-title"
                        data-completed={task.completed}
                        type="button"
                        onClick={() =>
                          setState((current) => ({
                            ...current,
                            selectedTaskId: task.id,
                          }))
                        }
                      >
                        {task.title}
                      </button>
                      <button
                        className="focus-workspace__delete"
                        type="button"
                        aria-label={`Delete ${task.title}`}
                        onClick={() => deleteTask(task.id)}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          ) : (
            <div className="focus-workspace__content">
              <section>
                <div className="focus-workspace__section-title">
                  <strong>Save current canvas</strong>
                  <span>IndexedDB</span>
                </div>
                <div className="focus-workspace__add-row">
                  <input
                    type="text"
                    value={diagramName}
                    placeholder="Diagram name"
                    onChange={(event) => setDiagramName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        void saveDiagram();
                      }
                    }}
                  />
                  <button type="button" onClick={() => void saveDiagram()}>
                    Save
                  </button>
                </div>
                {diagramStatus && (
                  <p className="focus-workspace__status">{diagramStatus}</p>
                )}
              </section>

              <section>
                <div className="focus-workspace__section-title">
                  <strong>Saved diagrams</strong>
                  <span>{diagrams.length}</span>
                </div>
                <div className="focus-workspace__list">
                  {diagrams.length === 0 && (
                    <p className="focus-workspace__empty">
                      Save a canvas to create your first local diagram.
                    </p>
                  )}
                  {diagrams.map((diagram) => (
                    <div className="focus-workspace__diagram" key={diagram.id}>
                      <button
                        className="focus-workspace__diagram-title"
                        type="button"
                        onClick={() => void loadDiagram(diagram.id)}
                      >
                        <strong>{diagram.name}</strong>
                        <span>{new Date(diagram.updatedAt).toLocaleString()}</span>
                      </button>
                      <button
                        className="focus-workspace__delete"
                        type="button"
                        aria-label={`Delete ${diagram.name}`}
                        onClick={() => void deleteDiagram(diagram.id)}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          )}
        </aside>
      )}
    </div>
  );
};

export default React.memo(FocusWorkspace);
