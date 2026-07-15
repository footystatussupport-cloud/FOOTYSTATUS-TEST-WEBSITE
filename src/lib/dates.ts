/**
 * Shared date formatting for Footy Status.
 *
 * formatDateOfBirth is the single source of truth for how a player's Date of
 * Birth is DISPLAYED: US MM/DD/YYYY (e.g. 2006-06-16 -> 06/16/2006). This is a
 * display-only transform — the value is still stored as ISO (YYYY-MM-DD) in the
 * database and `<input type="date">` fields must keep using the raw ISO value.
 *
 * The ISO parts are parsed directly (not via `new Date()`) so the day never
 * shifts by one due to timezone conversion.
 */
export const formatDateOfBirth = (value?: string | null): string => {
  if (!value) return "";
  const str = String(value).trim();
  if (!str) return "";

  // Stored / ISO form: YYYY-MM-DD(...)
  const iso = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const [, y, m, d] = iso;
    return `${m}/${d}/${y}`;
  }

  // Already MM/DD/YYYY (or M/D/YYYY) — normalize the padding.
  const mdy = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (mdy) {
    const [, m, d, y] = mdy;
    return `${m.padStart(2, "0")}/${d.padStart(2, "0")}/${y}`;
  }

  // Fallback for any other parseable date string (use UTC to avoid day shift).
  const dt = new Date(str);
  if (!Number.isNaN(dt.getTime())) {
    const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
    const d = String(dt.getUTCDate()).padStart(2, "0");
    return `${m}/${d}/${dt.getUTCFullYear()}`;
  }

  return str;
};
