import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isValidVnPhone, normalizePhone, passwordOk, phoneLast9 } from "./phone.ts";
import { rruleLabel } from "./labels.ts";
import { numberToVietnamese, vndInWords } from "./money-words.ts";
import { addDays, elapsedAtLeast, ictDateTime, ictHour, ictMinutes, pad2, roundVnd } from "./time.ts";
import { discountPctOk, planActiveOn, slotPriceOk, ticketBody, validatePriceRules } from "./rules.ts";

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
