import { useEffect, useState } from "react";

import type { DiagramRecord } from "../diagrams/diagramRepository";
import {
  createTask,
  deleteTask,
  linkTaskToDiagram,
  listTasks,
  setTaskCompleted,
  type TaskRecord,
} from "./taskRepository";

type Props = {
  diagrams: DiagramRecord[];
  focusActive: boolean;
  onStartFocus: (
    taskId: string,
    seconds: number,
    linkedDiagramId: string | null,
  ) => Promise<void>;
};

export function TodoPanel({ diagrams, focusActive, onStartFocus }: Props) {
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [title, setTitle] = useState("");
  const [duration, setDuration] = useState(45);
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

    try {
      const task = await createTask(trimmed, duration);
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
    if (!window.confirm(`Delete “${task.title}”?`)) {
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

  const handleDiagramLink = async (task: TaskRecord, diagramId: string) => {
    const nextId = diagramId || null;
    try {
      await linkTaskToDiagram(task.id, nextId);
      setTasks((current) =>
        current.map((item) =>
          item.id === task.id ? { ...item, linked_diagram_id: nextId } : item,
        ),
      );
    } catch (cause) {
      console.error(cause);
      setError("Could not link diagram.");
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
          value={duration}
          onChange={(event) => setDuration(Number(event.target.value))}
          aria-label="Estimated focus duration"
        >
          <option value={25}>25m</option>
          <option value={45}>45m</option>
          <option value={60}>60m</option>
          <option value={90}>90m</option>
        </select>
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
                    <span>{minutes} min</span>
                    <select
                      value={task.linked_diagram_id ?? ""}
                      onChange={(event) =>
                        void handleDiagramLink(task, event.target.value)
                      }
                      aria-label={`Diagram linked to ${task.title}`}
                    >
                      <option value="">No diagram</option>
                      {diagrams.map((diagram) => (
                        <option value={diagram.id} key={diagram.id}>
                          {diagram.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {!completed && (
                  <button
                    className="focus-button"
                    disabled={focusActive}
                    onClick={() =>
                      void onStartFocus(
                        task.id,
                        minutes * 60,
                        task.linked_diagram_id,
                      )
                    }
                  >
                    {task.linked_diagram_id ? "Focus + open" : "Focus"}
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
