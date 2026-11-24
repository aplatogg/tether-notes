"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { noteDays } from "@/lib/notes/model";
import type { Note } from "@/lib/notes/types";

function monthMatrix(year: number, month: number): (number | null)[][] {
  const first = new Date(Date.UTC(year, month, 1));
  const startDay = (first.getUTCDay() + 6) % 7; // Monday-first
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const weeks: (number | null)[][] = [];
  let week: (number | null)[] = Array.from({ length: startDay }, () => null);
  for (let day = 1; day <= daysInMonth; day += 1) {
    week.push(day);
    if (week.length === 7) {
      weeks.push(week);
      week = [];
    }
  }
  if (week.length > 0) {
    while (week.length < 7) week.push(null);
    weeks.push(week);
  }
  return weeks;
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const WEEKDAY_NAMES = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

export function CalendarView({
  notes,
  selectedDay,
  onSelectDay,
}: {
  notes: Note[];
  selectedDay: string | null;
  onSelectDay: (day: string | null) => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [view, setView] = useState(() => {
    const now = new Date();
    return { year: now.getUTCFullYear(), month: now.getUTCMonth() };
  });

  const daysWithNotes = useMemo(() => {
    const map = new Map<string, number>();
    notes.forEach((note) => {
      if (note.deletedAt !== null) return;
      noteDays(note).forEach((day) => map.set(day, (map.get(day) ?? 0) + 1));
    });
    return map;
  }, [notes]);

  const weeks = monthMatrix(view.year, view.month);
  const prefix = `${view.year}-${String(view.month + 1).padStart(2, "0")}`;

  return (
    <div className="calendar-view" aria-label="Calendar">
      <header>
        <button type="button" aria-label="Previous month" onClick={() =>
          setView((current) => {
            const date = new Date(Date.UTC(current.year, current.month - 1, 1));
            return { year: date.getUTCFullYear(), month: date.getUTCMonth() };
          })
        }>
          <ChevronLeft aria-hidden="true" />
        </button>
        <strong>{MONTH_NAMES[view.month]} {view.year}</strong>
        <button type="button" aria-label="Next month" onClick={() =>
          setView((current) => {
            const date = new Date(Date.UTC(current.year, current.month + 1, 1));
            return { year: date.getUTCFullYear(), month: date.getUTCMonth() };
          })
        }>
          <ChevronRight aria-hidden="true" />
        </button>
      </header>
      <div className="calendar-grid">
        {WEEKDAY_NAMES.map((name) => (
          <span key={name} className="calendar-weekday">{name}</span>
        ))}
        {weeks.flat().map((day, index) => {
          if (day === null) return <span key={`empty-${index}`} className="calendar-cell is-empty" />;
          const dayKey = `${prefix}-${String(day).padStart(2, "0")}`;
          const count = daysWithNotes.get(dayKey) ?? 0;
          return (
            <button
              key={dayKey}
              type="button"
              className={[
                "calendar-cell",
                dayKey === today ? "is-today" : "",
                dayKey === selectedDay ? "is-selected" : "",
              ].filter(Boolean).join(" ")}
              onClick={() => onSelectDay(selectedDay === dayKey ? null : dayKey)}
            >
              {day}
              {count > 0 ? <span className="calendar-dot" aria-label={`${count} notes`} /> : null}
            </button>
          );
        })}
      </div>
      {selectedDay ? (
        <button type="button" className="secondary-button calendar-clear" onClick={() => onSelectDay(null)}>
          Clear day filter ({selectedDay})
        </button>
      ) : null}
    </div>
  );
}
