// In Vietnamese mode, list visible text that still looks English, per page.
//   node scripts/i18n-leaks.mjs [base]
import { chromium } from "playwright";
const base = process.argv[2] ?? "http://127.0.0.1:8080";
const ROLES = {
  public: { phone: null, routes: ["/", "/login", "/register", "/forgot"] },
  manager: { phone: "0900000001", routes: ["/manager", "/manager/members", "/manager/classes", "/manager/staff", "/manager/audit", "/manager/attendance", "/manager/plans", "/manager/promos", "/manager/prices", "/manager/settings"] },
  receptionist: { phone: "0900000002", routes: ["/desk", "/desk/gate", "/desk/courts", "/desk/payments", "/desk/at-risk", "/desk/classes", "/desk/gear"] },
  coach: { phone: "0901110011", routes: ["/coach", "/coach/attendance"] },
  member: { phone: "0901230107", routes: ["/app", "/app/book", "/app/plans", "/app/train", "/app/pass", "/app/classes", "/app/assistant", "/app/notifications", "/account"] },
};
const EN = /\b(the|and|to|your|for|with|of|is|are|no|new|all|you|this|that|from|not|will|can|when|open|click|select|choose|please|an|on|in|at|by|or|be|it|has|have|was|any|per|each|next|back|save|cancel|add|edit|delete|today|week|month|day|days|free|paid|unpaid|member|members|court|courts|class|classes|plan|plans|payment|receipt|booking|bookings|manager|staff|coach|none|more|show|hide|search|find|filter|total|name|phone|email|status|date|time|price|amount|loading|error|failed|saved|sign|log|out|find|first|last|ago|min|hours|hour)\b/i;
const VN = /[ăâêôơưđáàảãạấầẩẫậắằẳẵặéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵ]/i;
const login = async (phone) => (await fetch(`${base}/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone, password: "ChangeMe!a3" }) })).json();
const browser = await chromium.launch({ channel: "chrome" });
const seen = new Map();
for (const [role, cfg] of Object.entries(ROLES)) {
  const s = cfg.phone ? await login(cfg.phone) : null;
  for (const size of [{ width: 1366, height: 820 }, { width: 390, height: 844 }]) {
    const ctx = await browser.newContext({ viewport: size });
    await ctx.addInitScript(([t, u]) => { localStorage.setItem("arena3.lang", "vi"); if (t) { localStorage.setItem("arena3.token", t); localStorage.setItem("arena3.user", JSON.stringify(u)); } }, [s?.token ?? null, s?.user ?? null]);
    const page = await ctx.newPage();
    for (const route of cfg.routes) {
      await page.goto(base + route, { waitUntil: "networkidle" }).catch(() => undefined);
      await page.waitForTimeout(1200);
      const texts = await page.evaluate(() => {
        const out = [];
        const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        while (w.nextNode()) {
          const n = w.currentNode; const el = n.parentElement;
          if (!el || ["SCRIPT", "STYLE", "NOSCRIPT"].includes(el.tagName)) continue;
          const r = el.getBoundingClientRect();
          if (!r.width || !r.height) continue;
          const tx = n.nodeValue.replace(/\s+/g, " ").trim();
          if (tx.length > 2) out.push(tx);
        }
        for (const el of document.querySelectorAll("[aria-label],[placeholder],[title],img[alt]")) {
          for (const a of ["aria-label", "placeholder", "title", "alt"]) { const v = el.getAttribute(a); if (v && v.length > 2) out.push(`@${a}: ${v}`); }
        }
        return out;
      });
      for (const tx of texts) if (!VN.test(tx) && EN.test(tx)) { const k = tx; if (!seen.has(k)) seen.set(k, `${role}${route}`); }
    }
    await ctx.close();
  }
}
await browser.close();
console.log(`${seen.size} possibly-English strings in VI mode`);
for (const [k, where] of seen) console.log(`  [${where}] ${k}`);
