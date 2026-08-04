// KST day math — the whole game resets at 00:00 KST (UTC+9), matching the
// platform's daily-habit convention. Days are 'YYYY-MM-DD' strings.

const KST_OFFSET_MS = 9 * 60 * 60 * 1000

/** KST calendar date of a unix-seconds timestamp. */
export function kstDateOf(unixSec: number): string {
  return new Date(unixSec * 1000 + KST_OFFSET_MS).toISOString().slice(0, 10)
}

export function todayKst(): string {
  return kstDateOf(Math.floor(Date.now() / 1000))
}

/** Unix-second bounds [from, to) of a KST calendar day. */
export function kstDayBounds(dateStr: string): { fromTs: number; toTs: number } {
  const fromTs = Math.floor(new Date(`${dateStr}T00:00:00+09:00`).getTime() / 1000)
  return { fromTs, toTs: fromTs + 86400 }
}

export function addDaysStr(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** Inclusive list of KST dates from fromDate to toDate. */
export function kstDatesBetween(fromDate: string, toDate: string): string[] {
  const out: string[] = []
  let cur = fromDate
  while (cur <= toDate && out.length < 400) {
    out.push(cur)
    cur = addDaysStr(cur, 1)
  }
  return out
}

/** Next 00:00 KST as an ISO UTC string (for "resets at" display). */
export function nextKstMidnightUtc(): string {
  const tomorrow = addDaysStr(todayKst(), 1)
  return new Date(`${tomorrow}T00:00:00+09:00`).toISOString()
}
