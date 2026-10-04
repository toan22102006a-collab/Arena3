// "Can you tell what this screen is for without reading a word?"
// Blurs every piece of text into an unreadable smudge (layout, weight, size and colour stay),
// keeps icons, photos and illustrations sharp, and shoots the first screen of every page.
//   node scripts/ui-squint.mjs <label> [base]      -> docs/ui-review/<label>/squint/*.png
//   LANG_UI=vi node scripts/ui-squint.mjs vi       -> same, with the Vietnamese UI (lang=vi)
//   SQUINT=0 ...                                   -> normal, unblurred shots (for comparison)
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const label = process.argv[2] ?? "squint";
const base = process.argv[3] ?? "http://127.0.0.1:8080";
const lang = process.env.LANG_UI ?? "en";
const squint = process.env.SQUINT !== "0";
const out = `docs/ui-review/${label}/${squint ? "squint" : "plain"}`;
mkdirSync(out, { recursive: true });

const ROLES = {
  public: { phone: null, routes: ["/", "/login", "/register"] },
  manager: { phone: "0900000001", routes: ["/manager", "/manager/members", "/manager/classes", "/manager/staff", "/manager/audit", "/manager/attendance", "/manager/plans", "/manager/promos", "/manager/prices", "/manager/settings"] },
  receptionist: { phone: "0900000002", routes: ["/desk", "/desk/gate", "/desk/courts", "/desk/payments", "/desk/at-risk", "/desk/classes", "/desk/gear"] },
  coach: { phone: "0901110011", routes: ["/coach", "/coach/attendance"] },
  member: { phone: "0901230107", routes: ["/app", "/app/book", "/app/plans", "/app/train", "/app/pass", "/app/classes", "/app/assistant", "/app/notifications", "/account"] },
};
const VIEWPORTS = { desktop: { width: 1366, height: 820 }, mobile: { width: 390, height: 844 } };

const login = async (phone) =>
  (await fetch(`${base}/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone, password: "ChangeMe!a3" }) })).json();

const BLUR = `
  *:not(svg):not(svg *):not(img):not(canvas):not(video) {
    color: transparent !important;
    text-shadow: 0 0 6px rgba(20, 20, 20, 0.55) !important;
    caret-color: transparent !important;
  }
  ::placeholder { color: transparent !important; text-shadow: 0 0 6px rgba(20,20,20,.4) !important; }
`;

const browser = await chromium.launch({ channel: "chrome" });
for (const [role, cfg] of Object.entries(ROLES)) {
  const session = cfg.phone ? await login(cfg.phone) : null;
  for (const [vp, size] of Object.entries(VIEWPORTS)) {
    const ctx = await browser.newContext({ viewport: size, deviceScaleFactor: 1 });
    await ctx.addInitScript(([t, u, l]) => {
      localStorage.setItem("arena3.lang", l);
      if (t) {
        localStorage.setItem("arena3.token", t);
        localStorage.setItem("arena3.user", JSON.stringify(u));
      }
    }, [session?.token ?? null, session?.user ?? null, lang]);
    const page = await ctx.newPage();
    for (const route of cfg.routes) {
      await page.goto(base + route, { waitUntil: "networkidle" }).catch(() => undefined);
      await page.waitForTimeout(1100);
      if (squint) {
        // Icons inherit currentColor from the text colour; pin it before the text is made clear.
        await page.evaluate(() => {
          for (const el of document.querySelectorAll("svg")) el.style.setProperty("color", getComputedStyle(el).color, "important");
        });
        await page.addStyleTag({ content: BLUR });
        await page.waitForTimeout(150);
      }
      const name = `${role}${route.replace(/\//g, "-")}-${vp}`.replace(/-+/g, "-").replace(/-$/, "");
      await page.screenshot({ path: `${out}/${name}.png` });
    }
    await ctx.close();
  }
}
await browser.close();
console.log("done ->", out);
