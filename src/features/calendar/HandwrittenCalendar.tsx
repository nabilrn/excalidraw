import { useMemo, useState } from "react";

import type { TaskRecord } from "../tasks/taskRepository";
import "./handwrittenCalendar.css";

type HandwrittenCalendarProps = {
  tasks: TaskRecord[];
};

type CalendarDay = {
  date: Date;
  day: number;
  inMonth: boolean;
};

const WEEKDAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

function localDateKey(date: Date) {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function timestampDateKey(timestamp: number) {
  return localDateKey(new Date(timestamp));
}

function buildCalendarDays(month: Date): CalendarDay[] {
  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  const firstDay = new Date(year, monthIndex, 1);
  const gridStart = new Date(year, monthIndex, 1 - firstDay.getDay());

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(
      gridStart.getFullYear(),
      gridStart.getMonth(),
      gridStart.getDate() + index,
    );
    return {
      date,
      day: date.getDate(),
      inMonth: date.getMonth() === monthIndex,
    };
  });
}

function RedMarkerX() {
  return (
    <svg className="calendar-marker-x" viewBox="0 0 42 42" aria-hidden="true">
      <path d="M8 9.5C15.5 16 24.5 26.5 34 34" />
      <path d="M34.5 7.5C27 15 17.5 25 8.5 34.5" />
      <path d="M10 8C17 15 25.5 24.5 35 32.5" />
    </svg>
  );
}

export function HandwrittenCalendar({ tasks }: HandwrittenCalendarProps) {
  const [visibleMonth, setVisibleMonth] = useState(
    () => new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  );

  const days = useMemo(() => buildCalendarDays(visibleMonth), [visibleMonth]);
  const todayKey = localDateKey(new Date());

  const completedByDay = useMemo(() => {
    const result = new Map<string, TaskRecord[]>();
    for (const task of tasks) {
      if (task.status !== "completed" || task.completed_at === null) {
        continue;
      }
      const key = timestampDateKey(task.completed_at);
      const existing = result.get(key);
      if (existing) {
        existing.push(task);
      } else {
        result.set(key, [task]);
      }
    }
    return result;
  }, [tasks]);

  const monthLabel = new Intl.DateTimeFormat(undefined, {
    month: "long",
    year: "numeric",
  }).format(visibleMonth);

  const moveMonth = (offset: number) => {
    setVisibleMonth(
      (current) => new Date(current.getFullYear(), current.getMonth() + offset, 1),
    );
  };

  const returnToCurrentMonth = () => {
    const current = new Date();
    setVisibleMonth(new Date(current.getFullYear(), current.getMonth(), 1));
  };

  return (
    <section className="handwritten-calendar" aria-label="Task completion calendar">
      <header className="calendar-header">
        <div>
          <p className="section-label">CALENDAR</p>
          <h2>{monthLabel}</h2>
        </div>
        <div className="calendar-controls">
          <button aria-label="Previous month" onClick={() => moveMonth(-1)}>
            ←
          </button>
          <button className="calendar-today" onClick={returnToCurrentMonth}>
            today
          </button>
          <button aria-label="Next month" onClick={() => moveMonth(1)}>
            →
          </button>
        </div>
      </header>

      <div className="calendar-weekdays" aria-hidden="true">
        {WEEKDAYS.map((weekday) => (
          <span key={weekday}>{weekday}</span>
        ))}
      </div>

      <div className="calendar-grid">
        {days.map(({ date, day, inMonth }) => {
          const key = localDateKey(date);
          const completedTasks = completedByDay.get(key) ?? [];
          const isToday = key === todayKey;
          const completionLabel =
            completedTasks.length === 0
              ? ""
              : `, ${completedTasks.length} task${completedTasks.length === 1 ? "" : "s"} completed`;

          return (
            <div
              className={`calendar-day ${inMonth ? "" : "is-outside"} ${
                isToday ? "is-today" : ""
              } ${completedTasks.length > 0 ? "has-completion" : ""}`}
              key={key}
              title={completedTasks.map((task) => task.title).join(" · ")}
              aria-label={`${new Intl.DateTimeFormat(undefined, {
                weekday: "long",
                month: "long",
                day: "numeric",
                year: "numeric",
              }).format(date)}${completionLabel}`}
            >
              <span className="calendar-day-number">{day}</span>
              {completedTasks.length > 0 && <RedMarkerX />}
              {completedTasks.length > 1 && (
                <span className="calendar-done-count">{completedTasks.length} done</span>
              )}
            </div>
          );
        })}
      </div>

      <p className="calendar-note">
        finished a task? mark the day.
      </p>
    </section>
  );
}
