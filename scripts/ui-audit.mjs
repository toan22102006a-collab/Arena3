// Objective audit: axe-core (WCAG 2.x AA), horizontal overflow, small touch targets, console errors.
// node scripts/ui-audit.mjs <path-to-axe.min.js> [base]
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";

const axeSrc = readFileSync(process.argv[2], "utf8");
const base = process.argv[3] ?? "http://127.0.0.1:8080";
const ROLES = {
  manager: { phone: "0900000001", routes: ["/manager", "/manager/members", "/manager/classes", "/manager/staff", "/manager/audit", "/manager/attendance", "/manager/plans", "/manager/promos", "/manager/prices", "/manager/settings"] },
  receptionist: { phone: "0900000002", routes: ["/desk", "/desk/gate", "/desk/payments", "/desk/at-risk", "/desk/classes", "/desk/gear"] },
  coach: { phone: "0901110011", routes: ["/coach", "/coach/attendance"] },
  member: { phone: "0901230107", routes: ["/app", "/app/book", "/app/plans", "/app/train", "/app/pass", "/app/classes", "/app/assistant", "/app/notifications", "/account"] },
};
const VP = { desktop: { width: 1366, height: 820 }, mobile: { width: 390, height: 844 } };
const login = async (phone) => (await fetch(`${base}/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone, password: "ChangeMe!a3" }) })).json();

const browser = await chromium.launch({ channel: "chrome" });
const rows = [];
for (const [role, cfg] of Object.entries(ROLES)) {
  const s = await login(cfg.phone);
  for (const [vp, size] of Object.entries(VP)) {
    const ctx = await browser.newContext({ viewport: size });
    await ctx.addInitScript(([t, u, l]) => { localStorage.setItem("arena3.lang", l); localStorage.setItem("arena3.token", t); localStorage.setItem("arena3.user", JSON.stringify(u)); }, [s.token, s.user, process.env.LANG_UI ?? "en"]);
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e).slice(0, 120)));
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 120)); });
    for (const route of cfg.routes) {
      errors.length = 0;
      await page.goto(base + route, { waitUntil: "networkidle" }).catch(() => undefined);
      await page.waitForTimeout(1200);
      await page.addScriptTag({ content: axeSrc });
      const r = await page.evaluate(async () => {
        const res = await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"] } });
        const overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
        const small = [...document.querySelectorAll("a,button,[role=button],input,select,textarea")]
          .filter((el) => { const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0 && (b.width < 24 || b.height < 24); }).length;
        const noName = [...document.querySelectorAll("button,a")].filter((el) => !(el.textContent || "").trim() && !el.getAttribute("aria-label") && !el.getAttribute("title")).length;
        return { violations: res.violations.map((v) => ({ id: v.id, impact: v.impact, n: v.nodes.length, help: v.help })), overflow, small, noName };
      });
      rows.push({ role, route, vp, ...r, errors: [...errors] });
    }
    await ctx.close();
  }
}
await browser.close();
writeFileSync("docs/ui-review/audit-v3.json", JSON.stringify(rows, null, 2));
const agg = {};
for (const r of rows) for (const v of r.violations) { agg[v.id] ??= { impact: v.impact, help: v.help, nodes: 0, pages: 0 }; agg[v.id].nodes += v.n; agg[v.id].pages++; }
console.log("pages audited:", rows.length);
console.table(Object.entries(agg).map(([id, a]) => ({ id, impact: a.impact, pages: a.pages, nodes: a.nodes })));
console.log("horizontal overflow pages:", rows.filter((r) => r.overflow > 0).map((r) => `${r.role}${r.route}@${r.vp}(+${r.overflow})`));
console.log("console-error pages:", rows.filter((r) => r.errors.length).map((r) => `${r.role}${r.route}@${r.vp}: ${r.errors[0]}`));
console.log("avg small targets (<24px):", (rows.reduce((a, r) => a + r.small, 0) / rows.length).toFixed(1), "| unnamed buttons/links total:", rows.reduce((a, r) => a + r.noName, 0));
