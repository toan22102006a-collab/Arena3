import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isValidVnPhone, normalizePhone, passwordOk, phoneLast9 } from "./phone.ts";
import { rruleLabel } from "./labels.ts";
import { numberToVietnamese, vndInWords } from "./money-words.ts";
import { addDays, elapsedAtLeast, ictDateTime, ictHour, ictMinutes, pad2, roundVnd, slotSpan } from "./time.ts";
import { ApiError, mapDbError } from "./errors.ts";
import { checkOpeningHours, parseSettingsPatch } from "./validate.ts";
import {
  absentStreak,
  attendanceLocked,
  discountPctOk,
  homeworkComplete,
  isAttResult,
  normalizeChecklist,
  normalizeDone,
  planActiveOn,
  slotPriceOk,
  ticketBody,
  validateMetrics,
  validatePriceRules,
  computeDiscount,
  normalizeCode,
} from "./rules.ts";
import { signCheckinToken, verifyCheckinToken } from "./checkin.ts";

describe("phone", () => {
  it("normalizes VN mobiles to +84", () => {
    assert.equal(normalizePhone("0900000001"), "+84900000001");
    assert.equal(normalizePhone("+84900000001"), "+84900000001");
    assert.equal(normalizePhone("900000001"), "+84900000001");
    assert.equal(normalizePhone("090 000 0001"), "+84900000001");
    assert.equal(phoneLast9("0908825218"), "908825218");
    assert.ok(isValidVnPhone("0900000001"));
    assert.ok(isValidVnPhone("+84900000001"));
    assert.equal(isValidVnPhone("+84120000001"), false);
  });
  it("rejects short passwords", () => {
    assert.equal(passwordOk("abc"), false);
    assert.equal(passwordOk("ChangeMe!a3"), true);
  });
});

describe("time / price slot", () => {
  it("reads ICT wall clock from a +07 instant", () => {
    const start = ictDateTime("2026-09-14", "17:30");
    assert.equal(ictHour(start), 17);
    assert.equal(ictMinutes(start), 17 * 60 + 30);
    assert.equal(pad2(ictHour(start)), "17");
  });
  it("does not use the host timezone for invoice hours", () => {
    const start = new Date("2026-09-14T10:00:00+07:00");
    assert.equal(pad2(ictHour(start)), "10");
    assert.notEqual(pad2(start.getUTCHours()), "10");
  });
  it("addDays stays on the calendar date", () => {
    assert.equal(addDays("2026-09-30", 1), "2026-10-01");
  });
});

describe("pricing", () => {
  it("rounds member discount to 1000đ", () => {
    assert.equal(roundVnd(140000 * (1 - 20 / 100)), 112000);
    assert.equal(roundVnd(80000 * (1 - 15 / 100)), 68000);
  });
});

describe("rrule", () => {
  it("labels weekly BYDAY in English", () => {
    assert.equal(rruleLabel("FREQ=WEEKLY;BYDAY=MO,WE,FR;BYHOUR=18"), "Mon, Wed, Fri · 18:00");
  });
  it("builds Monday 18:00 ICT from the date+hour helper", () => {
    const start = ictDateTime("2026-09-14", "18:00");
    assert.equal(ictHour(start), 18);
    assert.equal(start.toISOString(), new Date("2026-09-14T18:00:00+07:00").toISOString());
  });
});

describe("jobs", () => {
  it("materializes class sessions at most once per window", () => {
    assert.equal(elapsedAtLeast(undefined, 1000, 600), true);
    assert.equal(elapsedAtLeast(1000, 1599, 600), false);
    assert.equal(elapsedAtLeast(1000, 1600, 600), true);
  });
});

// Pins the 2026-09-27 live-check fixes (patch order A/D/G) so the exact
// vandalized values that showed up in production can never quietly pass again.
describe("BR-34B / price bounds", () => {
  it("rejects the vandalized weekday badminton price (99,999,999đ)", () => {
    assert.equal(slotPriceOk(99_999_999), false);
  });
  it("rejects the vandalized holiday price (100,000,004đ) and the zeroed weekend price", () => {
    assert.equal(slotPriceOk(100_000_004), false);
    assert.equal(slotPriceOk(0), false);
  });
  it("accepts every real rule, including basketball peak at the top of the range", () => {
    for (const p of [80000, 140000, 300000, 500000, 250000, 400000]) assert.equal(slotPriceOk(p), true);
  });
  it("validatePriceRules refuses a PUT payload carrying the vandalized price", () => {
    const bad = validatePriceRules([
      { sport: "badminton", day_kind: "weekday", start_local: "06:00", end_local: "17:00", price_vnd: 99_999_999 },
    ]);
    assert.equal(bad.ok, false);
  });
  it("validatePriceRules accepts a clean weekday badminton quote (not 8e7)", () => {
    const ok = validatePriceRules([
      { sport: "badminton", day_kind: "weekday", start_local: "06:00", end_local: "17:00", price_vnd: 80000 },
    ]);
    assert.equal(ok.ok, true);
  });
});

describe("BR-34A / discount percentage", () => {
  it("accepts whole percentages in [0, 100]", () => {
    assert.equal(discountPctOk(0), true);
    assert.equal(discountPctOk(20), true);
    assert.equal(discountPctOk(100), true);
  });
  it("rejects out-of-range or fractional percentages", () => {
    assert.equal(discountPctOk(-1), false);
    assert.equal(discountPctOk(101), false);
    assert.equal(discountPctOk(12.5), false);
  });
});

describe("BR-19A / plan window", () => {
  it("is active only between start_on and end_on inclusive", () => {
    assert.equal(planActiveOn("2026-09-01", "2026-10-01", "2026-09-15"), true);
    assert.equal(planActiveOn("2026-09-01", "2026-10-01", "2026-09-01"), true);
    assert.equal(planActiveOn("2026-09-01", "2026-10-01", "2026-10-01"), true);
    assert.equal(planActiveOn("2026-10-01", "2026-11-01", "2026-09-15"), false);
    assert.equal(planActiveOn("2026-08-01", "2026-09-01", "2026-09-15"), false);
  });
});

describe("ticketBody / FR-S03", () => {
  it('stores "ticket:ticket: hello" as "hello"', () => {
    assert.equal(ticketBody("ticket:ticket: hello"), "hello");
    assert.equal(ticketBody("Ticket: Ticket:  hello"), "hello");
  });
  it('leaves a "ticket:" in the middle of a sentence alone', () => {
    assert.equal(ticketBody("ticket: my ticket: for the class didn't work"), "my ticket: for the class didn't work");
  });
  it('strips a zero-width character sitting inside the marker', () => {
    assert.equal(ticketBody("ticket:​ hello"), "hello");
  });
  it('an empty "ticket:" reduces to the empty string (caller returns 422)', () => {
    assert.equal(ticketBody("ticket:"), "");
    assert.equal(ticketBody("ticket: "), "");
  });
});

describe("money in words", () => {
  it("spells the digits a VN invoice trips over", () => {
    assert.equal(numberToVietnamese(0), "không");
    assert.equal(numberToVietnamese(5), "năm");
    assert.equal(numberToVietnamese(10), "mười");
    assert.equal(numberToVietnamese(15), "mười lăm");
    assert.equal(numberToVietnamese(21), "hai mươi mốt");
    assert.equal(numberToVietnamese(25), "hai mươi lăm");
    assert.equal(numberToVietnamese(105), "một trăm linh năm");
    assert.equal(numberToVietnamese(1000), "một nghìn");
  });
  it("keeps a zero hundreds column audible inside a group", () => {
    // Drop the "không trăm" and this reads back as 1.050, not 1.005.
    assert.equal(numberToVietnamese(1005), "một nghìn không trăm linh năm");
    assert.equal(numberToVietnamese(1050), "một nghìn không trăm năm mươi");
  });
  it("skips empty groups without losing their scale", () => {
    assert.equal(numberToVietnamese(1_000_000), "một triệu");
    assert.equal(numberToVietnamese(900_000), "chín trăm nghìn");
    assert.equal(numberToVietnamese(1_200_000), "một triệu hai trăm nghìn");
    assert.equal(numberToVietnamese(2_000_000_000), "hai tỷ");
  });
  it("formats the invoice line", () => {
    assert.equal(vndInWords(900_000), "Chín trăm nghìn đồng./.");
    assert.equal(vndInWords(0), "Không đồng./.");
    assert.equal(vndInWords(-50_000), "Âm năm mươi nghìn đồng./.");
  });
});

describe("settings validation (B-01)", () => {
  const fieldOf = (fn: () => unknown) => {
    try {
      fn();
    } catch (e) {
      assert.ok(e instanceof ApiError);
      assert.equal(e.status, 400);
      return String(e.extra.field);
    }
    assert.fail("expected a 400");
  };
  it("takes numbers typed as strings", () => {
    const p = parseSettingsPatch({ hold_minutes: "15", gate_dedup_minutes: 90, open_time: "6:00", tax_code: " 0312 " });
    assert.deepEqual(p, { hold_minutes: 15, gate_dedup_minutes: 90, open_time: "06:00", tax_code: "0312" });
  });
  it("never turns a blank number into null", () => {
    assert.equal(fieldOf(() => parseSettingsPatch({ hold_minutes: "" })), "hold_minutes");
    assert.equal(fieldOf(() => parseSettingsPatch({ gate_dedup_minutes: null })), "gate_dedup_minutes");
    assert.equal(fieldOf(() => parseSettingsPatch({ book_ahead_days: Number.NaN })), "book_ahead_days");
  });
  it("rejects text, fractions and out-of-range integers", () => {
    assert.equal(fieldOf(() => parseSettingsPatch({ hold_minutes: "abc" })), "hold_minutes");
    assert.equal(fieldOf(() => parseSettingsPatch({ hold_minutes: "1.5" })), "hold_minutes");
    assert.equal(fieldOf(() => parseSettingsPatch({ gate_dedup_minutes: 2_147_483_648 })), "gate_dedup_minutes");
    assert.equal(fieldOf(() => parseSettingsPatch({ gate_dedup_minutes: -1 })), "gate_dedup_minutes");
  });
  it("rejects text longer than its column", () => {
    assert.equal(fieldOf(() => parseSettingsPatch({ tax_code: "1".repeat(21) })), "tax_code");
    assert.equal(fieldOf(() => parseSettingsPatch({ legal_name: "x".repeat(191) })), "legal_name");
    assert.equal(parseSettingsPatch({ tax_code: "1".repeat(20) }).tax_code, "1".repeat(20));
  });
  it("clears optional text on a blank, ignores unknown keys", () => {
    assert.deepEqual(parseSettingsPatch({ address: "  ", nope: 1 }), { address: null });
  });
  it("checks opening hours as a pair", () => {
    checkOpeningHours("06:00", "22:00");
    assert.equal(fieldOf(() => checkOpeningHours("22:00", "06:00:00")), "close_time");
    assert.equal(fieldOf(() => parseSettingsPatch({ open_time: "25:00" })), "open_time");
  });
});

describe("database errors keep their meaning", () => {
  it("maps value errors to a 400 naming the column", () => {
    assert.deepEqual(mapDbError({ code: "22001", column: "tax_code" })?.body, {
      code: "VALIDATION",
      message: "That value is too long.",
      field: "tax_code",
    });
    assert.equal(mapDbError({ code: "22003" })?.status, 400);
    assert.equal(mapDbError({ code: "23502", column: "hold_minutes" })?.status, 400);
  });
  it("keeps rule errors as rule codes", () => {
    assert.equal(mapDbError({ code: "23P01" })?.body.code, "CONFLICT_SLOT");
    assert.equal(mapDbError({ message: "CLASS_FULL" })?.body.br, "BR-22");
    assert.equal(mapDbError({ message: "ALREADY_ENROLLED" })?.body.br, "BR-24");
    assert.equal(mapDbError({ code: "23505", constraint: "u" })?.status, 409);
  });
  it("leaves the unknown to be a 500", () => {
    assert.equal(mapDbError(new Error("boom")), null);
    assert.equal(mapDbError({ code: "XX000" }), null);
  });
});

describe("class court time (B-03)", () => {
  const hhmm = (d: Date) => `${pad2(ictHour(d))}:${pad2(ictMinutes(d) % 60)}`;
  it("rounds a 90-minute class out to whole slots", () => {
    const start = ictDateTime("2026-09-14", "17:00");
    const held = slotSpan(start, new Date(start.getTime() + 90 * 60_000), 60);
    assert.equal(hhmm(held.start), "17:00");
    assert.equal(hhmm(held.end), "19:00");
  });
  it("leaves a class that already fits the grid alone", () => {
    const start = ictDateTime("2026-09-14", "18:00");
    const held = slotSpan(start, new Date(start.getTime() + 120 * 60_000), 60);
    assert.equal(held.start.getTime(), start.getTime());
    assert.equal(held.end.getTime(), start.getTime() + 120 * 60_000);
  });
  it("also rounds a start that is off the grid down", () => {
    const start = ictDateTime("2026-09-14", "17:30");
    const held = slotSpan(start, new Date(start.getTime() + 60 * 60_000), 60);
    assert.equal(hhmm(held.start), "17:00");
    assert.equal(hhmm(held.end), "19:00");
  });
});

describe("F4 attendance lock (BR-53)", () => {
  const end = ictDateTime("2026-09-14", "19:30").getTime();
  it("stays open for two hours after the session ends", () => {
    assert.equal(attendanceLocked(end, end + 119 * 60_000, "scheduled"), false);
    assert.equal(attendanceLocked(end, end + 2 * 3_600_000, "scheduled"), false);
  });
  it("closes once the window has passed, even before the job marks it done", () => {
    assert.equal(attendanceLocked(end, end + 2 * 3_600_000 + 1, "scheduled"), true);
  });
  it("is closed for a session already marked done", () => {
    assert.equal(attendanceLocked(end, end - 60_000, "done"), true);
  });
});

describe("F4 absent streak (BR-58)", () => {
  it("counts only the run at the end", () => {
    assert.equal(absentStreak(["absent", "present", "absent", "absent"]), 2);
    assert.equal(absentStreak(["absent", "absent", "absent"]), 3);
    assert.equal(absentStreak([]), 0);
  });
  it("is broken by present, late or excused", () => {
    assert.equal(absentStreak(["absent", "absent", "excused", "absent"]), 1);
    assert.equal(absentStreak(["absent", "absent", "absent", "late"]), 0);
  });
  it("accepts only the four register values", () => {
    assert.equal(isAttResult("late"), true);
    assert.equal(isAttResult("sick"), false);
    assert.equal(isAttResult(undefined), false);
  });
});

describe("F4 session metrics (FR-TRN-05)", () => {
  it("accepts whole numbers in range and ignores blanks", () => {
    const r = validateMetrics({ smash_count: 24, freethrow_pct: "80", serve_pct: "" });
    assert.deepEqual(r, { ok: true, metrics: { smash_count: 24, freethrow_pct: 80 } });
  });
  it("rejects percentages above 100, fractions and unknown keys", () => {
    assert.equal(validateMetrics({ serve_pct: 101 }).ok, false);
    assert.equal(validateMetrics({ smash_count: 2.5 }).ok, false);
    assert.equal(validateMetrics({ speed: 3 }).ok, false);
    assert.equal(validateMetrics([1]).ok, false);
  });
});

describe("F4 homework checklist (FR-TRN-07)", () => {
  it("trims, drops blanks and refuses a wrong shape", () => {
    assert.deepEqual(normalizeChecklist([" a ", "", "b"]), ["a", "b"]);
    assert.equal(normalizeChecklist("a"), null);
    assert.equal(normalizeChecklist([1]), null);
    assert.equal(normalizeChecklist(Array.from({ length: 21 }, () => "x")), null);
  });
  it("keeps only ticks that point at a real row", () => {
    assert.deepEqual(normalizeDone(3, [2, 2, 0, 5, -1, "1"]), [0, 2]);
  });
  it("is complete when every row is ticked, or on explicit done for an empty list", () => {
    assert.equal(homeworkComplete(3, [0, 1], false), false);
    assert.equal(homeworkComplete(3, [0, 1, 2], false), true);
    assert.equal(homeworkComplete(0, [], false), false);
    assert.equal(homeworkComplete(0, [], true), true);
  });
});

describe("promo discount (BR-46)", () => {
  it("rounds a percentage once to the nearest 1,000đ", () => {
    assert.equal(computeDiscount({ kind: "percent", value: 10, max_discount_vnd: null }, 155_000), 16_000);
    assert.equal(computeDiscount({ kind: "percent", value: 10, max_discount_vnd: null }, 154_000), 15_000);
  });
  it("caps by max_discount_vnd and never leaves under 1,000đ to pay", () => {
    assert.equal(computeDiscount({ kind: "percent", value: 50, max_discount_vnd: 20_000 }, 200_000), 20_000);
    assert.equal(computeDiscount({ kind: "amount", value: 50_000, max_discount_vnd: null }, 30_000), 29_000);
  });
  it("normalises codes", () => {
    assert.equal(normalizeCode(" sum mer10 "), "SUMMER10");
    assert.equal(normalizeCode(null), "");
  });
});

describe("check-in token (BR-71)", () => {
  it("round-trips a member token", () => {
    const { token, ttl_seconds } = signCheckinToken("member", "u1", 1_000_000);
    assert.equal(ttl_seconds, 60);
    const v = verifyCheckinToken(token, 1_000_000 + 30_000);
    assert.equal(v.kind, "member");
    assert.equal(v.sub, "u1");
  });
  it("refuses an expired token", () => {
    const { token } = signCheckinToken("member", "u1", 1_000_000);
    assert.throws(() => verifyCheckinToken(token, 1_000_000 + 61_000), ApiError);
  });
  it("refuses a tampered token", () => {
    const { token } = signCheckinToken("member", "u1", Date.now());
    const [body, mac] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ k: "member", s: "u2", j: "x", e: 9_999_999_999 })).toString("base64url");
    assert.throws(() => verifyCheckinToken(`${forged}.${mac}`), ApiError);
    assert.throws(() => verifyCheckinToken(`${body}.AAAA`), ApiError);
    assert.throws(() => verifyCheckinToken(42), ApiError);
  });
  it("takes a desk code wrapped in a URL", () => {
    const { token } = signCheckinToken("desk", "front-desk", Date.now());
    assert.equal(verifyCheckinToken(`https://x.test/in?d=${token}`).kind, "desk");
  });
});
