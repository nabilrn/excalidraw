import { useCallback, useEffect, useState } from "react";

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
    await finishFocusSession(session);
    setSession(null);
    setHistoryRevision((value) => value + 1);
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
