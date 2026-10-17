/**
 * repro-F24.mjs — Tái hiện F-24: POST /classes với court_id không tồn tại gây HTTP 500
 */
import { api, ictDate, login, PHONES } from "../agent-lib.mjs";

console.log("=== REPRO F-24: POST /classes with nonexistent court_id ===");

const mgr = await login(PHONES.manager);
const coach = await login(PHONES.coach);

const res = await api("/classes", {
  method: "POST",
  token: mgr.token,
  body: {
    sport: "badminton",
    level: "repro-f24",
    capacity: 10,
    coach_id: coach.user.id,
    court_id: "99999999-9999-4999-8999-999999999999", // Nonexistent court
    rrule: "FREQ=WEEKLY;BYDAY=MO;BYHOUR=9",
    start_on: ictDate(2),
    end_on: ictDate(14),
    duration_min: 60,
  },
});

console.log(`Status: ${res.status}`);
console.log(`Body: ${JSON.stringify(res.data)}`);
console.log(JSON.stringify({ reproduced: res.status === 500, status: res.status }));
