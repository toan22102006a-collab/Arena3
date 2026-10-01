#!/usr/bin/env node
/**
 * Live checks for Phase 4B: the manager reports (revenue with a previous-period
 * comparison, court capacity with a heatmap, members and classes) and their
 * Excel / PDF files. Run against a throwaway dev server on in-memory PGLite,
 * never production: it creates a member.
 *
 *   DATABASE_URL= DATABASE_URL_UNPOOLED= PGLITE_DATA_DIR=memory npm run dev -- --port 8090
 *   BASE=http://127.0.0.1:8090 node scripts/arena3-phase4b-check.mjs
 */
import { unzipSync, strFromU8 } from "fflate";

const BASE = (process.env.BASE ?? "http://127.0.0.1:8080").replace(/\/+$/, "");
const PASS = "ChangeMe!a3";
let passed = 0;

function fail(msg, extra) {
  console.error("FAIL", msg, extra === undefined ? "" : JSON.stringify(extra).slice(0, 600));
  process.exit(1);
}
function ok(cond, msg, extra) {
  if (!cond) fail(msg, extra);
  passed += 1;
  console.log("ok  ", msg);
}

async function raw(path, token) {
  const headers = { accept: "*/*" };
  if (token) headers.authorization = `Bearer ${token}`;
  return fetch(`${BASE}/v1${path}`, { headers });
}
async function req(path, { method = "GET", token, body } = {}) {
  const headers = { accept: "application/json" };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}/v1${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: res.status, data };
}
async function login(phone) {
  const r = await req("/auth/login", { method: "POST", body: { login: phone, password: PASS } });
  if (r.status !== 200 || !r.data?.token) fail(`login ${phone}`, r);
  return r.data;
}

const mgr = await login("0900000001");
const desk = await login("0900000002");
const day = (offset) => new Date(Date.now() + 7 * 3600000 + offset * 86400000).toISOString().slice(0, 10);
const today = day(0);
const from = day(-29);

// ---- revenue: filters, validation, previous period --------------------------
{
  const denied = await req(`/reports/revenue?from=${from}&to=${today}`, { token: desk.token });
  ok(denied.status === 403, "reception cannot read the revenue report", denied);
  const badDate = await req(`/reports/revenue?from=yesterday`, { token: mgr.token });
  ok(badDate.status === 400 && badDate.data.field === "from", "a bad date names the field", badDate);
  const backwards = await req(`/reports/revenue?from=${today}&to=${from}`, { token: mgr.token });
  ok(backwards.status === 400 && backwards.data.field === "to", "an end before the start names the field", backwards);
  const badMethod = await req(`/reports/revenue?from=${from}&to=${today}&method=barter`, { token: mgr.token });
  ok(badMethod.status === 400 && badMethod.data.field === "method", "an unknown method names the field", badMethod);

  const cur = await req(`/reports/revenue?from=${from}&to=${today}`, { token: mgr.token });
  ok(cur.status === 200 && cur.data.prev, "the revenue report carries the previous period", cur);
  ok(cur.data.prev.to === day(-30) && cur.data.prev.from === day(-59), "…the same length, ending the day before", cur.data.prev);
  const direct = await req(`/reports/revenue?from=${cur.data.prev.from}&to=${cur.data.prev.to}`, { token: mgr.token });
  ok(
    direct.data.totals.revenue_vnd === cur.data.prev.totals.revenue_vnd && direct.data.totals.gross_vnd === cur.data.prev.totals.gross_vnd,
    "…and equals asking for that window directly",
    { a: direct.data.totals, b: cur.data.prev.totals },
  );
  ok(cur.data.totals.revenue_vnd === cur.data.totals.gross_vnd - cur.data.totals.refund_vnd, "revenue is taken minus refunds", cur.data.totals);
  const cash = await req(`/reports/revenue?from=${from}&to=${today}&method=cash`, { token: mgr.token });
  ok(
    cash.status === 200 &&
      Object.keys(cash.data.by_method).every((m) => m === "cash") &&
      cash.data.totals.gross_vnd === (cur.data.by_method.cash ?? 0),
    "the method filter keeps one method",
    cash.data.by_method,
  );
}

// ---- capacity (FR-CRT-09) -------------------------------------------------------
{
  const denied = await req(`/reports/capacity?from=${day(-6)}&to=${today}`, { token: desk.token });
  ok(denied.status === 403, "reception cannot read the capacity report", denied);
  const tooLong = await req(`/reports/capacity?from=${day(-200)}&to=${today}`, { token: mgr.token });
  ok(tooLong.status === 400 && tooLong.data.field === "from", "a window over a quarter is refused", tooLong);
  const badSport = await req(`/reports/capacity?from=${day(-6)}&to=${today}&sport=chess`, { token: mgr.token });
  ok(badSport.status === 400 && badSport.data.field === "sport", "an unknown sport names the field", badSport);

  const t0 = Date.now();
  const r = await req(`/reports/capacity?from=${day(-6)}&to=${day(7)}`, { token: mgr.token });
  const ms = Date.now() - t0;
  ok(r.status === 200, "the capacity report loads", r);
  ok(ms < 5000, `…inside five seconds (${ms} ms)`, ms);
  const d = r.data;
  ok(d.courts.length > 0 && d.hours.length === d.close_hour - d.open_hour, "it lists every ready court and every open hour", d.hours);
  ok(
    d.courts.every((c) => c.cells.length === d.hours.length && c.cells.every((p) => p >= 0 && p <= 100) && c.pct >= 0 && c.pct <= 100),
    "heatmap cells are percentages",
    d.courts[0],
  );
  ok(d.totals.sold_min === d.courts.reduce((s, c) => s + c.sold_min, 0), "the totals add up the courts", d.totals);
  ok(d.totals.sold_min > 0, "the seeded classes and bookings count as sold time", d.totals);
  ok(d.by_sport.length > 0 && d.by_sport.every((s) => s.pct >= 0 && s.pct <= 100), "there is a row per sport", d.by_sport);
  ok(
    typeof d.revenue_by_source.court_vnd === "number" && typeof d.revenue_by_source.class_vnd === "number",
    "court rental and class fees are kept apart",
    d.revenue_by_source,
  );
  const one = await req(`/reports/capacity?from=${day(-6)}&to=${day(7)}&sport=badminton`, { token: mgr.token });
  ok(
    one.data.courts.length > 0 && one.data.courts.every((c) => c.sport === "badminton"),
    "the sport filter keeps one sport's courts",
    one.data.courts.map((c) => c.sport),
  );
  const quiet = await req(`/reports/capacity?from=2001-01-01&to=2001-01-02`, { token: mgr.token });
  ok(quiet.status === 200 && quiet.data.totals.sold_min === 0 && quiet.data.totals.pct === 0, "a period with nothing sold is zero, not an error", quiet);
}

// ---- members and classes (FR-PAY-06) -----------------------------------------------
{
  const denied = await req(`/reports/members?from=${from}&to=${today}`, { token: desk.token });
  ok(denied.status === 403, "reception cannot read the members report", denied);
  const before = (await req(`/reports/members?from=${today}&to=${today}`, { token: mgr.token })).data;
  ok(before.trend.length === 12 && before.trend[11].month === today.slice(0, 7), "the trend is twelve months ending this one", before.trend.map((m) => m.month));
  const stamp = String(Date.now()).slice(-7);
  const made = await req("/members", {
    method: "POST",
    token: desk.token,
    body: { full_name: `Report Member ${stamp}`, phone: `088${stamp}`, pii_consent: true },
  });
  ok(made.status === 201, "a new member can be created", made);
  const after = (await req(`/reports/members?from=${today}&to=${today}`, { token: mgr.token })).data;
  ok(after.members.new === before.members.new + 1, "a new member shows in the report", { before: before.members, after: after.members });
  ok(after.trend[11].new_members === before.trend[11].new_members + 1, "…and in this month's trend", after.trend[11]);
  ok(after.members.active >= 0 && after.members.expiring >= 0, "counts are never negative", after.members);
  ok(
    after.classes.every((c) => c.fill_pct === Math.round((c.enrolled / c.capacity) * 1000) / 10),
    "class fill is enrolled over capacity",
    after.classes[0],
  );
  ok(after.attendance_on || after.classes.every((c) => c.attendance_pct === null), "no attendance column without attendance (BR-62)", after.classes[0]);
  const quiet = await req(`/reports/members?from=2001-01-01&to=2001-01-02`, { token: mgr.token });
  ok(quiet.status === 200 && quiet.data.members.new === 0 && quiet.data.members.renewal_rate === null, "an empty period is zeros, not an error", quiet.data.members);
}

// ---- files (FR-PAY-07) ------------------------------------------------------------------
{
  const denied = await raw(`/reports/revenue/export?format=xlsx&from=${from}&to=${today}`, desk.token);
  ok(denied.status === 403, "reception cannot export a report", denied.status);
  const unknown = await raw(`/reports/gossip/export?format=xlsx`, mgr.token);
  ok(unknown.status === 404, "an unknown report is a 404", unknown.status);
  const badFormat = await req(`/reports/revenue/export?format=docx&from=${from}&to=${today}`, { token: mgr.token });
  ok(badFormat.status === 400 && badFormat.data.field === "format", "an unknown format names the field", badFormat);

  for (const kind of ["revenue", "capacity", "members"]) {
    const q = kind === "revenue" ? `from=${from}&to=${today}&method=cash` : `from=${day(-6)}&to=${today}&sport=badminton`;
    const t0 = Date.now();
    const x = await raw(`/reports/${kind}/export?format=xlsx&${q}`, mgr.token);
    const bytes = new Uint8Array(await x.arrayBuffer());
    ok(x.status === 200 && x.headers.get("content-type")?.includes("spreadsheetml"), `${kind}: the Excel file is served`, x.status);
    ok(Date.now() - t0 < 10000, `${kind}: …inside ten seconds`, Date.now() - t0);
    const disp = x.headers.get("content-disposition") ?? "";
    ok(disp.includes(`arena3-${kind}-`) && disp.endsWith('.xlsx"'), `${kind}: …with a named .xlsx file`, disp);
    let zip;
    try {
      zip = unzipSync(bytes);
    } catch (e) {
      fail(`${kind}: the Excel file is not a valid zip`, String(e));
    }
    const names = Object.keys(zip);
    ok(
      ["[Content_Types].xml", "xl/workbook.xml", "xl/styles.xml", "xl/worksheets/sheet1.xml"].every((n) => names.includes(n)),
      `${kind}: it has the parts of a workbook`,
      names,
    );
    const sheet1 = strFromU8(zip["xl/worksheets/sheet1.xml"]);
    ok(sheet1.includes("Period"), `${kind}: the chosen period is in the header`, sheet1.slice(0, 300));
    ok(kind === "revenue" ? sheet1.includes("Cash") : sheet1.includes("Badminton"), `${kind}: the chosen filter is in the header`, sheet1.slice(0, 600));
    ok(
      names.filter((n) => n.endsWith(".xml") || n.endsWith(".rels")).every((n) => strFromU8(zip[n]).startsWith("<?xml")),
      `${kind}: every part is XML`,
      names,
    );

    const p = await raw(`/reports/${kind}/export?format=pdf&${q}`, mgr.token);
    const pdf = new Uint8Array(await p.arrayBuffer());
    ok(
      p.status === 200 && p.headers.get("content-type") === "application/pdf" && String.fromCharCode(...pdf.slice(0, 5)) === "%PDF-" && pdf.length > 1500,
      `${kind}: the PDF is served`,
      { status: p.status, size: pdf.length },
    );
  }
  // Numbers stay numbers in the workbook, so a column can be summed.
  const rev = await raw(`/reports/revenue/export?format=xlsx&from=${from}&to=${today}`, mgr.token);
  const zip = unzipSync(new Uint8Array(await rev.arrayBuffer()));
  const sheet = strFromU8(zip["xl/worksheets/sheet1.xml"]);
  ok(/<c r="B\d+"><v>-?\d+(\.\d+)?<\/v><\/c>/.test(sheet), "amounts are numeric cells, not text", sheet.slice(-700));
}

console.log(`\n${passed} checks passed`);
