'use client';

import { useRef, useEffect, useState } from 'react';
import type { SportEvent } from '@/lib/gametime/types';
import { useApp, usePrefs } from '@/lib/gametime/context/AppContext';
import { formatTime, getRelativeTime } from '@/lib/gametime/time';
import { SportIcon } from './SportIcon';
import { StatusPill } from './StatusPill';

interface Props {
  events: SportEvent[];
  hoursToShow?: number;
}

const CELL_WIDTH = 180; // px per hour
const ROW_HEIGHT = 60;  // px per row

function getUniqueRows(events: SportEvent[]): string[] {
  const sports = [...new Set(events.map(e => e.sport))];
  return sports;
}

function getTimeSlots(startHour: number, count: number): Date[] {
  const slots: Date[] = [];
  const base = new Date();
  base.setMinutes(0, 0, 0);
  base.setHours(startHour);
  for (let i = 0; i < count; i++) {
    const d = new Date(base);
    d.setHours(base.getHours() + i);
    slots.push(d);
  }
  return slots;
}

function positionEvent(event: SportEvent, startHour: number) {
  const start = new Date(event.startTimeUtc);
  const end = event.endTimeUtc
    ? new Date(event.endTimeUtc)
    : new Date(start.getTime() + 2 * 60 * 60 * 1000);

  const base = new Date();
  base.setHours(startHour, 0, 0, 0);

  const startMin = (start.getTime() - base.getTime()) / (1000 * 60);
  const durationMin = (end.getTime() - start.getTime()) / (1000 * 60);

  const left = (startMin / 60) * CELL_WIDTH;
  const width = Math.max((durationMin / 60) * CELL_WIDTH, 80);
  return { left, width };
}

export function EPGGrid({ events, hoursToShow = 12 }: Props) {
  const { dispatch } = useApp();
  const prefs = usePrefs();
  const tz = prefs.timezone || 'UTC';
  const containerRef = useRef<HTMLDivElement>(null);
  const [nowLeft, setNowLeft] = useState(0);

  const now = new Date();
  const startHour = now.getHours() - 1;
  const timeSlots = getTimeSlots(startHour, hoursToShow);
  const rows = getUniqueRows(events);

  // Current time marker position
  useEffect(() => {
    const update = () => {
      const base = new Date();
      base.setHours(startHour, 0, 0, 0);
      const elapsed = (Date.now() - base.getTime()) / (1000 * 60 * 60);
      setNowLeft(elapsed * CELL_WIDTH);
    };
    update();
    const interval = setInterval(update, 60000);
    return () => clearInterval(interval);
  }, [startHour]);

  // Scroll to now on mount
  useEffect(() => {
    if (containerRef.current) {
      const scrollTo = Math.max(0, nowLeft - 80);
      containerRef.current.scrollLeft = scrollTo;
    }
  }, [nowLeft]);

  const LABEL_WIDTH = 96;

  return (
    <div className="relative overflow-hidden rounded-xl border border-gt-border bg-gt-surface">
      {/* Header row: time slots */}
      <div className="flex sticky top-0 z-10 bg-gt-surface/95 backdrop-blur border-b border-gt-border">
        {/* Sport label header */}
        <div className="shrink-0 flex items-center justify-center px-2 text-[10px] text-gt-muted uppercase tracking-wide border-r border-gt-border"
          style={{ width: LABEL_WIDTH, minHeight: 36 }}>
          Sport
        </div>
        {/* Scrollable time header */}
        <div className="flex-1 overflow-hidden">
          <div ref={containerRef} className="overflow-x-auto scrollbar-hide">
            <div className="flex" style={{ width: hoursToShow * CELL_WIDTH }}>
              {timeSlots.map((slot, i) => (
                <div
                  key={i}
                  className="shrink-0 border-r border-gt-border/50 flex items-center px-2"
                  style={{ width: CELL_WIDTH, height: 36 }}
                >
                  <span className="text-xs tabular-nums text-gt-muted font-medium">
                    {formatTime(slot.toISOString(), tz, prefs.use24h)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Scrollable grid body */}
      <div className="flex">
        {/* Sport labels */}
        <div className="shrink-0 border-r border-gt-border" style={{ width: LABEL_WIDTH }}>
          {rows.map(sport => (
            <div
              key={sport}
              className="flex items-center gap-1.5 px-2 border-b border-gt-border/50"
              style={{ height: ROW_HEIGHT }}
            >
              <SportIcon sport={sport as SportEvent['sport']} size="xs" />
              <span className="text-[10px] text-gt-muted capitalize truncate">{sport}</span>
            </div>
          ))}
        </div>

        {/* Event rows */}
        <div className="flex-1 overflow-x-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-gt-border">
          <div style={{ width: hoursToShow * CELL_WIDTH, position: 'relative' }}>
            {/* Current time marker */}
            <div
              className="absolute top-0 bottom-0 w-px bg-red-500/70 z-20 pointer-events-none"
              style={{ left: nowLeft }}
            >
              <div className="w-2 h-2 rounded-full bg-red-500 -translate-x-1/2 -translate-y-0" />
            </div>

            {/* Hour grid lines */}
            {timeSlots.map((_, i) => (
              <div
                key={i}
                className="absolute top-0 bottom-0 border-r border-gt-border/30"
                style={{ left: i * CELL_WIDTH }}
              />
            ))}

            {/* Rows */}
            {rows.map(sport => {
              const sportEvents = events.filter(e => e.sport === sport);
              return (
                <div
                  key={sport}
                  className="relative border-b border-gt-border/50"
                  style={{ height: ROW_HEIGHT }}
                >
                  {sportEvents.map(event => {
                    const { left, width } = positionEvent(event, startHour);
                    if (left + width < 0 || left > hoursToShow * CELL_WIDTH) return null;
                    const rel = getRelativeTime(event.startTimeUtc);
                    return (
                      <button
                        key={event.id}
                        onClick={() => dispatch({ type: 'OPEN_DRAWER', payload: event.id })}
                        className={`absolute top-1 bottom-1 rounded-md px-2 py-1 text-left overflow-hidden transition-all hover:brightness-110 cursor-pointer ${
                          event.isLive
                            ? 'bg-red-500/20 border border-red-500/40'
                            : 'bg-gt-accent/10 border border-gt-accent/20'
                        }`}
                        style={{ left: Math.max(0, left), width: left < 0 ? width + left : width }}
                        title={event.eventTitle}
                      >
                        <div className="text-[11px] font-semibold text-gt-text truncate leading-tight">
                          {event.eventTitle}
                        </div>
                        <div className="flex items-center gap-1 mt-0.5">
                          {event.isLive && <StatusPill status="live" size="xs" />}
                          {!event.isLive && rel.isSoon && (
                            <span className="text-[9px] text-amber-400">in {rel.label}</span>
                          )}
                          <span className="text-[9px] text-gt-muted truncate">
                            {event.broadcasters[0]?.shortName ?? 'TBA'}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
