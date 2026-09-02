import { useCallback, useEffect, useState } from "react";

import { setTaskCompleted } from "../tasks/taskRepository";
import {
  cancelFocusSession,
  finishFocusSession,
  getActiveFocusSession,
  pauseFocusSession,
  resumeFocusSession,
  startFocusSession,
  type FocusSessionRecord,
} from "./focusRepository";

export function useFocusTimer() {
  const [session, setSession] = useState<FocusSessionRecord | null>(null);
  const [historyRevision, setHistoryRevision] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      setSession(await getActiveFocusSession());
    } catch (cause) {
      console.error(cause);
      setError("Could not restore the focus timer.");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const start = useCallback(async (taskId: string | null, seconds: number) => {
    try {
      setError(null);
      const next = await startFocusSession(taskId, seconds);
      setSession(next);
      return next;
    } catch (cause) {
      console.error(cause);
      setError(
        cause instanceof Error ? cause.message : "Could not start focus session.",
      );
      return null;
    }
  }, []);

  const pause = useCallback(async () => {
    if (!session) {
      return;
    }
    setSession(await pauseFocusSession(session));
  }, [session]);

  const resume = useCallback(async () => {
    if (!session) {
      return;
    }
    setSession(await resumeFocusSession(session));
  }, [session]);

  const finish = useCallback(async () => {
    if (!session) {
      return;
    }

    const finishedSession = session;
    try {
      setError(null);
      await finishFocusSession(finishedSession);
      setSession(null);
      setHistoryRevision((value) => value + 1);
    } catch (cause) {
      console.error(cause);
      setError(
        cause instanceof Error ? cause.message : "Could not finish the focus session.",
      );
      return;
    }

    if (finishedSession.task_id) {
      try {
        await setTaskCompleted(finishedSession.task_id, true);
      } catch (cause) {
        console.error(cause);
        setError(
          "Focus session was saved, but task progress could not be updated.",
        );
      }
    }
  }, [session]);

  const cancel = useCallback(async () => {
    if (!session) {
      return;
    }
    await cancelFocusSession(session);
    setSession(null);
    setHistoryRevision((value) => value + 1);
  }, [session]);

  return {
    session,
    error,
    historyRevision,
    start,
    pause,
    resume,
    finish,
    cancel,
    refresh,
  };
}
