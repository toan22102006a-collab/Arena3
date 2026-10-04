// Full-page shots of the long screens after the fix: node scripts/ui-extra2.mjs after
import { chromium } from "playwright";
const label = process.argv[2] ?? "after";
const base = "http://127.0.0.1:8080";
const out = `docs/ui-review/${label}`;
const r = await fetch(`${base}/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone: "0900000002", password: "ChangeMe!a3" }) });
const session = await r.json();
const browser = await chromium.launch({ channel: "chrome" });
const ctx = await browser.newContext({ viewport: { width: 1366, height: 820 } });
await ctx.addInitScript(([t, u]) => { localStorage.setItem("arena3.token", t); localStorage.setItem("arena3.user", JSON.stringify(u)); }, [session.token, session.user]);
const page = await ctx.newPage();
for (const [route, name] of [["/desk/at-risk", "at-risk-full"], ["/desk/payments", "payments-full"]]) {
  await page.goto(base + route, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: true });
}
await browser.close();
