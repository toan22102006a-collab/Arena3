const ICT = "Asia/Ho_Chi_Minh";

/** Interpret YYYY-MM-DD + HH:mm as ICT wall clock (VN has no DST). */
export function ictDateTime(date: string, hm: string): Date {
  const time = hm.length === 5 ? `${hm}:00` : hm;
  return new Date(`${date}T${time}+07:00`);
}

export function ictNow(): Date {
  return new Date();
}

export function ictDateString(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: ICT,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

export function ictHour(d: Date): number {
  return Math.floor(ictMinutes(d) / 60);
}

/**
 * An instant as a Vietnamese reader expects to see it: `27/09/2026 19:00`.
 *
 * For invoice goods lines and anything else a member reads on paper. Takes the
 * raw timestamptz string the database hands back, so callers do not each parse
 * it their own way.
 */
export function ictStamp(at: string | Date): string {
  const d = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(d.getTime())) return String(at);
  const p = new Intl.DateTimeFormat("en-GB", {
    timeZone: ICT,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${get("day")}/${get("month")}/${get("year")} ${get("hour")}:${get("minute")}`;
}

/** Just the `HH:mm` half of {@link ictStamp}. */
export function ictClock(at: string | Date): string {
  return ictStamp(at).slice(-5);
}

/** Minutes since midnight in ICT (0–1439). */
export function ictMinutes(d: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: ICT,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return hour * 60 + minute;
}

export function ictWeekday(d: Date): number {
  // 0 Sun … 6 Sat in ICT
  const wd = new Intl.DateTimeFormat("en-US", { timeZone: ICT, weekday: "short" }).format(d);
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(wd);
}

export function isWeekendIct(d: Date): boolean {
  const wd = ictWeekday(d);
  return wd === 0 || wd === 6;
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d! + n));
  return dt.toISOString().slice(0, 10);
}

export function roundVnd(n: number, step = 1000): number {
  return Math.round(n / step) * step;
}

export function formatVnd(n: number): string {
  return `${new Intl.NumberFormat("en-US").format(n)}đ`;
}

export function slotHours(): number[] {
  const hours: number[] = [];
  for (let h = 6; h <= 21; h += 1) hours.push(h);
  return hours;
}

export function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

export function elapsedAtLeast(lastAt: number | undefined, now: number, everyMs: number) {
  return lastAt == null || now - lastAt >= everyMs;
}
