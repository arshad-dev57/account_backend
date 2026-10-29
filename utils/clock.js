'use strict';

/**
 * Shift times are stored as text, so every reader has to agree on what
 * "9:30 PM", "21:30" and "21:30:00" mean.
 */

function normalizeClock(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(11, 16);
  const match = String(value).trim().match(/^(\d{1,2})(?::(\d{2}))?(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  const meridiem = String(match[4] || '').toLowerCase();
  if (meridiem === 'pm' && hour < 12) hour += 12;
  if (meridiem === 'am' && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function minutesOfDay(value) {
  const clock = normalizeClock(value);
  if (!clock) return null;
  const [hour, minute] = clock.split(':').map(Number);
  return hour * 60 + minute;
}

// The same instant read as wall-clock minutes in a zone, so a check-in log
// taken at 09:05 UTC can be compared with a shift that starts at 09:00 local.
function minutesOfDayInZone(value, timeZone) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(value instanceof Date ? value : new Date(value));
  const hour = Number(parts.find((p) => p.type === 'hour')?.value || 0);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value || 0);
  return hour * 60 + minute;
}

module.exports = { normalizeClock, minutesOfDay, minutesOfDayInZone };
