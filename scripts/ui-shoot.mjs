// Screenshot tour for UI reviews: node scripts/ui-shoot.mjs <label> [base]
// Logs in as each demo role through the API, visits the screens below on a
// laptop and a phone viewport, and writes PNGs to docs/ui-review/<label>/.
// Also prints how tall each page is, so "endless list" problems show up as numbers.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const label = process.argv[2] ?? "before";
const base = process.argv[3] ?? "http://127.0.0.1:8080";
const out = `docs/ui-review/${label}`;
mkdirSync(out, { recursive: true });

const ROLES = {
  manager: { phone: "0900000001", routes: ["/manager", "/manager/members", "/manager/classes", "/manager/staff", "/manager/audit", "/manager/attendance", "/manager/plans", "/manager/promos", "/manager/prices", "/manager/settings"] },
  member: { phone: "0901230107", routes: ["/app", "/app/book", "/app/plans", "/app/train", "/app/pass", "/app/classes", "/app/assistant", "/app/notifications", "/account"] },
  receptionist: { phone: "0900000002", routes: ["/desk", "/desk/gate", "/desk/payments", "/desk/at-risk", "/desk/classes"] },
  coach: { phone: "0901110011", routes: ["/coach", "/coach/attendance"] },
};
const VIEWPORTS = { desktop: { width: 1366, height: 820 }, mobile: { width: 390, height: 844 } };

async function login(phone) {
  const r = await fetch(`${base}/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phone, password: "ChangeMe!a3" }),
  });
  if (!r.ok) throw new Error(`login ${phone}: ${r.status}`);
  return r.json();
}

const browser = await chromium.launch({ channel: "chrome" });
const heights = {};
for (const [role, cfg] of Object.entries(ROLES)) {
  const session = await login(cfg.phone);
  for (const [vp, size] of Object.entries(VIEWPORTS)) {
    const ctx = await browser.newContext({ viewport: size, deviceScaleFactor: 1 });
    await ctx.addInitScript(([t, u]) => {
      localStorage.setItem("arena3.token", t);
      localStorage.setItem("arena3.user", JSON.stringify(u));
    }, [session.token, session.user]);
    const page = await ctx.newPage();
    for (const route of cfg.routes) {
      await page.goto(base + route, { waitUntil: "networkidle" }).catch(() => undefined);
      await page.waitForTimeout(900);
      const h = await page.evaluate(() => document.documentElement.scrollHeight);
      const name = `${role}${route.replace(/\//g, "-")}-${vp}`.replace(/-+/g, "-");
      heights[name] = h;
      await page.screenshot({ path: `${out}/${name}.png` });
    }
    await ctx.close();
  }
}
await browser.close();
writeFileSync(`${out}/heights.json`, JSON.stringify(heights, null, 2));
console.table(heights);
