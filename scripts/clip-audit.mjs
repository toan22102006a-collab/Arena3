// Finds text that is cut off on a phone screen (ellipsis / hidden overflow) and elements wider than the screen.
//   node scripts/clip-audit.mjs [width]
import { chromium } from "playwright";
const base = process.env.BASE ?? "http://127.0.0.1:8080";
const W = Number(process.argv[2] ?? 390);
const ROLES = {
  public: ["", ["/", "/login", "/register", "/forgot"]],
  member: ["0901230107", ["/app", "/app/book", "/app/plans", "/app/classes", "/app/train", "/app/pass", "/app/assistant", "/app/notifications", "/account"]],
  receptionist: ["0900000002", ["/desk", "/desk/gate", "/desk/courts", "/desk/payments", "/desk/at-risk", "/desk/classes", "/desk/gear"]],
  coach: ["0901110011", ["/coach", "/coach/attendance"]],
  manager: ["0900000001", ["/manager", "/manager/classes", "/manager/members", "/manager/attendance", "/manager/plans", "/manager/promos", "/manager/prices", "/manager/staff", "/manager/audit", "/manager/settings"]],
};
const login = async (phone) => (await fetch(`${base}/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone, password: "ChangeMe!a3" }) })).json();
const browser = await chromium.launch({ channel: "chrome" });
const report = [];
for (const [role, [phone, routes]] of Object.entries(ROLES)) {
  const s = phone ? await login(phone) : null;
  const ctx = await browser.newContext({ viewport: { width: W, height: 844 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(([t, u]) => { localStorage.setItem("arena3.lang", "vi"); if (t) { localStorage.setItem("arena3.token", t); localStorage.setItem("arena3.user", JSON.stringify(u)); } }, [s?.token ?? null, s?.user ?? null]);
  const page = await ctx.newPage();
  for (const r of routes) {
    await page.goto(base + r, { waitUntil: "networkidle" }).catch(() => undefined);
    await page.waitForTimeout(r === "/" ? 3500 : 1400);
    const res = await page.evaluate((W) => {
      const out = [];
      const seen = new Set();
      const label = (el) => (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 50);
      if (document.documentElement.scrollWidth > W + 1) out.push({ kind: "PAGE-SCROLLS-X", w: document.documentElement.scrollWidth, text: "" });
      for (const el of document.querySelectorAll("body *")) {
        if (el.closest("svg")) continue;
        const cs = getComputedStyle(el);
        if (cs.display === "none" || cs.visibility === "hidden") continue;
        const r = el.getBoundingClientRect();
        if (r.width < 4 || r.height < 4) continue;
        const txt = label(el);
        if (!txt) continue;
        const hasOwnText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
        if (!hasOwnText) continue;
        if (el.scrollWidth > el.clientWidth + 2 && (cs.overflowX === "hidden" || cs.textOverflow === "ellipsis" || cs.overflowX === "clip")) {
          const k = "CLIP:" + txt; if (!seen.has(k)) { seen.add(k); out.push({ kind: "CUT-TEXT", text: txt, cls: String(el.className).slice(0, 80) }); }
        } else if (r.right > W + 2 && !el.closest("[class*=overflow-x-auto]")) {
          const k = "OFF:" + txt; if (!seen.has(k)) { seen.add(k); out.push({ kind: "OFF-SCREEN", text: txt, right: Math.round(r.right), cls: String(el.className).slice(0, 80) }); }
        }
      }
      return out;
    }, W);
    for (const x of res) report.push({ role, route: r, ...x });
  }
  await ctx.close();
}
await browser.close();
for (const x of report) console.log(`${x.role} ${x.route} ${x.kind} "${x.text}" ${x.right ?? ""} ${x.cls ?? ""}`);
console.log("total", report.length);
