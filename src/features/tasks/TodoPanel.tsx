import { useEffect, useState } from "react";

import type { DiagramRecord } from "../diagrams/diagramRepository";
import {
  createTask,
  deleteTask,
  listTasks,
  setTaskCompleted,
  setTaskEstimatedMinutes,
  type TaskRecord,
} from "./taskRepository";

type Props = {
  diagrams: DiagramRecord[];
  focusActive: boolean;
  onTasksChange?: (tasks: TaskRecord[]) => void;
  onStartFocus: (
    taskId: string,
    seconds: number,
    linkedDiagramId: string | null,
  ) => Promise<void>;
};

const normalizeMinutes = (value: number) =>
  Number.isFinite(value) && value > 0 ? Math.max(1, Math.floor(value)) : 1;

export function TodoPanel({
  diagrams,
  focusActive,
  onTasksChange,
  onStartFocus,
}: Props) {
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [title, setTitle] = useState("");
  const [durationMode, setDurationMode] = useState<"25" | "45" | "60" | "custom">("45");
  const [customDuration, setCustomDuration] = useState(120);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void listTasks()
      .then(setTasks)
      .catch((cause) => {
        console.error(cause);
        setError("Could not load tasks.");
      });
  }, []);

  useEffect(() => {
    onTasksChange?.(tasks);
  }, [onTasksChange, tasks]);

  useEffect(() => {
    const diagramIds = new Set(diagrams.map((diagram) => diagram.id));
    setTasks((current) =>
      current.map((task) =>
        task.linked_diagram_id && !diagramIds.has(task.linked_diagram_id)
          ? { ...task, linked_diagram_id: null }
          : task,
      ),
    );
  }, [diagrams]);

  const handleAdd = async () => {
    const trimmed = title.trim();
    if (!trimmed) {
      return;
    }

    const minutes = normalizeMinutes(
      durationMode === "custom" ? customDuration : Number(durationMode),
    );

    try {
      const task = await createTask(trimmed, minutes);
      setTasks((current) => [task, ...current]);
      setTitle("");
      setError(null);
    } catch (cause) {
      console.error(cause);
      setError("Could not create task.");
    }
  };

  const handleToggle = async (task: TaskRecord) => {
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
  };

  const handleDelete = async (task: TaskRecord) => {
    if (!window.confirm(`Delete “${task.title}”? Diagrams in this group will become ungrouped.`)) {
      return;
    }

    try {
      await deleteTask(task.id);
      setTasks((current) => current.filter((item) => item.id !== task.id));
    } catch (cause) {
      console.error(cause);
      setError("Could not delete task.");
    }
  };

  const handleDurationDraft = (taskId: string, value: number) => {
    if (!Number.isFinite(value) || value < 1) {
      return;
    }

    const minutes = normalizeMinutes(value);
    setTasks((current) =>
      current.map((task) =>
        task.id === taskId ? { ...task, estimated_minutes: minutes } : task,
      ),
    );
  };

  const handleDurationCommit = async (taskId: string, value: number) => {
    const minutes = normalizeMinutes(value);
    try {
      await setTaskEstimatedMinutes(taskId, minutes);
      setError(null);
    } catch (cause) {
      console.error(cause);
      setError("Could not update focus duration.");
    }
  };

  return (
    <section className="dashboard-panel todo-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Today</p>
          <h2>Todo</h2>
        </div>
        <span className="muted">
          {tasks.filter((task) => task.status === "open").length} open
        </span>
      </div>

      <div className="task-composer">
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              void handleAdd();
            }
          }}
          placeholder="Add a task"
          aria-label="Task title"
        />
        <select
          value={durationMode}
          onChange={(event) =>
            setDurationMode(event.target.value as "25" | "45" | "60" | "custom")
          }
          aria-label="Estimated focus duration"
        >
          <option value="25">25m</option>
          <option value="45">45m</option>
          <option value="60">60m</option>
          <option value="custom">Custom</option>
        </select>
        {durationMode === "custom" && (
          <input
            className="custom-duration-input"
            type="number"
            min="1"
            step="1"
            value={customDuration}
            onChange={(event) =>
              setCustomDuration(normalizeMinutes(Number(event.target.value)))
            }
            aria-label="Custom focus duration in minutes"
            title="Custom focus duration in minutes"
          />
        )}
        <button className="primary-button" onClick={() => void handleAdd()}>
          Add
        </button>
      </div>

      {error && <div className="inline-error">{error}</div>}

      <div className="task-list">
        {tasks.length === 0 ? (
          <p className="panel-empty">No tasks yet.</p>
        ) : (
          tasks.map((task) => {
            const completed = task.status === "completed";
            const minutes = task.estimated_minutes ?? 45;
            const taskDiagrams = diagrams.filter(
              (diagram) => diagram.task_id === task.id,
            );
            const legacyDiagram = task.linked_diagram_id
              ? diagrams.find((diagram) => diagram.id === task.linked_diagram_id)
              : null;
            const focusDiagramId = taskDiagrams[0]?.id ?? legacyDiagram?.id ?? null;

            return (
              <article
                className={`task-row ${completed ? "is-completed" : ""}`}
                key={task.id}
              >
                <button
                  className="task-check"
                  aria-label={completed ? "Reopen task" : "Complete task"}
                  onClick={() => void handleToggle(task)}
                >
                  {completed ? "✓" : ""}
                </button>

                <div className="task-main">
                  <strong>{task.title}</strong>
                  <div className="task-meta">
                    <input
                      className="task-duration-input"
                      type="number"
                      min="1"
                      step="1"
                      value={minutes}
                      onChange={(event) =>
                        handleDurationDraft(task.id, Number(event.target.value))
                      }
                      onBlur={(event) =>
                        void handleDurationCommit(
                          task.id,
                          Number(event.currentTarget.value),
                        )
                      }
                      aria-label={`Focus duration for ${task.title} in minutes`}
                    />
                    <span>min</span>
                    <span>
                      {taskDiagrams.length} {taskDiagrams.length === 1 ? "diagram" : "diagrams"}
                    </span>
                  </div>
                </div>

                {!completed && (
                  <button
                    className="focus-button"
                    disabled={focusActive}
                    onClick={() =>
                      void onStartFocus(task.id, minutes * 60, focusDiagramId)
                    }
                  >
                    {focusDiagramId ? "Focus + open" : "Focus"}
                  </button>
                )}

                <button
                  className="icon-button danger-text"
                  aria-label={`Delete ${task.title}`}
                  onClick={() => void handleDelete(task)}
                >
                  ×
                </button>
              </article>
            );
          })
        )}
      </div>
    </section>
  );
}
