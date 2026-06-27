/** Datum-helpers voor boekingen (ISO-datum 'YYYY-MM-DD', geen tijdzone). */

/** Parse een ING-datum 'JJJJMMDD' naar 'YYYY-MM-DD'. */
export function parseINGDate(yyyymmdd: string): string {
  const s = yyyymmdd.trim();
  if (!/^\d{8}$/.test(s)) {
    throw new Error(`Ongeldige ING-datum: "${yyyymmdd}" (verwacht JJJJMMDD)`);
  }
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

/** Formatteer een Date als ISO-datum 'YYYY-MM-DD'. */
export function toISODate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Maandnummer 1..12 uit een ISO-datum. */
export function monthOfISODate(iso: string): number {
  const m = Number(iso.slice(5, 7));
  if (!Number.isInteger(m) || m < 1 || m > 12) {
    throw new Error(`Ongeldige ISO-datum: "${iso}"`);
  }
  return m;
}
