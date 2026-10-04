// Extra interaction shots for the UI review: the "More" menu open, on a laptop and on a phone.
// node scripts/ui-extra.mjs <label> [base]
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const label = process.argv[2] ?? "after";
const base = process.argv[3] ?? "http://127.0.0.1:8080";
const out = `docs/ui-review/${label}`;
mkdirSync(out, { recursive: true });

const r = await fetch(`${base}/v1/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ phone: "0900000001", password: "ChangeMe!a3" }),
});
const session = await r.json();
const browser = await chromium.launch({ channel: "chrome" });

for (const [vp, size] of [["desktop", { width: 1366, height: 560 }], ["mobile", { width: 390, height: 844 }]]) {
  const ctx = await browser.newContext({ viewport: size });
  await ctx.addInitScript(([t, u]) => {
    localStorage.setItem("arena3.token", t);
    localStorage.setItem("arena3.user", JSON.stringify(u));
  }, [session.token, session.user]);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(`${base}/manager/members`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: /^more/i }).first().click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/manager-more-menu-${vp}.png` });
  console.log(vp, "console errors:", errors.length ? errors : "none");
  await ctx.close();
}
await browser.close();
