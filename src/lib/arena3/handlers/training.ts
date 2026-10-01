/**
 * Phase 4C — the F4 training module (SRS v1.4 §FR-TRN).
 *
 * Every route here sits behind the F4 flag (BR-62) and never touches money or a
 * membership's balance (BR-56): homework, results and reviews are the coach's
 * record of how a student is doing, nothing the till reads.
 *
 * Who may see a student: a manager sees everyone; a coach sees only students
 * enrolled in a class they lead or assist (BR-59). A student's health notes
 * only leave this module inside that scope (BR-55).
 */
import type { Sql } from "@/lib/db";
import { err } from "../errors";
import { requireFlag } from "../flags";
import { audit, enqueue, readJson, str } from "../helpers";
import {
  ABSENT_STREAK_LIMIT,
  LEVELS,
  PLAN_PHASES,
  SPORTS,
  TRAINING_GOALS,
  absentStreak,
  homeworkComplete,
  normalizeChecklist,
  normalizeDone,
  validateMetrics,
} from "../rules";
import { normalizePhone } from "../phone";
import { requireRole, type PublicUser } from "../session";
import { addDays, ictDateString, ictDateTime } from "../time";
import { one } from "../tx";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

function uuidField(v: unknown, field: string): string {
  const s = str(v);
  if (!s || !UUID_RE.test(s)) throw err.field(field, `${field} is required.`);
  return s;
}

function pathId(id: string): string {
  if (!UUID_RE.test(id)) throw err.notFound();
  return id;
}

/* ------------------------------------------------------------------ *
 * Scope                                                               *
 * ------------------------------------------------------------------ */

type ClassStaff = { id: string; coach_id: string; assistant_id: string | null; status: string; sport: string };

async function loadClass(sql: Sql, classId: string): Promise<ClassStaff> {
  const cl = await one<ClassStaff>(
    sql,
    `select id, coach_id, assistant_id, status::text as status, sport::text as sport from classes where id = $1`,
    [classId],
  );
  if (!cl) throw err.notFound("Class not found.");
  return cl;
}

/** A coach works only the classes they lead or assist; a manager works them all. */
export function assertClassStaff(cl: { coach_id: string; assistant_id: string | null }, user: PublicUser) {
  if (user.role === "manager") return;
  if (cl.coach_id === user.id || cl.assistant_id === user.id) return;
  throw err.forbidden("That class is not yours.");
}

/**
 * Load a session and check the caller may work it (BR-59).
 * Used by the attendance routes as well, so it lives here.
 */
export async function sessionScope(sql: Sql, sessionId: string, user: PublicUser) {
  const s = await one<{
    id: string;
    class_id: string;
    status: string;
    start_at: string;
    end_at: string;
    coach_id: string;
    assistant_id: string | null;
    sport: string;
  }>(
    sql,
    `select s.id, s.class_id, s.status::text as status, s.start_at, s.end_at,
            cl.coach_id, cl.assistant_id, cl.sport::text as sport
       from sessions s join classes cl on cl.id = s.class_id
      where s.id = $1`,
    [pathId(sessionId)],
  );
  if (!s) throw err.notFound();
  assertClassStaff(s, user);
  return s;
}

async function studentInScope(sql: Sql, studentId: string, user: PublicUser): Promise<boolean> {
  if (user.role === "manager") return true;
  const row = await one(
    sql,
    `select 1 as ok from enrollments e join classes cl on cl.id = e.class_id
      where e.user_id = $1 and e.status = 'confirmed' and (cl.coach_id = $2 or cl.assistant_id = $2)
      limit 1`,
    [studentId, user.id],
  );
  return !!row;
}

type Student = {
  id: string;
  full_name: string;
  member_code: string | null;
  date_of_birth: string | null;
  health_notes: string | null;
};

async function loadStudent(sql: Sql, id: string, user: PublicUser): Promise<Student> {
  const u = await one<Student>(
    sql,
    `select id, full_name, member_code, date_of_birth::text as date_of_birth, health_notes
       from users where id = $1 and role = 'member'`,
    [pathId(id)],
  );
  if (!u) throw err.notFound("Student not found.");
  if (!(await studentInScope(sql, u.id, user))) throw err.forbidden("That student is not in your classes.");
  return u;
}

function oneOf<T extends string>(list: readonly T[], v: unknown, field: string): T {
  const s = str(v);
  if (!s || !(list as readonly string[]).includes(s)) {
    throw err.field(field, `${field} must be one of: ${list.join(", ")}.`);
  }
  return s as T;
}

/* ------------------------------------------------------------------ *
 * Student profile (FR-TRN-03)                                         *
 * ------------------------------------------------------------------ */

export async function studentProfile(sql: Sql, id: string, user: PublicUser) {
  requireRole(user, ["coach", "manager"]);
  await requireFlag(sql, "F4");
  const student = await loadStudent(sql, id, user);
  const goal = await one<{ goal: string | null }>(sql, `select goal from training_profiles where user_id = $1`, [student.id]);
  const levels = await sql.query(
    `select sport::text as sport, level, updated_at from member_levels where user_id = $1 order by sport`,
    [student.id],
  );
  const notes = await sql.query(
    `select n.id, n.body, n.created_at, c.full_name as coach_name
       from coach_notes n join users c on c.id = n.coach_id
      where n.user_id = $1 order by n.created_at desc limit 30`,
    [student.id],
  );
  const reviews = await sql.query(
    `select r.id, r.sport::text as sport, r.period_weeks, r.technique, r.fitness, r.attitude, r.comment,
            r.created_at, c.full_name as coach_name
       from progress_reviews r join users c on c.id = r.coach_id
      where r.user_id = $1 order by r.created_at desc limit 20`,
    [student.id],
  );
  const results = await sql.query(
    `select r.session_id, r.plan_pct, r.metrics, r.note, r.recorded_at, s.start_at, cl.sport::text as sport
       from session_results r
       join sessions s on s.id = r.session_id
       join classes cl on cl.id = s.class_id
      where r.user_id = $1 order by s.start_at desc limit 20`,
    [student.id],
  );
  const counts = { present: 0, late: 0, absent: 0, excused: 0 } as Record<string, number>;
  const marks = await sql.query<{ result: string; n: number }>(
    `select result::text as result, count(*)::int as n from attendance
      where user_id = $1 and kind = 'session' and result is not null group by result`,
    [student.id],
  );
  for (const m of marks) if (m.result in counts) counts[m.result] = m.n;
  const homework = await sql.query(
    `select h.id, h.title, h.due_on::text as due_on, h.checklist, r.done_items, r.completed_at
       from homework_recipients r join homework h on h.id = r.homework_id
      where r.user_id = $1 order by h.created_at desc limit 20`,
    [student.id],
  );
  return {
    status: 200,
    body: { student, goal: goal?.goal ?? null, levels, notes, reviews, results, attendance: counts, homework },
  };
}

export async function meTrainingGoal(sql: Sql, request: Request, user: PublicUser) {
  requireRole(user, ["member"]);
  await requireFlag(sql, "F4");
  const b = await readJson(request);
  const goal = b.goal === null ? null : oneOf(TRAINING_GOALS, b.goal, "goal");
  await sql.query(
    `insert into training_profiles (user_id, goal, updated_at) values ($1, $2, now())
     on conflict (user_id) do update set goal = excluded.goal, updated_at = now()`,
    [user.id, goal],
  );
  return { status: 200, body: { goal } };
}

export async function studentLevelPut(sql: Sql, id: string, request: Request, user: PublicUser) {
  requireRole(user, ["coach", "manager"]);
  await requireFlag(sql, "F4");
  const student = await loadStudent(sql, id, user);
  const b = await readJson(request);
  const sport = oneOf(SPORTS, b.sport, "sport");
  const level = oneOf(LEVELS, b.level, "level");
  const before = await one(sql, `select level from member_levels where user_id = $1 and sport = $2::sport_kind`, [student.id, sport]);
  await sql.query(
    `insert into member_levels (user_id, sport, level, assessed_by, updated_at)
     values ($1, $2::sport_kind, $3, $4, now())
     on conflict (user_id, sport) do update
       set level = excluded.level, assessed_by = excluded.assessed_by, updated_at = now()`,
    [student.id, sport, level, user.id],
  );
  await audit(sql, user.id, "student_level", "user", student.id, before, { sport, level });
  return { status: 200, body: { sport, level } };
}

export async function studentNotePost(sql: Sql, id: string, request: Request, user: PublicUser) {
  requireRole(user, ["coach", "manager"]);
  await requireFlag(sql, "F4");
  const student = await loadStudent(sql, id, user);
  const body = (str((await readJson(request)).body) ?? "").trim();
  if (!body) throw err.field("body", "Write something first.");
  if (body.length > 2000) throw err.field("body", "Keep a note under 2000 characters.");
  const row = await one(
    sql,
    `insert into coach_notes (user_id, coach_id, body) values ($1,$2,$3) returning id, body, created_at`,
    [student.id, user.id, body],
  );
  return { status: 201, body: row };
}

/* ------------------------------------------------------------------ *
 * Reviews (FR-TRN-06) — append only                                   *
 * ------------------------------------------------------------------ */

function score(v: unknown, field: string): number {
  const n = typeof v === "string" && v !== "" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > 5) {
    throw err.field(field, `${field} is a score from 1 to 5.`);
  }
  return n;
}

export async function studentReviewPost(sql: Sql, id: string, request: Request, user: PublicUser) {
  requireRole(user, ["coach", "manager"]);
  await requireFlag(sql, "F4");
  const student = await loadStudent(sql, id, user);
  const b = await readJson(request);
  const sport = oneOf(SPORTS, b.sport, "sport");
  const period = Number(b.period_weeks);
  if (period !== 2 && period !== 4) throw err.field("period_weeks", "A review covers 2 or 4 weeks.");
  const technique = score(b.technique, "technique");
  const fitness = score(b.fitness, "fitness");
  const attitude = score(b.attitude, "attitude");
  const comment = (str(b.comment) ?? "").trim();
  if (comment.length > 2000) throw err.field("comment", "Keep the comment under 2000 characters.");
  const row = await one<{ id: string; created_at: string }>(
    sql,
    `insert into progress_reviews (user_id, sport, coach_id, period_weeks, technique, fitness, attitude, comment)
     values ($1, $2::sport_kind, $3, $4, $5, $6, $7, $8)
     returning id, created_at`,
    [student.id, sport, user.id, period, technique, fitness, attitude, comment || null],
  );
  if (!row) throw err.notFound();
  await enqueue(
    sql,
    "inapp",
    "review_added",
    student.id,
    { review_id: row.id, sport, coach_name: user.full_name, period_weeks: period },
    `review:${row.id}`,
  );
  return { status: 201, body: { id: row.id, created_at: row.created_at } };
}

/* ------------------------------------------------------------------ *
 * Session results (FR-TRN-05)                                         *
 * ------------------------------------------------------------------ */

export async function sessionResultsGet(sql: Sql, sessionId: string, user: PublicUser) {
  requireRole(user, ["coach", "manager"]);
  await requireFlag(sql, "F4");
  const s = await sessionScope(sql, sessionId, user);
  const items = await sql.query(
    `select u.id as user_id, u.full_name, u.member_code, a.result::text as attendance,
            r.plan_pct, r.metrics, r.note
       from enrollments e
       join users u on u.id = e.user_id
       left join attendance a on a.session_id = $1 and a.user_id = u.id and a.kind = 'session'
       left join session_results r on r.session_id = $1 and r.user_id = u.id
      where e.class_id = $2 and e.status = 'confirmed'
      order by u.full_name`,
    [s.id, s.class_id],
  );
  return { status: 200, body: { session: { id: s.id, class_id: s.class_id, status: s.status }, items } };
}

export async function sessionResultsPut(sql: Sql, sessionId: string, request: Request, user: PublicUser) {
  requireRole(user, ["coach", "manager"]);
  await requireFlag(sql, "F4");
  const s = await sessionScope(sql, sessionId, user);
  if (s.status === "cancelled") throw err.conflictState("That session was cancelled.");
  const b = await readJson(request);
  const items = Array.isArray(b.items) ? (b.items as Record<string, unknown>[]) : null;
  if (!items || items.length === 0) throw err.field("items", "Nothing to save.");
  type Parsed = { uid: string; pct: number | null; metrics: Record<string, number>; note: string };
  const parsed: Parsed[] = [];
  for (const [i, it] of items.entries()) {
    const uid = uuidField(it.user_id, "user_id");
    let pct: number | null = null;
    if (it.plan_pct !== undefined && it.plan_pct !== null && it.plan_pct !== "") {
      const n = Number(it.plan_pct);
      if (!Number.isInteger(n) || n < 0 || n > 100) {
        throw err.field("plan_pct", `Row ${i + 1}: plan completion is a whole number from 0 to 100.`, { index: i });
      }
      pct = n;
    }
    const m = validateMetrics(it.metrics);
    if (!m.ok) throw err.field(m.field, `Row ${i + 1}: ${m.message}`, { index: i });
    const note = (str(it.note) ?? "").trim();
    if (note.length > 1000) throw err.field("note", `Row ${i + 1}: keep a note under 1000 characters.`, { index: i });
    const enrolled = await one(
      sql,
      `select 1 as ok from enrollments where class_id = $1 and user_id = $2 and status = 'confirmed'`,
      [s.class_id, uid],
    );
    if (!enrolled) throw err.field("user_id", `Row ${i + 1}: that student is not in this class.`, { index: i });
    parsed.push({ uid, pct, metrics: m.metrics, note });
  }
  for (const p of parsed) {
    const empty = p.pct === null && Object.keys(p.metrics).length === 0 && !p.note;
    if (empty) {
      await sql.query(`delete from session_results where session_id = $1 and user_id = $2`, [s.id, p.uid]);
      continue;
    }
    await sql.query(
      `insert into session_results (session_id, user_id, plan_pct, metrics, note, recorded_by, recorded_at)
       values ($1,$2,$3,$4::jsonb,$5,$6, now())
       on conflict (session_id, user_id) do update
         set plan_pct = excluded.plan_pct, metrics = excluded.metrics, note = excluded.note,
             recorded_by = excluded.recorded_by, recorded_at = now()`,
      [s.id, p.uid, p.pct, JSON.stringify(p.metrics), p.note || null, user.id],
    );
  }
  return sessionResultsGet(sql, s.id, user);
}

/* ------------------------------------------------------------------ *
 * Attendance side effects                                             *
 * ------------------------------------------------------------------ */

/**
 * BR-58: three absences in a row put the student on the manager's and the
 * coach's radar. Nothing is cancelled and nobody is un-enrolled — it is a nudge.
 *
 * The dedupe key carries the latest marked session, so saving the same register
 * twice is silent and a fourth absence raises a fresh alert.
 */
export async function checkAbsentStreaks(sql: Sql, classId: string, userIds: string[]) {
  if (userIds.length === 0) return;
  const cl = await one<{ coach_id: string; assistant_id: string | null; sport: string }>(
    sql,
    `select coach_id, assistant_id, sport::text as sport from classes where id = $1`,
    [classId],
  );
  if (!cl) return;
  for (const uid of userIds) {
    const marks = await sql.query<{ session_id: string; result: string }>(
      `select s.id as session_id, a.result::text as result
         from attendance a join sessions s on s.id = a.session_id
        where a.user_id = $1 and a.kind = 'session' and s.class_id = $2
          and a.result is not null and s.status <> 'cancelled'
        order by s.start_at`,
      [uid, classId],
    );
    const streak = absentStreak(marks.map((m) => m.result));
    if (streak < ABSENT_STREAK_LIMIT) continue;
    const latest = marks[marks.length - 1].session_id;
    const who = await one<{ full_name: string }>(sql, `select full_name from users where id = $1`, [uid]);
    const recipients = new Set<string>([cl.coach_id]);
    if (cl.assistant_id) recipients.add(cl.assistant_id);
    for (const m of await sql.query<{ id: string }>(`select id from users where role = 'manager' and status = 'active'`)) {
      recipients.add(m.id);
    }
    for (const r of recipients) {
      await enqueue(
        sql,
        "inapp",
        "absent_streak",
        r,
        { class_id: classId, user_id: uid, member_name: who?.full_name ?? "A student", streak, sport: cl.sport },
        `absent:${classId}:${uid}:${latest}:${r}`,
      );
    }
  }
}

/* ------------------------------------------------------------------ *
 * Homework (FR-TRN-07)                                                *
 * ------------------------------------------------------------------ */

export async function homeworkCreate(sql: Sql, request: Request, user: PublicUser) {
  requireRole(user, ["coach", "manager"]);
  await requireFlag(sql, "F4");
  const b = await readJson(request);
  const title = (str(b.title) ?? "").trim();
  if (!title) throw err.field("title", "Give the homework a title.");
  if (title.length > 120) throw err.field("title", "Keep the title under 120 characters.");
  const body = (str(b.body) ?? "").trim();
  if (body.length > 4000) throw err.field("body", "Keep the description under 4000 characters.");
  const checklist = normalizeChecklist(b.checklist);
  if (!checklist) throw err.field("checklist", "A checklist is up to 20 short items.");
  let dueOn: string | null = null;
  if (b.due_on !== undefined && b.due_on !== null && b.due_on !== "") {
    const d = str(b.due_on) ?? "";
    if (!DATE_RE.test(d) || Number.isNaN(ictDateTime(d, "00:00").getTime())) {
      throw err.field("due_on", "Use a date like 2026-10-12.");
    }
    if (d < ictDateString()) throw err.field("due_on", "The due date is already past.");
    dueOn = d;
  }
  const classId = str(b.class_id) || null;
  const userId = str(b.user_id) || null;
  if ((classId === null) === (userId === null)) {
    throw err.field("class_id", "Choose either a class or one student.");
  }

  let recipients: string[] = [];
  if (classId) {
    const cl = await loadClass(sql, uuidField(classId, "class_id"));
    assertClassStaff(cl, user);
    recipients = (
      await sql.query<{ user_id: string }>(
        `select user_id from enrollments where class_id = $1 and status = 'confirmed'`,
        [cl.id],
      )
    ).map((r) => r.user_id);
    if (recipients.length === 0) throw err.validation("This class has no confirmed students yet.");
  } else {
    const student = await loadStudent(sql, uuidField(userId, "user_id"), user);
    recipients = [student.id];
  }

  const hw = await one<{ id: string; created_at: string }>(
    sql,
    `insert into homework (coach_id, class_id, user_id, title, body, checklist, due_on)
     values ($1,$2,$3,$4,$5,$6::jsonb,$7::date) returning id, created_at`,
    [user.id, classId, userId, title, body || null, JSON.stringify(checklist), dueOn],
  );
  if (!hw) throw err.notFound();
  for (const uid of recipients) {
    await sql.query(`insert into homework_recipients (homework_id, user_id) values ($1,$2)`, [hw.id, uid]);
    await enqueue(
      sql,
      "inapp",
      "homework_assigned",
      uid,
      { homework_id: hw.id, title, due_on: dueOn, coach_name: user.full_name },
      `hw:${hw.id}:${uid}`,
    );
  }
  return { status: 201, body: { id: hw.id, recipients: recipients.length } };
}

export async function homeworkList(sql: Sql, request: Request, user: PublicUser) {
  requireRole(user, ["coach", "manager"]);
  await requireFlag(sql, "F4");
  const classId = new URL(request.url).searchParams.get("class_id");
  const items = await sql.query(
    `select h.id, h.title, h.body, h.checklist, h.due_on::text as due_on, h.created_at, h.class_id, h.user_id,
            co.full_name as coach_name, st.full_name as student_name,
            (select count(*)::int from homework_recipients r where r.homework_id = h.id) as recipients,
            (select count(*)::int from homework_recipients r where r.homework_id = h.id and r.completed_at is not null) as completed
       from homework h
       join users co on co.id = h.coach_id
       left join users st on st.id = h.user_id
      where ($1::uuid is null or h.class_id = $1)
        and ($2::boolean or h.coach_id = $3)
      order by h.created_at desc
      limit 60`,
    [classId && UUID_RE.test(classId) ? classId : null, user.role === "manager", user.id],
  );
  return { status: 200, body: { items } };
}

export async function meHomework(sql: Sql, user: PublicUser) {
  requireRole(user, ["member"]);
  await requireFlag(sql, "F4");
  const items = await sql.query(
    `select h.id, h.title, h.body, h.checklist, h.due_on::text as due_on, h.created_at,
            r.done_items, r.completed_at, co.full_name as coach_name
       from homework_recipients r
       join homework h on h.id = r.homework_id
       join users co on co.id = h.coach_id
      where r.user_id = $1
      order by (r.completed_at is not null), h.due_on nulls last, h.created_at desc
      limit 60`,
    [user.id],
  );
  return { status: 200, body: { items } };
}

export async function meHomeworkPut(sql: Sql, id: string, request: Request, user: PublicUser) {
  requireRole(user, ["member"]);
  await requireFlag(sql, "F4");
  const row = await one<{ checklist: unknown; completed_at: string | null }>(
    sql,
    `select h.checklist, r.completed_at
       from homework_recipients r join homework h on h.id = r.homework_id
      where r.homework_id = $1 and r.user_id = $2
      for update of r`,
    [pathId(id), user.id],
  );
  if (!row) throw err.notFound("That homework is not yours.");
  const b = await readJson(request);
  const total = Array.isArray(row.checklist) ? row.checklist.length : 0;
  const done = normalizeDone(total, b.done_items);
  const complete = homeworkComplete(total, done, b.done === true);
  await sql.query(
    `update homework_recipients
        set done_items = $3::jsonb,
            completed_at = case when $4::boolean then coalesce(completed_at, now()) else null end
      where homework_id = $1 and user_id = $2`,
    [id, user.id, JSON.stringify(done), complete],
  );
  return { status: 200, body: { done_items: done, completed: complete } };
}

/* ------------------------------------------------------------------ *
 * Member progress (FR-TRN-08)                                         *
 * ------------------------------------------------------------------ */

export async function meTraining(sql: Sql, user: PublicUser) {
  requireRole(user, ["member"]);
  await requireFlag(sql, "F4");
  const goal = await one<{ goal: string | null }>(sql, `select goal from training_profiles where user_id = $1`, [user.id]);
  const levels = await sql.query(
    `select sport::text as sport, level, updated_at from member_levels where user_id = $1 order by sport`,
    [user.id],
  );
  const upcoming = await sql.query<{
    id: string;
    class_id: string;
    start_at: string;
    end_at: string;
    sport: string;
    level: string;
    court_code: string;
  }>(
    `select s.id, s.class_id, s.start_at, s.end_at, cl.sport::text as sport, cl.level, c.court_code
       from sessions s
       join classes cl on cl.id = s.class_id
       join courts c on c.id = s.court_id
       join enrollments e on e.class_id = cl.id and e.user_id = $1 and e.status = 'confirmed'
      where s.status = 'scheduled' and s.end_at > now()
      order by s.start_at limit 3`,
    [user.id],
  );
  const next_sessions = [];
  for (const s of upcoming) {
    const plans = await sql.query(
      `select id, title, payload, session_id from training_plans
        where published = true
          and (session_id = $1
               or (session_id is null and (user_id = $2 or (user_id is null and class_id = $3))))
        order by (session_id is not null) desc, created_at desc
        limit 3`,
      [s.id, user.id, s.class_id],
    );
    next_sessions.push({ ...s, plans });
  }
  const results = await sql.query(
    `select r.session_id, r.plan_pct, r.metrics, r.note, s.start_at, cl.sport::text as sport
       from session_results r
       join sessions s on s.id = r.session_id
       join classes cl on cl.id = s.class_id
      where r.user_id = $1 order by s.start_at desc limit 10`,
    [user.id],
  );
  const reviews = await sql.query(
    `select r.id, r.sport::text as sport, r.period_weeks, r.technique, r.fitness, r.attitude, r.comment,
            r.created_at, c.full_name as coach_name
       from progress_reviews r join users c on c.id = r.coach_id
      where r.user_id = $1 order by r.created_at desc limit 10`,
    [user.id],
  );
  const homework = await sql.query(
    `select h.id, h.title, h.body, h.checklist, h.due_on::text as due_on, r.done_items
       from homework_recipients r join homework h on h.id = r.homework_id
      where r.user_id = $1 and r.completed_at is null
      order by h.due_on nulls last, h.created_at desc limit 10`,
    [user.id],
  );
  return {
    status: 200,
    body: { goal: goal?.goal ?? null, levels, next_sessions, results, reviews, homework },
  };
}

/* ------------------------------------------------------------------ *
 * Training plans (FR-TRN-04)                                          *
 * ------------------------------------------------------------------ */

type Block = { order: number; title: string; minutes: number; phase?: string };

function cleanPayload(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw err.field("payload", "A plan needs its blocks.");
  }
  const p = raw as Record<string, unknown>;
  const rawBlocks = Array.isArray(p.blocks) ? (p.blocks as Record<string, unknown>[]) : [];
  if (rawBlocks.length === 0) throw err.field("blocks", "Add at least one block to the plan.");
  if (rawBlocks.length > 12) throw err.field("blocks", "A plan has at most 12 blocks.");
  const blocks: Block[] = rawBlocks.map((b, i) => {
    const title = (str(b?.title) ?? "").trim();
    if (!title) throw err.field("blocks", `Block ${i + 1} needs a title.`, { index: i });
    if (title.length > 120) throw err.field("blocks", `Block ${i + 1}: keep the title under 120 characters.`, { index: i });
    const minutes = Number(b.minutes);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 180) {
      throw err.field("blocks", `Block ${i + 1}: minutes is a whole number from 1 to 180.`, { index: i });
    }
    const out: Block = { order: i + 1, title, minutes };
    if (b.phase !== undefined && b.phase !== null && b.phase !== "") {
      out.phase = oneOf(PLAN_PHASES, b.phase, "phase");
    }
    return out;
  });
  const out: Record<string, unknown> = { blocks };
  for (const k of ["sport", "level", "goal", "note", "generated_on"]) {
    const v = str(p[k]);
    if (v) out[k] = v.slice(0, 400);
  }
  return out;
}

export async function trainingCreate(sql: Sql, request: Request, user: PublicUser) {
  requireRole(user, ["coach", "manager"]);
  await requireFlag(sql, "F4");
  const b = await readJson(request);
  const classId = str(b.class_id) || null;
  const userId = str(b.user_id) || null;
  const sessionId = str(b.session_id) || null;
  if (!classId && !userId) throw err.field("class_id", "Choose a class or a student for this plan.");
  if (classId) assertClassStaff(await loadClass(sql, uuidField(classId, "class_id")), user);
  if (userId) await loadStudent(sql, uuidField(userId, "user_id"), user);
  if (sessionId) {
    if (!classId) throw err.field("session_id", "A session plan belongs to a class.");
    const s = await one<{ class_id: string; status: string }>(
      sql,
      `select class_id, status::text as status from sessions where id = $1`,
      [uuidField(sessionId, "session_id")],
    );
    if (!s || s.class_id !== classId) throw err.field("session_id", "That session is not in this class.");
    if (s.status === "cancelled") throw err.conflictState("That session was cancelled.");
  }
  const title = (str(b.title) ?? "").trim();
  if (title.length > 120) throw err.field("title", "Keep the title under 120 characters.");
  const source = str(b.source) === "ai" ? "ai" : "coach";
  const payload = cleanPayload(b.payload);
  const row = await one(
    sql,
    `insert into training_plans (scope, class_id, user_id, session_id, title, source, published, payload, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)
     returning *`,
    [
      userId ? "user" : "class",
      classId,
      userId,
      sessionId,
      title || null,
      source,
      b.published !== false,
      JSON.stringify(payload),
      user.id,
    ],
  );
  return { status: 201, body: row };
}

/** Publish or unpublish a plan, or fix its title/blocks. Only its author, the class's coaches or a manager. */
export async function trainingPatch(sql: Sql, id: string, request: Request, user: PublicUser) {
  requireRole(user, ["coach", "manager"]);
  await requireFlag(sql, "F4");
  const plan = await one<{ id: string; class_id: string | null; user_id: string | null; created_by: string | null }>(
    sql,
    `select id, class_id, user_id, created_by from training_plans where id = $1 for update`,
    [pathId(id)],
  );
  if (!plan) throw err.notFound();
  if (user.role !== "manager" && plan.created_by !== user.id) {
    if (plan.class_id) assertClassStaff(await loadClass(sql, plan.class_id), user);
    else throw err.forbidden("That plan is not yours.");
  }
  const b = await readJson(request);
  const sets: string[] = [];
  const params: unknown[] = [plan.id];
  if (typeof b.published === "boolean") {
    params.push(b.published);
    sets.push(`published = $${params.length}`);
  }
  if (b.title !== undefined) {
    const title = (str(b.title) ?? "").trim();
    if (title.length > 120) throw err.field("title", "Keep the title under 120 characters.");
    params.push(title || null);
    sets.push(`title = $${params.length}`);
  }
  if (b.payload !== undefined) {
    params.push(JSON.stringify(cleanPayload(b.payload)));
    sets.push(`payload = $${params.length}::jsonb`);
  }
  if (sets.length === 0) throw err.field("published", "Nothing to change.");
  const row = await one(sql, `update training_plans set ${sets.join(", ")} where id = $1 returning *`, params);
  return { status: 200, body: row };
}

/**
 * Copy last week's session plans onto this week's sessions.
 *
 * `from` is any date in the source week (it covers that day and the six after).
 * A target session is left alone when it is cancelled, already past, already has
 * a plan, or already has results — the coach has started it and a copy must not
 * pile a second plan on top. Copies arrive as drafts so nothing reaches students
 * before the coach has looked at it.
 */
export async function plansDuplicateWeek(sql: Sql, classId: string, request: Request, user: PublicUser) {
  requireRole(user, ["coach", "manager"]);
  await requireFlag(sql, "F4");
  const cl = await loadClass(sql, pathId(classId));
  assertClassStaff(cl, user);
  const from = str((await readJson(request)).from) ?? "";
  if (!DATE_RE.test(from) || Number.isNaN(ictDateTime(from, "00:00").getTime())) {
    throw err.field("from", "Use a date like 2026-10-05.");
  }
  const start = ictDateTime(from, "00:00");
  const end = ictDateTime(addDays(from, 7), "00:00");
  const sources = await sql.query<{ id: string; start_at: string }>(
    `select s.id, s.start_at from sessions s
      where s.class_id = $1 and s.status <> 'cancelled' and s.start_at >= $2 and s.start_at < $3
        and exists (select 1 from training_plans p where p.session_id = s.id)
      order by s.start_at`,
    [cl.id, start.toISOString(), end.toISOString()],
  );
  const skipped: { session_id: string; reason: string }[] = [];
  let copied = 0;
  for (const src of sources) {
    const targetStart = new Date(new Date(src.start_at).getTime() + 7 * DAY_MS);
    const target = await one<{ id: string; status: string; end_at: string }>(
      sql,
      `select id, status::text as status, end_at from sessions where class_id = $1 and start_at = $2`,
      [cl.id, targetStart.toISOString()],
    );
    if (!target) {
      skipped.push({ session_id: src.id, reason: "no_session" });
      continue;
    }
    if (target.status === "cancelled") {
      skipped.push({ session_id: target.id, reason: "cancelled" });
      continue;
    }
    if (new Date(target.end_at).getTime() < Date.now()) {
      skipped.push({ session_id: target.id, reason: "past" });
      continue;
    }
    if (await one(sql, `select 1 as ok from session_results where session_id = $1 limit 1`, [target.id])) {
      skipped.push({ session_id: target.id, reason: "has_results" });
      continue;
    }
    if (await one(sql, `select 1 as ok from training_plans where session_id = $1 limit 1`, [target.id])) {
      skipped.push({ session_id: target.id, reason: "has_plan" });
      continue;
    }
    const n = await sql.query(
      `insert into training_plans (scope, class_id, user_id, session_id, title, source, published, payload, created_by)
       select scope, class_id, user_id, $2, title, source, false, payload, $3
         from training_plans where session_id = $1
       returning id`,
      [src.id, target.id, user.id],
    );
    copied += n.length;
  }
  return { status: 200, body: { copied, skipped } };
}

/* ------------------------------------------------------------------ *
 * Gate check-in (FR-TRN-02, BR-54)                                    *
 * ------------------------------------------------------------------ */

const GATE_REPEAT_MS = 5 * 60_000;

/**
 * Let a member in at the door.
 *
 * It writes a `gate` attendance row and nothing else: a class register is the
 * coach's call (BR-54), so walking through the gate never marks anyone present
 * at a session. Scanning twice within five minutes returns the first scan.
 */
export async function gateCheckin(sql: Sql, request: Request, user: PublicUser) {
  requireRole(user, ["receptionist", "manager"]);
  await requireFlag(sql, "F4");
  const b = await readJson(request);
  const id = str(b.member_id) || null;
  const code = str(b.code) || null;
  const phone = str(b.phone) || null;
  if (!id && !code && !phone) throw err.field("code", "Scan a code or type a member code or phone number.");
  let member: { id: string; full_name: string; member_code: string | null; status: string } | undefined;
  const cols = `select id, full_name, member_code, status::text as status from users where role = 'member'`;
  if (id) member = await one(sql, `${cols} and id = $1`, [uuidField(id, "member_id")]);
  else if (code) member = await one(sql, `${cols} and upper(member_code) = upper($1)`, [code]);
  else member = await one(sql, `${cols} and phone = $1`, [normalizePhone(phone as string)]);
  if (!member) throw err.notFound("No member matches that.");
  if (member.status !== "active") throw err.conflictState("This account is not active.", { member_status: member.status });

  const recent = await one<{ at: string }>(
    sql,
    `select at from attendance where user_id = $1 and kind = 'gate' and at > $2 order by at desc limit 1`,
    [member.id, new Date(Date.now() - GATE_REPEAT_MS).toISOString()],
  );
  let checkedInAt: string;
  if (recent) checkedInAt = recent.at;
  else {
    const row = await one<{ at: string }>(
      sql,
      `insert into attendance (kind, user_id) values ('gate', $1) returning at`,
      [member.id],
    );
    checkedInAt = row?.at ?? new Date().toISOString();
  }

  const today = ictDateString();
  const dayStart = ictDateTime(today, "00:00").toISOString();
  const dayEnd = ictDateTime(addDays(today, 1), "00:00").toISOString();
  const plans = await sql.query<{
    id: string;
    name: string;
    sport_scope: string;
    status: string;
    end_on: string;
    session_left: number | null;
    court_hours_left: string;
  }>(
    `select s.id, p.name, s.sport_scope::text as sport_scope, s.status::text as status, s.end_on::text as end_on,
            s.session_left, s.court_hours_left
       from subscriptions s join membership_plans p on p.id = s.plan_id
      where s.user_id = $1 and s.status in ('active','frozen')
      order by s.end_on`,
    [member.id],
  );
  const warnings: { kind: string; message: string }[] = [];
  if (plans.length === 0) warnings.push({ kind: "no_plan", message: "No active membership." });
  for (const p of plans) {
    const left = Math.round((ictDateTime(p.end_on, "00:00").getTime() - ictDateTime(today, "00:00").getTime()) / DAY_MS);
    if (p.status === "frozen") warnings.push({ kind: "frozen", message: `${p.name} is frozen.` });
    else if (left <= 7) {
      warnings.push({ kind: "expiring", message: `${p.name} ends in ${left} day${left === 1 ? "" : "s"}.` });
    }
    if (p.session_left !== null && p.session_left <= 0) {
      warnings.push({ kind: "no_sessions", message: `${p.name} has no sessions left.` });
    }
  }
  const bookings = await sql.query(
    `select b.id, b.code, b.start_at, b.end_at, c.court_code, b.status::text as status
       from court_bookings b join courts c on c.id = b.court_id
      where b.user_id = $1 and b.status in ('confirmed','in_use') and b.start_at >= $2 and b.start_at < $3
      order by b.start_at`,
    [member.id, dayStart, dayEnd],
  );
  const sessions = await sql.query(
    `select s.id, s.start_at, s.end_at, cl.sport::text as sport, cl.level, c.court_code
       from sessions s
       join classes cl on cl.id = s.class_id
       join courts c on c.id = s.court_id
       join enrollments e on e.class_id = cl.id and e.user_id = $1 and e.status = 'confirmed'
      where s.status = 'scheduled' and s.start_at >= $2 and s.start_at < $3
      order by s.start_at`,
    [member.id, dayStart, dayEnd],
  );
  if (!recent) await audit(sql, user.id, "gate_checkin", "user", member.id);
  return {
    status: 200,
    body: {
      member: { id: member.id, full_name: member.full_name, member_code: member.member_code },
      checked_in_at: checkedInAt,
      duplicate: !!recent,
      plans,
      warnings,
      today: { bookings, sessions },
    },
  };
}

export async function gateCheckins(sql: Sql, user: PublicUser) {
  requireRole(user, ["receptionist", "manager"]);
  await requireFlag(sql, "F4");
  const today = ictDateString();
  const items = await sql.query(
    `select a.id, a.at, u.id as user_id, u.full_name, u.member_code
       from attendance a join users u on u.id = a.user_id
      where a.kind = 'gate' and a.at >= $1 and a.at < $2
      order by a.at desc limit 100`,
    [ictDateTime(today, "00:00").toISOString(), ictDateTime(addDays(today, 1), "00:00").toISOString()],
  );
  return { status: 200, body: { items } };
}
