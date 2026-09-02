import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Excalidraw, serializeAsJSON } from "@excalidraw/excalidraw";

import { ConfirmDialog } from "./components/ConfirmDialog";
import {
  assignDiagramToGroup,
  createCanvasGroup,
  createDiagram,
  deleteCanvasGroup,
  deleteDiagram,
  listCanvasGroups,
  listDiagrams,
  renameCanvasGroup,
  renameDiagram,
  saveDiagramScene,
  type CanvasGroupRecord,
  type DiagramRecord,
} from "./features/diagrams/diagramRepository";
import { deserializeScene } from "./features/diagrams/sceneStorage";
import { FocusTimerDock } from "./features/focus/FocusTimerDock";
import {
  getElapsedSeconds,
  listRecentFocusSessions,
  type FocusSessionRecord,
} from "./features/focus/focusRepository";
import { useFocusTimer } from "./features/focus/useFocusTimer";
import {
  createTask,
  deleteTask,
  listTasks,
  setTaskCompleted,
  setTaskEstimatedMinutes,
  type TaskRecord,
} from "./features/tasks/taskRepository";
import "./workspaceEnhancements.css";

type View = "workspace" | "editor";
type WorkspaceTab = "tasks" | "canvases";
type SaveStatus = "Saved" | "Unsaved" | "Saving…";
type InitialScene = Awaited<ReturnType<typeof deserializeScene>>;

type DiagramGroup = {
  id: string | null;
  name: string;
  diagrams: DiagramRecord[];
};

type ConfirmationRequest = {
  title: string;
  message: string;
  confirmLabel: string;
  run: () => Promise<void>;
};

const clampMinutes = (value: number) =>
  Math.max(1, Math.min(999, Math.floor(value || 1)));

const formatTimer = (seconds: number) => {
  const safe = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safe / 60);
  const remainder = safe % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
};

const formatShortDate = (timestamp: number) =>
  new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(new Date(timestamp));

const formatClock = (timestamp: number) =>
  new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));

function SketchThumbnail() {
  return (
    <svg viewBox="0 0 150 84" aria-hidden="true">
      <rect x="12" y="11" width="44" height="25" rx="3" />
      <path d="M76 11 94 24 76 37 58 24Z" />
      <rect x="97" y="50" width="38" height="20" rx="3" />
      <path d="M34 36v20h63" />
      <path d="M76 37v13" />
      <path d="m31 52 4 4 4-4" />
      <path d="m93 47 4 4 4-4" />
      <path d="M18 68h55" />
    </svg>
  );
}

export default function App() {
  const [view, setView] = useState<View>("workspace");
  const [tab, setTab] = useState<WorkspaceTab>("tasks");
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [diagrams, setDiagrams] = useState<DiagramRecord[]>([]);
  const [canvasGroups, setCanvasGroups] = useState<CanvasGroupRecord[]>([]);
  const [sessions, setSessions] = useState<FocusSessionRecord[]>([]);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [activeDiagram, setActiveDiagram] = useState<DiagramRecord | null>(null);
  const [initialScene, setInitialScene] = useState<InitialScene | null>(null);
  const [search, setSearch] = useState("");
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskMinutes, setNewTaskMinutes] = useState(45);
  const [showGroupComposer, setShowGroupComposer] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editingGroupName, setEditingGroupName] = useState("");
  const [editingDiagramId, setEditingDiagramId] = useState<string | null>(null);
  const [editingDiagramName, setEditingDiagramName] = useState("");
  const [confirmation, setConfirmation] =
    useState<ConfirmationRequest | null>(null);
  const [confirmationBusy, setConfirmationBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("Saved");
  const [now, setNow] = useState(Date.now());

  const focus = useFocusTimer();
  const saveTimerRef = useRef<number | null>(null);
  const latestSceneRef = useRef<string | null>(null);
  const adoptedSessionRef = useRef(false);

  const refreshWorkspace = useCallback(async () => {
    try {
      setError(null);
      const [nextTasks, nextDiagrams, nextGroups, nextSessions] =
        await Promise.all([
          listTasks(),
          listDiagrams(),
          listCanvasGroups(),
          listRecentFocusSessions(100),
        ]);
      setTasks(nextTasks);
      setDiagrams(nextDiagrams);
      setCanvasGroups(nextGroups);
      setSessions(nextSessions);
    } catch (cause) {
      console.error(cause);
      setError("Could not open the local workspace database.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshWorkspace();
  }, [refreshWorkspace]);

  useEffect(() => {
    const handleWorkspaceSynced = () => void refreshWorkspace();
    window.addEventListener("focuscanvas:workspace-synced", handleWorkspaceSynced);
    return () =>
      window.removeEventListener(
        "focuscanvas:workspace-synced",
        handleWorkspaceSynced,
      );
  }, [refreshWorkspace]);

  useEffect(() => {
    if (focus.historyRevision > 0) {
      void listRecentFocusSessions(100).then(setSessions).catch(console.error);
    }
  }, [focus.historyRevision]);

  useEffect(() => {
    if (
      !adoptedSessionRef.current &&
      focus.session?.task_id &&
      tasks.some((task) => task.id === focus.session?.task_id)
    ) {
      adoptedSessionRef.current = true;
      setFocusId(focus.session.task_id);
    }
  }, [focus.session, tasks]);

  useEffect(() => {
    if (!focus.session || focus.session.status !== "running") {
      return;
    }

    setNow(Date.now());
    const interval = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(interval);
  }, [focus.session]);

  useEffect(
    () => () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
      }
    },
    [],
  );

  const activeTask = useMemo(
    () => tasks.find((task) => task.id === focusId) ?? null,
    [focusId, tasks],
  );

  const timerTask = useMemo(
    () =>
      focus.session?.task_id
        ? tasks.find((task) => task.id === focus.session?.task_id) ?? activeTask
        : activeTask,
    [activeTask, focus.session?.task_id, tasks],
  );

  const doneCount = tasks.filter((task) => task.status === "completed").length;
  const openCount = tasks.length - doneCount;
  const progressPercent =
    tasks.length === 0 ? 0 : Math.round((doneCount / tasks.length) * 100);

  const activeTaskDiagrams = useMemo(
    () =>
      activeTask
        ? diagrams.filter((diagram) => diagram.task_id === activeTask.id)
        : [],
    [activeTask, diagrams],
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
    const groups: DiagramGroup[] = canvasGroups.map((group) => ({
      id: group.id,
      name: group.name,
      diagrams: filteredDiagrams.filter(
        (diagram) => diagram.group_id === group.id,
      ),
    }));

    groups.push({
      id: null,
      name: "Ungrouped",
      diagrams: filteredDiagrams.filter((diagram) => !diagram.group_id),
    });

    return groups;
  }, [canvasGroups, filteredDiagrams]);

  const totalFocusedMinutes = Math.round(
    sessions.reduce((sum, session) => sum + session.actual_seconds, 0) / 60,
  );

  const remainingSeconds = useMemo(() => {
    if (focus.session) {
      return Math.max(
        0,
        focus.session.planned_seconds - getElapsedSeconds(focus.session, now),
      );
    }
    return (timerTask?.estimated_minutes ?? 0) * 60;
  }, [focus.session, now, timerTask]);

  useEffect(() => {
    if (focus.session?.status === "running" && remainingSeconds <= 0) {
      void focus.finish();
    }
  }, [focus.finish, focus.session?.status, remainingSeconds]);

  const runConfirmation = useCallback(async () => {
    if (!confirmation || confirmationBusy) {
      return;
    }
    setConfirmationBusy(true);
    try {
      await confirmation.run();
      setConfirmation(null);
    } catch (cause) {
      console.error(cause);
      setError(cause instanceof Error ? cause.message : "Could not complete action.");
    } finally {
      setConfirmationBusy(false);
    }
  }, [confirmation, confirmationBusy]);

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
      setError("Could not open this canvas.");
    } finally {
      setLoading(false);
    }
  }, []);

  const handleCreateTask = useCallback(async () => {
    const title = newTaskTitle.trim();
    if (!title) {
      return;
    }

    try {
      const task = await createTask(title, clampMinutes(newTaskMinutes));
      setTasks((current) => [task, ...current]);
      setNewTaskTitle("");
      setFocusId(task.id);
      setTab("tasks");
    } catch (cause) {
      console.error(cause);
      setError("Could not create task.");
    }
  }, [newTaskMinutes, newTaskTitle]);

  const handleToggleTask = useCallback(async (task: TaskRecord) => {
    const completed = task.status !== "completed";
    try {
      await setTaskCompleted(task.id, completed);
      setTasks((current) =>
        current.map((item) =>
          item.id === task.id
            ? {
                ...item,
                status: completed ? "completed" : "open",
                completed_at: completed ? Date.now() : null,
              }
            : item,
        ),
      );
    } catch (cause) {
      console.error(cause);
      setError("Could not update task.");
    }
  }, []);

  const handleDeleteTask = useCallback((task: TaskRecord) => {
    setConfirmation({
      title: `Delete “${task.title}”?`,
      message:
        "The task will be deleted. Its canvases stay in the workspace and keep their canvas groups.",
      confirmLabel: "Delete task",
      run: async () => {
        await deleteTask(task.id);
        setTasks((current) => current.filter((item) => item.id !== task.id));
        setDiagrams((current) =>
          current.map((diagram) =>
            diagram.task_id === task.id ? { ...diagram, task_id: null } : diagram,
          ),
        );
        setFocusId((current) => (current === task.id ? null : current));
      },
    });
  }, []);

  const handleTaskMinutes = useCallback(
    async (task: TaskRecord, minutes: number) => {
      const next = clampMinutes(minutes);
      try {
        await setTaskEstimatedMinutes(task.id, next);
        setTasks((current) =>
          current.map((item) =>
            item.id === task.id
              ? { ...item, estimated_minutes: next }
              : item,
          ),
        );
      } catch (cause) {
        console.error(cause);
        setError("Could not update duration.");
      }
    },
    [],
  );

  const handleCreateDiagram = useCallback(
    async (groupId: string | null = null, taskId: string | null = focusId) => {
      try {
        const diagram = await createDiagram(
          "Untitled canvas",
          taskId,
          groupId,
        );
        setDiagrams((current) => [diagram, ...current]);
        await openDiagram(diagram);
      } catch (cause) {
        console.error(cause);
        setError("Could not create a new canvas.");
      }
    },
    [focusId, openDiagram],
  );

  const handleCreateGroup = useCallback(async () => {
    const name = newGroupName.trim();
    if (!name) {
      return;
    }
    try {
      const group = await createCanvasGroup(name);
      setCanvasGroups((current) => [...current, group]);
      setNewGroupName("");
      setShowGroupComposer(false);
    } catch (cause) {
      console.error(cause);
      setError("Could not create canvas group.");
    }
  }, [newGroupName]);

  const commitGroupRename = useCallback(
    async (groupId: string) => {
      const nextName = editingGroupName.trim();
      setEditingGroupId(null);
      if (!nextName) {
        return;
      }
      const current = canvasGroups.find((group) => group.id === groupId);
      if (!current || current.name === nextName) {
        return;
      }
      try {
        const updatedAt = await renameCanvasGroup(groupId, nextName);
        setCanvasGroups((groups) =>
          groups.map((group) =>
            group.id === groupId
              ? { ...group, name: nextName, updated_at: updatedAt }
              : group,
          ),
        );
      } catch (cause) {
        console.error(cause);
        setError("Could not rename canvas group.");
      }
    },
    [canvasGroups, editingGroupName],
  );

  const handleDeleteGroup = useCallback((group: CanvasGroupRecord) => {
    setConfirmation({
      title: `Delete group “${group.name}”?`,
      message:
        "The group will be removed. Canvases inside it will move to Ungrouped and will not be deleted.",
      confirmLabel: "Delete group",
      run: async () => {
        await deleteCanvasGroup(group.id);
        setCanvasGroups((current) =>
          current.filter((item) => item.id !== group.id),
        );
        setDiagrams((current) =>
          current.map((diagram) =>
            diagram.group_id === group.id ? { ...diagram, group_id: null } : diagram,
          ),
        );
      },
    });
  }, []);

  const handleAssignDiagram = useCallback(
    async (diagram: DiagramRecord, groupId: string) => {
      const nextGroupId = groupId || null;
      try {
        const updatedAt = await assignDiagramToGroup(diagram.id, nextGroupId);
        setDiagrams((current) =>
          current.map((item) =>
            item.id === diagram.id
              ? { ...item, group_id: nextGroupId, updated_at: updatedAt }
              : item,
          ),
        );
      } catch (cause) {
        console.error(cause);
        setError("Could not move canvas.");
      }
    },
    [],
  );

  const commitDiagramRename = useCallback(
    async (diagram: DiagramRecord) => {
      const nextName = editingDiagramName.trim();
      setEditingDiagramId(null);
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
        setError("Could not rename canvas.");
      }
    },
    [editingDiagramName],
  );

  const handleDeleteDiagram = useCallback((diagram: DiagramRecord) => {
    setConfirmation({
      title: `Delete “${diagram.name}”?`,
      message: "This canvas and its drawing data will be permanently deleted.",
      confirmLabel: "Delete canvas",
      run: async () => {
        await deleteDiagram(diagram.id);
        setDiagrams((current) =>
          current.filter((item) => item.id !== diagram.id),
        );
      },
    });
  }, []);

  const handleStartFocus = useCallback(async () => {
    if (!activeTask || focus.session) {
      return;
    }
    const started = await focus.start(
      activeTask.id,
      clampMinutes(activeTask.estimated_minutes ?? 45) * 60,
    );
    if (started) {
      setNow(Date.now());
    }
  }, [activeTask, focus.session, focus.start]);

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
    await refreshWorkspace();
  }, [flushAutosave, refreshWorkspace]);

  if (view === "editor") {
    if (!activeDiagram || !initialScene) {
      return <main className="editor-loading">Opening canvas…</main>;
    }

    return (
      <>
        <main className="editor-shell">
          <header className="editor-header">
            <button
              className="editor-back"
              onClick={() => void handleBackToWorkspace()}
            >
              ← Workspace
            </button>
            <strong>{activeDiagram.name}</strong>
            <span className="editor-save">{saveStatus}</span>
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
        <FocusTimerDock
          session={focus.session}
          onPause={focus.pause}
          onResume={focus.resume}
          onFinish={focus.finish}
          onCancel={focus.cancel}
        />
      </>
    );
  }

  return (
    <>
      <main className="desktop-app">
        <header className="topbar">
          <div className="brand">FocusCanvas</div>
          <nav className="top-tabs" aria-label="Workspace sections">
            {(["tasks", "canvases"] as WorkspaceTab[]).map((item) => (
              <button
                className={tab === item ? "is-active" : ""}
                key={item}
                onClick={() => setTab(item)}
              >
                {item === "tasks" ? "Tasks" : "Canvases"}
              </button>
            ))}
          </nav>
          <div className="topbar-actions">
            <span>local workspace</span>
            <button
              className="primary-compact"
              onClick={() => void handleCreateDiagram(null)}
            >
              + New canvas
            </button>
          </div>
        </header>

        {(error || focus.error) && (
          <div className="desktop-error">{error ?? focus.error}</div>
        )}

        <div className="desktop-body">
          <aside className="left-sidebar">
            <div className="sidebar-heading">
              <span>TASKS</span>
              <span>{openCount} open</span>
            </div>

            <div className="task-scroll">
              {loading ? (
                <div className="sidebar-empty">loading…</div>
              ) : tasks.length === 0 ? (
                <div className="sidebar-empty">no tasks yet</div>
              ) : (
                tasks.map((task) => {
                  const completed = task.status === "completed";
                  const active = focusId === task.id;
                  return (
                    <div
                      className={`sidebar-task ${active ? "is-active" : ""} ${
                        completed ? "is-done" : ""
                      }`}
                      key={task.id}
                    >
                      <button
                        className="sketch-check"
                        aria-label={completed ? "Reopen task" : "Complete task"}
                        onClick={() => void handleToggleTask(task)}
                      >
                        {completed ? "✓" : ""}
                      </button>
                      <button
                        className="task-name-button"
                        title={task.title}
                        onClick={() => {
                          adoptedSessionRef.current = true;
                          setFocusId(task.id);
                          setTab("tasks");
                        }}
                      >
                        {task.title}
                      </button>
                      <input
                        className="duration-badge"
                        type="number"
                        min={1}
                        max={999}
                        value={task.estimated_minutes ?? 45}
                        aria-label={`Duration for ${task.title}`}
                        onChange={(event) => {
                          const value = clampMinutes(Number(event.target.value));
                          setTasks((current) =>
                            current.map((item) =>
                              item.id === task.id
                                ? { ...item, estimated_minutes: value }
                                : item,
                            ),
                          );
                        }}
                        onBlur={(event) =>
                          void handleTaskMinutes(task, Number(event.target.value))
                        }
                      />
                      <span className="duration-suffix">m</span>
                      <button
                        className="task-delete"
                        aria-label={`Delete ${task.title}`}
                        onClick={() => handleDeleteTask(task)}
                      >
                        ×
                      </button>
                    </div>
                  );
                })
              )}
            </div>

            <div className="task-footer">
              <input
                className="task-input"
                value={newTaskTitle}
                placeholder="New task"
                onChange={(event) => setNewTaskTitle(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    void handleCreateTask();
                  }
                }}
              />
              <input
                className="minute-input"
                type="number"
                min={1}
                max={999}
                value={newTaskMinutes}
                aria-label="Task minutes"
                onChange={(event) =>
                  setNewTaskMinutes(clampMinutes(Number(event.target.value)))
                }
              />
              <button
                className="footer-add"
                onClick={() => void handleCreateTask()}
              >
                Add
              </button>
            </div>
          </aside>

          <section className="main-panel">
            {tab === "tasks" ? (
              activeTask ? (
                <div className="task-detail-view">
                  <p className="section-label">ACTIVE TASK</p>
                  <h1>{activeTask.title}</h1>

                  <div className="task-stats">
                    <div>
                      <strong>{activeTask.estimated_minutes ?? 45}m</strong>
                      <span>DURATION</span>
                    </div>
                    <div>
                      <strong>{activeTaskDiagrams.length}</strong>
                      <span>CANVASES</span>
                    </div>
                    <div>
                      <strong>
                        {activeTask.status === "completed" ? "Done" : "Open"}
                      </strong>
                      <span>STATUS</span>
                    </div>
                  </div>

                  <div className="progress-block">
                    <div className="progress-copy">
                      <span>Today's progress</span>
                      <span>
                        {doneCount}/{tasks.length}
                      </span>
                    </div>
                    <div className="progress-track">
                      <span style={{ width: `${progressPercent}%` }} />
                    </div>
                  </div>

                  <p className="section-label list-label">ALL TASKS</p>
                  <div className="all-task-card">
                    {tasks.map((task) => (
                      <button
                        className={`all-task-row ${
                          task.id === focusId ? "is-active" : ""
                        }`}
                        key={task.id}
                        onClick={() => setFocusId(task.id)}
                      >
                        <span
                          className={`task-dot ${
                            task.id === focusId
                              ? "is-active"
                              : task.status === "completed"
                                ? "is-done"
                                : ""
                          }`}
                        />
                        <span>{task.title}</span>
                        <strong>{task.estimated_minutes ?? 45}m</strong>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="focus-empty-state">
                  <svg viewBox="0 0 64 64" aria-hidden="true">
                    <rect x="12" y="15" width="40" height="34" rx="5" />
                    <path d="M20 27h24M20 36h17" />
                  </svg>
                  <strong>Click a task to focus</strong>
                </div>
              )
            ) : (
              <div className="canvases-view">
                <div className="canvas-toolbar">
                  <h1>Canvases</h1>
                  <input
                    type="search"
                    placeholder="Search canvases"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                  <span>{filteredDiagrams.length} total</span>
                  <button
                    className="canvas-new-group-button"
                    onClick={() => setShowGroupComposer((current) => !current)}
                  >
                    + New group
                  </button>
                </div>

                {showGroupComposer && (
                  <div className="new-group-composer">
                    <input
                      autoFocus
                      value={newGroupName}
                      placeholder="Group name"
                      aria-label="Canvas group name"
                      onChange={(event) => setNewGroupName(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          void handleCreateGroup();
                        }
                        if (event.key === "Escape") {
                          setShowGroupComposer(false);
                          setNewGroupName("");
                        }
                      }}
                    />
                    <button
                      className="is-primary"
                      onClick={() => void handleCreateGroup()}
                    >
                      Create
                    </button>
                    <button
                      aria-label="Cancel new group"
                      onClick={() => {
                        setShowGroupComposer(false);
                        setNewGroupName("");
                      }}
                    >
                      ×
                    </button>
                  </div>
                )}

                <div className="canvas-groups">
                  {diagramGroups.map((group) => {
                    const groupRecord = group.id
                      ? canvasGroups.find((item) => item.id === group.id) ?? null
                      : null;
                    return (
                      <section
                        className="canvas-group"
                        key={group.id ?? "ungrouped"}
                      >
                        <div className="group-heading">
                          {group.id && editingGroupId === group.id ? (
                            <input
                              className="group-name-input"
                              autoFocus
                              value={editingGroupName}
                              onChange={(event) =>
                                setEditingGroupName(event.target.value)
                              }
                              onBlur={() => void commitGroupRename(group.id!)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  void commitGroupRename(group.id!);
                                }
                                if (event.key === "Escape") {
                                  setEditingGroupId(null);
                                }
                              }}
                            />
                          ) : (
                            <strong>{group.name}</strong>
                          )}
                          <span>{group.diagrams.length}</span>
                          <i />
                          {groupRecord ? (
                            <div className="group-heading-actions">
                              <button
                                title="Rename group"
                                aria-label={`Rename ${group.name}`}
                                onClick={() => {
                                  setEditingGroupId(groupRecord.id);
                                  setEditingGroupName(groupRecord.name);
                                }}
                              >
                                ✎
                              </button>
                              <button
                                title="Delete group"
                                aria-label={`Delete ${group.name}`}
                                onClick={() => handleDeleteGroup(groupRecord)}
                              >
                                ×
                              </button>
                            </div>
                          ) : (
                            <span />
                          )}
                        </div>
                        <div className="compact-canvas-grid">
                          {group.diagrams.map((diagram) => (
                            <article
                              className="compact-canvas-card"
                              key={diagram.id}
                            >
                              <button
                                className="canvas-thumb"
                                onClick={() => void openDiagram(diagram)}
                                aria-label={`Open ${diagram.name}`}
                              >
                                <SketchThumbnail />
                              </button>
                              <div className="canvas-card-copy">
                                {editingDiagramId === diagram.id ? (
                                  <input
                                    className="inline-rename"
                                    autoFocus
                                    value={editingDiagramName}
                                    onChange={(event) =>
                                      setEditingDiagramName(event.target.value)
                                    }
                                    onBlur={() =>
                                      void commitDiagramRename(diagram)
                                    }
                                    onKeyDown={(event) => {
                                      if (event.key === "Enter") {
                                        void commitDiagramRename(diagram);
                                      }
                                      if (event.key === "Escape") {
                                        setEditingDiagramId(null);
                                      }
                                    }}
                                  />
                                ) : (
                                  <button
                                    className="canvas-name"
                                    onClick={() => void openDiagram(diagram)}
                                  >
                                    {diagram.name}
                                  </button>
                                )}
                                <span>{formatShortDate(diagram.updated_at)}</span>
                              </div>
                              <select
                                className="canvas-group-select"
                                value={diagram.group_id ?? ""}
                                onChange={(event) =>
                                  void handleAssignDiagram(
                                    diagram,
                                    event.target.value,
                                  )
                                }
                                aria-label={`Group for ${diagram.name}`}
                              >
                                <option value="">Ungrouped</option>
                                {canvasGroups.map((canvasGroup) => (
                                  <option
                                    key={canvasGroup.id}
                                    value={canvasGroup.id}
                                  >
                                    {canvasGroup.name}
                                  </option>
                                ))}
                              </select>
                              <div className="canvas-card-actions">
                                <button
                                  title="Rename"
                                  onClick={() => {
                                    setEditingDiagramId(diagram.id);
                                    setEditingDiagramName(diagram.name);
                                  }}
                                >
                                  ✎
                                </button>
                                <button
                                  title="Delete"
                                  onClick={() => handleDeleteDiagram(diagram)}
                                >
                                  ×
                                </button>
                              </div>
                            </article>
                          ))}

                          <button
                            className="new-canvas-placeholder"
                            onClick={() => void handleCreateDiagram(group.id)}
                          >
                            <span>+</span>
                            New canvas
                          </button>
                        </div>
                      </section>
                    );
                  })}
                </div>
              </div>
            )}
          </section>

          <aside className="right-sidebar">
            <section className="focus-panel">
              <p className="section-label">FOCUS</p>
              {timerTask ? (
                <>
                  <span className="focus-task-name" title={timerTask.title}>
                    {timerTask.title}
                  </span>
                  <strong className="focus-time">
                    {formatTimer(remainingSeconds)}
                  </strong>
                  <div className="focus-buttons">
                    {!focus.session ? (
                      <button
                        className="focus-start"
                        onClick={() => void handleStartFocus()}
                      >
                        Start
                      </button>
                    ) : focus.session.status === "paused" ? (
                      <button
                        className="focus-start"
                        onClick={() => void focus.resume()}
                      >
                        Resume
                      </button>
                    ) : (
                      <button
                        className="focus-start"
                        onClick={() => void focus.pause()}
                      >
                        Pause
                      </button>
                    )}
                    {focus.session && (
                      <button
                        className="focus-outline"
                        disabled={remainingSeconds > 0}
                        title={
                          remainingSeconds > 0
                            ? "Available when the timer reaches 00:00"
                            : "Finish focus session"
                        }
                        onClick={() => void focus.finish()}
                      >
                        Finish
                      </button>
                    )}
                    <button
                      className="focus-outline"
                      onClick={() => {
                        adoptedSessionRef.current = true;
                        setFocusId(null);
                      }}
                    >
                      Clear
                    </button>
                  </div>
                </>
              ) : (
                <div className="no-focus-task">
                  <strong>—:—</strong>
                  <span>Select a task to focus</span>
                </div>
              )}
            </section>

            <section className="focus-summary">
              <div>
                <strong>{totalFocusedMinutes}</strong>
                <span>MINUTES</span>
              </div>
              <div>
                <strong>{sessions.length}</strong>
                <span>SESSIONS</span>
              </div>
            </section>

            <section className="recent-panel">
              <p className="section-label">RECENT</p>
              <div className="recent-list">
                {sessions.slice(0, 8).length === 0 ? (
                  <div className="recent-empty">No sessions yet</div>
                ) : (
                  sessions.slice(0, 8).map((session) => (
                    <div className="recent-row" key={session.id}>
                      <div>
                        <strong title={session.task_title ?? "Focus session"}>
                          {session.task_title ?? "Focus session"}
                        </strong>
                        <span>
                          {formatClock(session.started_at)}
                          {session.ended_at
                            ? `–${formatClock(session.ended_at)}`
                            : ""}
                          {session.status === "cancelled"
                            ? " · cancelled"
                            : ""}
                        </span>
                      </div>
                      <b>
                        {Math.max(1, Math.round(session.actual_seconds / 60))}m
                      </b>
                    </div>
                  ))
                )}
              </div>
            </section>
          </aside>
        </div>

        <footer className="statusbar">
          <span>Local workspace · optional Drive sync in Settings</span>
          <span>
            {doneCount}/{tasks.length} tasks done · {diagrams.length} canvases
          </span>
        </footer>
      </main>

      <ConfirmDialog
        open={confirmation !== null}
        title={confirmation?.title ?? "Confirm action"}
        message={confirmation?.message ?? ""}
        confirmLabel={confirmation?.confirmLabel ?? "Confirm"}
        busy={confirmationBusy}
        onCancel={() => {
          if (!confirmationBusy) {
            setConfirmation(null);
          }
        }}
        onConfirm={() => void runConfirmation()}
      />
    </>
  );
}
