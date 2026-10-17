// Before/after shots for the "What changed" part of the screen dictionary.
//   BEFORE=http://127.0.0.1:8082 AFTER=http://127.0.0.1:8080 node scripts/screen-dictionary-changes.mjs
// BEFORE is the previous version (main) and AFTER this branch, both seeded with the demo data and both
// run with PGLITE_DATA_DIR=memory: a few shots need a hold, and the venue shot changes the opening
// hours for a moment (they are put back at the end). Images go to docs/screen-dictionary/img/changes,
// named C-<id>-b.jpg (before) and C-<id>-a.jpg (after); ONLY=paging,venue reshoots just those.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BEFORE = process.env.BEFORE ?? "http://127.0.0.1:8082";
const AFTER = process.env.AFTER ?? "http://127.0.0.1:8080";
const OUT = "docs/screen-dictionary/img/changes";
mkdirSync(OUT, { recursive: true });
const only = process.env.ONLY ? process.env.ONLY.split(",") : null;
const want = (id) => !only || only.includes(id);

const PHONES = { expired: "0901230110", live: "0901230113", desk: "0900000002", manager: "0900000001" };
const DESK = { width: 1280, height: 900 };
const PHONE = { width: 390, height: 844 };

const login = async (base, phone) =>
  (await fetch(`${base}/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ login: phone, phone, password: "ChangeMe!a3" }) })).json();

const browser = await chromium.launch({ channel: "chrome" });

async function open(base, who, route, size = DESK) {
  const s = who ? await login(base, PHONES[who]) : null;
  const mobile = size.width < 500;
  const ctx = await browser.newContext({ viewport: size, deviceScaleFactor: 2, colorScheme: "light", reducedMotion: "reduce", isMobile: mobile, hasTouch: mobile });
  await ctx.addInitScript(([t, u]) => {
    localStorage.setItem("arena3.lang", "vi");
    if (t) {
      localStorage.setItem("arena3.token", t);
      localStorage.setItem("arena3.user", JSON.stringify(u));
    }
  }, [s?.token ?? null, s?.user ?? null]);
  const page = await ctx.newPage();
  await page.goto(base + route, { waitUntil: "networkidle" }).catch(() => undefined);
  // Toasts sit over whatever is being shown; they say nothing the shot does not.
  await page.addStyleTag({ content: "[data-sonner-toaster]{display:none!important}" }).catch(() => undefined);
  await page.waitForTimeout(1800);
  return { page, ctx };
}

const view = (page, file) => page.screenshot({ path: `${OUT}/${file}.jpg`, type: "jpeg", quality: 86 });

// Crop round the box `find` returns (viewport coordinates, after it scrolled the thing into view).
async function crop(page, file, find, arg, pad = 14) {
  const r = await page.evaluate(find, arg);
  if (!r) {
    console.log("  miss", file);
    return false;
  }
  await page.waitForTimeout(400);
  const r2 = (await page.evaluate(find, arg)) ?? r;
  const vp = page.viewportSize();
  const x = Math.max(0, r2.x - pad);
  const y = Math.max(0, r2.y - pad);
  const clip = { x, y, width: Math.min(vp.width, r2.x + r2.w + pad) - x, height: Math.min(vp.height, r2.y + r2.h + pad) - y };
  await page.screenshot({ path: `${OUT}/${file}.jpg`, type: "jpeg", quality: 88, clip });
  console.log("  shot", file);
  return true;
}

// In-page finders. Each scrolls its target into view and returns {x, y, w, h}.
const byCss = ([sel, last]) => {
  const all = [...document.querySelectorAll(sel)].filter((e) => e.getBoundingClientRect().height > 4);
  const el = last ? all[all.length - 1] : all[0];
  if (!el) return null;
  el.scrollIntoView({ block: "center" });
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
};
// The card round a control: walk up from the first visible element whose text matches `re` until the
// box is at least `minW` wide and its text also matches `must` (the card's own heading or timer).
const cardAround = ([re, minW, must, sel = "button, a, h2, h3, p, span"]) => {
  const rx = new RegExp(re);
  const mx = must ? new RegExp(must) : null;
  const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 4 && r.height > 4 && getComputedStyle(e).visibility !== "hidden"; };
  const el = [...document.querySelectorAll(sel)].find((e) => vis(e) && rx.test((e.textContent ?? "").replace(/\s+/g, " ").trim()));
  if (!el) return null;
  let box = el;
  while (box.parentElement && (box.getBoundingClientRect().width < minW || (mx && !mx.test(box.textContent ?? "")))) box = box.parentElement;
  box.scrollIntoView({ block: "center" });
  const r = box.getBoundingClientRect();
  return { x: r.left, y: Math.max(0, r.top), w: r.width, h: Math.min(r.height, innerHeight - Math.max(0, r.top)) };
};
// A dialog's visible panel (some dialogs are a full-screen overlay holding the panel).
const dialogPanel = () => {
  const d = [...document.querySelectorAll('[role="dialog"]')].pop();
  if (!d) return null;
  let el = d;
  if (d.getBoundingClientRect().width >= innerWidth - 2) {
    el = [...d.querySelectorAll("*")].find((c) => { const r = c.getBoundingClientRect(); return r.width < innerWidth * 0.95 && r.width > 280 && r.height > 200; }) ?? d;
  }
  const r = el.getBoundingClientRect();
  return { x: r.left, y: Math.max(0, r.top), w: r.width, h: Math.min(r.height, innerHeight) };
};
// The day strip: the row holding the "Today" button.
const dayStrip = () => {
  const b = [...document.querySelectorAll("button")].find((e) => /^Hôm nay\s*\d/.test((e.textContent ?? "").trim()) && e.getBoundingClientRect().height > 4);
  if (!b) return null;
  let row = b.parentElement;
  while (row && row.children.length < 5) row = row.parentElement;
  row.scrollIntoView({ block: "center" });
  const r = row.getBoundingClientRect();
  return { x: r.left, y: r.top, w: Math.min(r.width, innerWidth - r.left), h: r.height };
};
// The page heading and the line under it.
const pageHead = () => {
  const h = document.querySelector("main h1") ?? document.querySelector("h1");
  if (!h) return null;
  window.scrollTo(0, 0);
  const r = h.getBoundingClientRect();
  const p = h.nextElementSibling ?? h.parentElement?.nextElementSibling;
  const pr = p?.getBoundingClientRect() ?? r;
  return { x: r.left, y: r.top, w: Math.max(r.width, pr.width, 760), h: pr.bottom - r.top };
};
// The court grid's first hours: from the header row down `px` pixels.
const gridTop = ([px, maxW]) => {
  const g = document.querySelector('[role="region"][aria-label*="Lịch sân"], [role="grid"], table') ?? document.querySelector('[aria-label^="Đặt CL-"]')?.closest("div");
  if (!g) return null;
  g.scrollIntoView({ block: "start" });
  window.scrollBy(0, -90);
  const r = g.getBoundingClientRect();
  return { x: r.left, y: r.top, w: Math.min(maxW ?? r.width, r.width), h: Math.min(px, r.height) };
};

// Hold the first free court on the latest day that has one (the demo members are at the daily cap on some days).
async function holdOne(page) {
  const days = page.locator("button").filter({ hasText: /^(Hôm nay|T[2-7]|CN)\s*\d{1,2}/ });
  const n = await days.count();
  for (let d = n - 1; d >= 0; d--) {
    await days.nth(d).click().catch(() => undefined);
    await page.waitForTimeout(1200);
    const cell = page.locator('button[aria-label^="Đặt CL-"]:not([disabled])').filter({ visible: true }).first();
    if (!(await cell.count())) continue;
    await cell.click().catch(() => undefined);
    await page.waitForTimeout(2200);
    if ((await page.getByRole("button", { name: /Chuyển khoản/ }).filter({ visible: true }).count()) > 0) return true;
  }
  return false;
}

const SIDES = [["b", BEFORE], ["a", AFTER]];
try {
  for (const [side, base] of SIDES) {
    console.log(side === "b" ? `before: ${base}` : `after: ${base}`);

    if (want("register")) {
      const { page, ctx } = await open(base, null, "/register");
      await crop(page, `C-register-${side}`, byCss, ["form", false], 18);
      await ctx.close();
      if (side === "a") {
        const t = await open(base, null, "/terms", PHONE);
        await view(t.page, "C-terms-a");
        await t.ctx.close();
      }
    }
    if (want("paging")) {
      const { page, ctx } = await open(base, "desk", "/desk/payments");
      // The receipts list ends in either "Trước / Sau" (before) or the page bar (after).
      const found =
        side === "a"
          ? await crop(page, `C-paging-${side}`, ([sel]) => {
              const nav = [...document.querySelectorAll(sel)].filter((e) => /\d/.test(e.textContent ?? "")).pop();
              if (!nav) return null;
              nav.scrollIntoView({ block: "end" });
              window.scrollBy(0, 40);
              const r = nav.getBoundingClientRect();
              return { x: r.left, y: r.top - 150, w: r.width, h: r.height + 150 };
            }, ['nav[aria-label]'])
          : await crop(page, `C-paging-${side}`, () => {
              const next = [...document.querySelectorAll("button")].filter((e) => (e.textContent ?? "").trim() === "Sau").pop();
              if (!next) return null;
              next.scrollIntoView({ block: "end" });
              window.scrollBy(0, 40);
              const r = next.getBoundingClientRect();
              const card = next.closest("section") ?? next.parentElement?.parentElement;
              const c = card.getBoundingClientRect();
              return { x: c.left, y: r.top - 150, w: c.width, h: r.height + 150 };
            });
      if (!found) await view(page, `C-paging-${side}`);
      await ctx.close();
    }
    if (want("hold")) {
      const { page, ctx } = await open(base, "expired", "/app/book");
      if (await holdOne(page)) {
        // The hold card: what the member can pay with (B-4).
        await crop(page, `C-plan-${side}`, cardAround, ["^Chuyển khoản$", 300, "\\d:\\d\\d"], 12);
        await page.getByRole("button", { name: /Chuyển khoản/ }).filter({ visible: true }).first().click();
        await page.waitForTimeout(2500);
        // Before, "Bank transfer" only left a notice (no account, no QR); after, it opens the QR dialog.
        const shot =
          side === "b"
            ? await crop(page, `C-transfer-${side}`, cardAround, ["^Chuyển khoản [\\d.]+đ", 600, "Đã hiểu"], 10)
            : await crop(page, `C-transfer-${side}`, dialogPanel, null, 10);
        if (!shot) await view(page, `C-transfer-${side}`);
      } else console.log("  no hold possible on", side);
      await ctx.close();
    }
    if (want("daycap")) {
      const { page, ctx } = await open(base, "live", "/app/book");
      await crop(page, `C-daycap-${side}`, dayStrip, null, 12);
      await ctx.close();
    }
    if (want("classes")) {
      const { page, ctx } = await open(base, "expired", "/app/classes");
      await crop(page, `C-classes-${side}`, cardAround, ["^(Đăng ký|Xem gói tập|Gia hạn)$", 300, "(Cơ bản|Trung bình|Nâng cao)", "button, a"], 12);
      await ctx.close();
    }
    if (want("app")) {
      const p = await open(base, "live", "/app/book", PHONE);
      await view(p.page, `C-bookm-${side}`);
      await p.ctx.close();
      const d = await open(base, "desk", "/desk");
      await view(d.page, `C-desk-${side}`);
      await d.ctx.close();
    }
  }

  // Opening hours and the hold length set to 07:00-21:00 and 7 minutes on both, shot, then put back.
  if (want("venue")) {
    const saved = {};
    for (const [side, base] of SIDES) {
      const m = await login(base, PHONES.manager);
      const h = { authorization: `Bearer ${m.token}`, "content-type": "application/json" };
      const cur = await (await fetch(`${base}/v1/settings`, { headers: h })).json();
      saved[side] = { open_time: cur.open_time.slice(0, 5), close_time: cur.close_time.slice(0, 5), hold_minutes: cur.hold_minutes };
      const r = await fetch(`${base}/v1/settings`, { method: "PATCH", headers: h, body: JSON.stringify({ open_time: "07:00", close_time: "21:00", hold_minutes: 7 }) });
      console.log("venue set", side, r.status);
    }
    try {
      for (const [side, base] of SIDES) {
        const b = await open(base, "live", "/app/book");
        await crop(b.page, `C-venue-${side}`, pageHead, null, 16);
        await b.ctx.close();
        const c = await open(base, "desk", "/desk/courts");
        await crop(c.page, `C-venuegrid-${side}`, gridTop, [330, 430], 8);
        await c.ctx.close();
      }
    } finally {
      for (const [side, base] of SIDES) {
        const m = await login(base, PHONES.manager);
        const h = { authorization: `Bearer ${m.token}`, "content-type": "application/json" };
        const r = await fetch(`${base}/v1/settings`, { method: "PATCH", headers: h, body: JSON.stringify(saved[side]) });
        console.log("venue restored", side, r.status, JSON.stringify(saved[side]));
      }
    }
  }
} finally {
  await browser.close();
}
