'use client';

import { useApp, usePrefs } from '@/lib/gametime/context/AppContext';
import { MOCK_EVENTS } from '@/lib/gametime/mock-data/events';
import { SportIcon } from './SportIcon';
import { StatusPill } from './StatusPill';
import { BroadcasterBadge } from './BroadcasterBadge';
import { formatDate, formatTime, formatTimeRange, getRelativeTime, makeCalendarUrl } from '@/lib/gametime/time';
import type { SportEvent } from '@/lib/gametime/types';
import { useEffect } from 'react';

function ShareButton({ event }: { event: SportEvent }) {
  async function share() {
    const text = `${event.eventTitle} — ${event.competition}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: event.eventTitle, text });
      } else {
        await navigator.clipboard.writeText(text);
        alert('Copied to clipboard!');
      }
    } catch {}
  }
  return (
    <button onClick={share} className="gt-btn-ghost text-xs">
      ⤴ Share
    </button>
  );
}

export function EventDrawer() {
  const { state, dispatch, isSaved, isReminded } = useApp();
  const prefs = usePrefs();
  const tz = prefs.timezone || 'UTC';

  const eventId = state.drawerEventId;
  const event = eventId ? MOCK_EVENTS.find(e => e.id === eventId) : null;

  const isOpen = !!event;

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [isOpen]);

  function close() {
    dispatch({ type: 'CLOSE_DRAWER' });
  }

  if (!event) return null;

  const saved = isSaved(event.id);
  const reminded = isReminded(event.id);
  const rel = getRelativeTime(event.startTimeUtc);
  const calendarUrl = makeCalendarUrl(event);

  const relatedEvents = event.relatedEventIds
    ?.map(rid => MOCK_EVENTS.find(e => e.id === rid))
    .filter(Boolean) as SportEvent[];

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
        onClick={close}
        aria-hidden
      />

      {/* Drawer */}
      <div
        className="fixed inset-y-0 right-0 z-50 w-full max-w-md flex flex-col bg-gt-bg border-l border-gt-border shadow-2xl overflow-y-auto"
        role="dialog"
        aria-modal
        aria-label={event.eventTitle}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 bg-gt-bg border-b border-gt-border px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <SportIcon sport={event.sport} size="sm" />
            <span className="text-xs text-gt-muted">{event.competition}</span>
          </div>
          <button
            onClick={close}
            className="size-8 rounded-lg flex items-center justify-center text-gt-muted hover:text-gt-text hover:bg-gt-surface transition-colors"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 px-4 py-4 space-y-5">
          {/* Title & Status */}
          <div>
            <div className="flex items-start justify-between gap-2 mb-2">
              <h2 className="text-lg font-bold text-gt-text leading-snug">{event.eventTitle}</h2>
              <StatusPill status={event.status} isLive={event.isLive} size="sm" />
            </div>
            {event.stage && <p className="text-sm text-gt-muted">{event.stage}</p>}
          </div>

          {/* Time */}
          <div className="gt-surface-card rounded-xl p-3">
            <div className="text-xs text-gt-muted mb-1 uppercase tracking-wider">When</div>
            <div className="text-base font-semibold text-gt-text tabular-nums">
              {formatDate(event.startTimeUtc, tz)}
            </div>
            <div className="text-sm text-gt-text/80 tabular-nums">
              {event.endTimeUtc
                ? formatTimeRange(event.startTimeUtc, event.endTimeUtc, tz, prefs.use24h)
                : formatTime(event.startTimeUtc, tz, prefs.use24h)}
              {' '}
              <span className="text-xs text-gt-muted">({tz.replace(/_/g, ' ')})</span>
            </div>
            <div className={`text-xs mt-1 font-medium ${rel.isLive ? 'text-red-400' : rel.isSoon ? 'text-amber-400' : 'text-gt-muted'}`}>
              {rel.isLive ? '● Live now' : rel.isSoon ? `Starts in ${rel.label}` : rel.minutesUntil > 0 ? `Starts in ${rel.label}` : 'Completed'}
            </div>
          </div>

          {/* Venue */}
          {(event.venue || event.country) && (
            <div className="gt-surface-card rounded-xl p-3">
              <div className="text-xs text-gt-muted mb-1 uppercase tracking-wider">Venue</div>
              <div className="text-sm text-gt-text">{event.venue ?? event.country}</div>
              {event.country && event.venue && (
                <div className="text-xs text-gt-muted">{event.country}</div>
              )}
            </div>
          )}

          {/* Participants */}
          {event.participants.length > 0 && (
            <div className="gt-surface-card rounded-xl p-3">
              <div className="text-xs text-gt-muted mb-2 uppercase tracking-wider">
                {event.participants.length === 2 ? 'Match-up' : 'Participants'}
              </div>
              {event.participants.length === 2 ? (
                <div className="flex items-center justify-between gap-3">
                  <div className="flex-1 text-center">
                    <div className="text-sm font-semibold text-gt-text">{event.participants[0].name}</div>
                    {event.participants[0].rank && (
                      <div className="text-xs text-gt-muted">#{event.participants[0].rank}</div>
                    )}
                    {event.participants[0].nationality && (
                      <div className="text-xs text-gt-muted">{event.participants[0].nationality}</div>
                    )}
                  </div>
                  <span className="text-gt-muted font-bold text-lg">vs</span>
                  <div className="flex-1 text-center">
                    <div className="text-sm font-semibold text-gt-text">{event.participants[1].name}</div>
                    {event.participants[1].rank && (
                      <div className="text-xs text-gt-muted">#{event.participants[1].rank}</div>
                    )}
                    {event.participants[1].nationality && (
                      <div className="text-xs text-gt-muted">{event.participants[1].nationality}</div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="space-y-1">
                  {event.participants.map((p, i) => (
                    <div key={i} className="text-sm text-gt-text">{p.name}</div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Where to watch */}
          <div className="gt-surface-card rounded-xl p-3">
            <div className="text-xs text-gt-muted mb-2 uppercase tracking-wider">Where to Watch</div>
            {event.broadcasters.length > 0 ? (
              <div className="space-y-1.5">
                {event.broadcasters.map(b => (
                  <div key={b.id} className="flex items-center justify-between">
                    <BroadcasterBadge broadcaster={b} size="sm" />
                    <span className="text-[10px] text-gt-muted capitalize">{b.type}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gt-muted italic">Watch info not yet available</p>
            )}
          </div>

          {/* Regional availability */}
          {event.regionAvailability.length > 0 && (
            <div className="gt-surface-card rounded-xl p-3">
              <div className="text-xs text-gt-muted mb-2 uppercase tracking-wider">Regional Coverage</div>
              <div className="space-y-2">
                {event.regionAvailability.map(r => (
                  <div key={r.region} className="flex items-start justify-between gap-2">
                    <span className="text-xs font-medium text-gt-text shrink-0">{r.region}</span>
                    <div className="flex flex-wrap gap-1 justify-end">
                      {r.broadcasters.map(b => (
                        <span key={b} className="text-[10px] px-1.5 py-0.5 rounded bg-gt-surface border border-gt-border text-gt-muted">
                          {b}
                        </span>
                      ))}
                      {r.isGeolocked && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500 border border-zinc-700">🔒 Geo</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Related events (e.g., F1 weekend sessions) */}
          {relatedEvents.length > 0 && (
            <div>
              <div className="text-xs text-gt-muted mb-2 uppercase tracking-wider">Weekend Sessions</div>
              <div className="space-y-1">
                {relatedEvents.map(re => (
                  <button
                    key={re.id}
                    onClick={() => dispatch({ type: 'OPEN_DRAWER', payload: re.id })}
                    className="w-full text-left flex items-center justify-between px-3 py-2 rounded-lg border border-gt-border bg-gt-surface hover:bg-gt-surface-hover transition-colors"
                  >
                    <span className="text-xs font-medium text-gt-text">{re.eventTitle}</span>
                    <span className="text-xs text-gt-muted tabular-nums">{formatTime(re.startTimeUtc, tz, prefs.use24h)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Data confidence */}
          <div className="flex items-center gap-2 text-[10px] text-gt-muted">
            <span className={`size-1.5 rounded-full ${event.confidence === 'high' ? 'bg-emerald-500' : event.confidence === 'medium' ? 'bg-amber-500' : 'bg-red-500'}`} />
            Watch data: {event.confidence} confidence · via {event.source}
          </div>
        </div>

        {/* Actions */}
        <div className="sticky bottom-0 bg-gt-bg border-t border-gt-border px-4 py-3">
          <div className="flex gap-2 mb-2">
            <button
              onClick={() => dispatch({ type: 'TOGGLE_SAVED_EVENT', payload: event.id })}
              className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors border ${
                saved
                  ? 'bg-gt-accent/20 border-gt-accent/50 text-gt-accent'
                  : 'bg-gt-surface border-gt-border text-gt-muted hover:text-gt-text hover:border-gt-accent/30'
              }`}
            >
              {saved ? '★ Saved' : '☆ Save'}
            </button>
            <button
              onClick={() => dispatch({ type: 'TOGGLE_REMINDED_EVENT', payload: event.id })}
              className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors border ${
                reminded
                  ? 'bg-amber-500/20 border-amber-500/50 text-amber-400'
                  : 'bg-gt-surface border-gt-border text-gt-muted hover:text-gt-text'
              }`}
            >
              {reminded ? '🔔 Reminded' : '🔔 Remind me'}
            </button>
          </div>
          <div className="flex gap-2">
            <a
              href={calendarUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 py-2 rounded-lg text-xs text-center bg-gt-surface border border-gt-border text-gt-muted hover:text-gt-text transition-colors"
            >
              📅 Add to Calendar
            </a>
            <ShareButton event={event} />
          </div>
        </div>
      </div>
    </>
  );
}
