import { useEffect, useMemo, useState } from "react";

import {
  getElapsedSeconds,
  type FocusSessionRecord,
} from "./focusRepository";

type Props = {
  session: FocusSessionRecord | null;
  onPause: () => Promise<void>;
  onResume: () => Promise<void>;
  onFinish: () => Promise<void>;
  onCancel: () => Promise<void>;
};

const formatDuration = (totalSeconds: number) => {
  const safe = Math.max(0, totalSeconds);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds
      .toString()
      .padStart(2, "0")}`;
  }

  return `${minutes.toString().padStart(2, "0")}:${seconds
    .toString()
    .padStart(2, "0")}`;
};

export function FocusTimerDock({
  session,
  onPause,
  onResume,
  onFinish,
  onCancel,
}: Props) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!session || session.status !== "running") {
      return;
    }

    const interval = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(interval);
  }, [session]);

  const remainingSeconds = useMemo(() => {
    if (!session) {
      return 0;
    }

    return Math.max(
      0,
      session.planned_seconds - getElapsedSeconds(session, now),
    );
  }, [now, session]);

  if (!session) {
    return null;
  }

  return (
    <aside className="focus-timer-dock" aria-live="polite">
      <div className="focus-timer-copy">
        <span className="focus-label">Focus</span>
        <strong>{session.task_title ?? "Focus session"}</strong>
      </div>

      <div className="focus-clock">{formatDuration(remainingSeconds)}</div>

      <div className="focus-actions">
        {session.status === "paused" ? (
          <button onClick={() => void onResume()}>Resume</button>
        ) : (
          <button onClick={() => void onPause()}>Pause</button>
        )}
        <button onClick={() => void onFinish()}>Finish</button>
        <button className="danger-text" onClick={() => void onCancel()}>
          Cancel
        </button>
      </div>
    </aside>
  );
}
