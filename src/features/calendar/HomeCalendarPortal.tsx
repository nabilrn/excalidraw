import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { listTasks, type TaskRecord } from "../tasks/taskRepository";
import { HandwrittenCalendar } from "./HandwrittenCalendar";

const HOST_ID = "focuscanvas-home-calendar-host";

function positionCalendarHost() {
  const mainPanel = document.querySelector<HTMLElement>(".main-panel");
  if (!mainPanel || mainPanel.querySelector(".canvases-view")) {
    document.getElementById(HOST_ID)?.remove();
    return null;
  }

  let host = document.getElementById(HOST_ID);
  if (!host) {
    host = document.createElement("div");
    host.id = HOST_ID;
  }

  const progress = mainPanel.querySelector<HTMLElement>(
    ".task-detail-view .progress-block",
  );
  if (progress) {
    host.className = "home-calendar-host is-task-detail";
    if (progress.nextElementSibling !== host) {
      progress.insertAdjacentElement("afterend", host);
    }
    return host;
  }

  const emptyState = mainPanel.querySelector<HTMLElement>(".focus-empty-state");
  if (emptyState) {
    host.className = "home-calendar-host is-empty-state";
    if (host.parentElement !== emptyState) {
      emptyState.append(host);
    }
    return host;
  }

  host.remove();
  return null;
}

export function HomeCalendarPortal() {
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [host, setHost] = useState<HTMLElement | null>(null);

  const refreshTasks = useCallback(async () => {
    try {
      setTasks(await listTasks());
    } catch (error) {
      console.error("Could not refresh calendar tasks", error);
    }
  }, []);

  useEffect(() => {
    void refreshTasks();
    const refresh = () => void refreshTasks();
    window.addEventListener("focuscanvas:tasks-changed", refresh);
    window.addEventListener("focuscanvas:workspace-synced", refresh);
    return () => {
      window.removeEventListener("focuscanvas:tasks-changed", refresh);
      window.removeEventListener("focuscanvas:workspace-synced", refresh);
    };
  }, [refreshTasks]);

  useEffect(() => {
    let scheduled = false;
    const reposition = () => {
      if (scheduled) {
        return;
      }
      scheduled = true;
      window.requestAnimationFrame(() => {
        scheduled = false;
        setHost(positionCalendarHost());
      });
    };

    reposition();
    const observer = new MutationObserver(reposition);
    observer.observe(document.getElementById("root") ?? document.body, {
      childList: true,
      subtree: true,
    });

    return () => {
      observer.disconnect();
      document.getElementById(HOST_ID)?.remove();
    };
  }, []);

  if (!host) {
    return null;
  }

  return createPortal(<HandwrittenCalendar tasks={tasks} />, host);
}
