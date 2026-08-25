import { useEffect, useState } from "react";

import {
  listRecentFocusSessions,
  type FocusSessionRecord,
} from "./focusRepository";

type Props = {
  revision: number;
};

const formatMinutes = (seconds: number) => {
  const minutes = Math.max(1, Math.round(seconds / 60));
  return `${minutes} min`;
};

const formatTime = (timestamp: number) =>
  new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));

export function SessionHistory({ revision }: Props) {
  const [sessions, setSessions] = useState<FocusSessionRecord[]>([]);

  useEffect(() => {
    void listRecentFocusSessions(12)
      .then(setSessions)
      .catch((cause) => console.error(cause));
  }, [revision]);

  return (
    <section className="dashboard-panel history-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Recent</p>
          <h2>Focus history</h2>
        </div>
      </div>

      {sessions.length === 0 ? (
        <p className="panel-empty">Completed focus sessions will appear here.</p>
      ) : (
        <div className="session-list">
          {sessions.map((session) => (
            <article className="session-row" key={session.id}>
              <div>
                <strong>{session.task_title ?? "Focus session"}</strong>
                <p className="muted">
                  {formatTime(session.started_at)}
                  {session.ended_at ? `–${formatTime(session.ended_at)}` : ""}
                </p>
              </div>
              <div className="session-duration">
                {formatMinutes(session.actual_seconds)}
                {session.status === "cancelled" && (
                  <span className="cancelled-label">cancelled</span>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
