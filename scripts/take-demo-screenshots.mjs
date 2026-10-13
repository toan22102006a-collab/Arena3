import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const base = "http://127.0.0.1:8080";
const out = "docs/demo-screenshots";
mkdirSync(out, { recursive: true });

async function getSession(phone) {
  const r = await fetch(`${base}/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phone, password: "ChangeMe!a3" }),
  });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`Login failed for ${phone}: ${r.status} ${txt}`);
  }
  return r.json();
}

const browser = await chromium.launch({ channel: "chrome" });

console.log("Taking screenshots...");

// 1. Login screen
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(`${base}/login`, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${out}/01_login_roles.png` });
  await page.close();
}

// 2. Manager dashboard
{
  const session = await getSession("0900000001");
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(([t, u]) => {
    localStorage.setItem("arena3.token", t);
    localStorage.setItem("arena3.user", JSON.stringify(u));
  }, [session.token, session.user]);
  const page = await ctx.newPage();
  await page.goto(`${base}/manager`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/02_manager_dashboard.png` });
  
  // Manager audit
  await page.goto(`${base}/manager/audit`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/03_manager_audit.png` });

  // Manager classes
  await page.goto(`${base}/manager/classes`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/04_manager_classes.png` });

  await ctx.close();
}

// 3. Receptionist Desk
{
  const session = await getSession("0900000002");
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(([t, u]) => {
    localStorage.setItem("arena3.token", t);
    localStorage.setItem("arena3.user", JSON.stringify(u));
  }, [session.token, session.user]);
  const page = await ctx.newPage();
  
  await page.goto(`${base}/desk`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/05_desk_overview.png` });

  await page.goto(`${base}/desk/payments`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/06_desk_payments.png` });

  await page.goto(`${base}/desk/gate`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/07_desk_gate.png` });

  await page.goto(`${base}/desk/at-risk`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/08_desk_at_risk.png` });

  await ctx.close();
}

// 4. Coach Khoa
{
  const session = await getSession("0901110011");
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(([t, u]) => {
    localStorage.setItem("arena3.token", t);
    localStorage.setItem("arena3.user", JSON.stringify(u));
  }, [session.token, session.user]);
  const page = await ctx.newPage();

  await page.goto(`${base}/coach`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/09_coach_schedule.png` });

  await page.goto(`${base}/coach/attendance`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/10_coach_attendance.png` });

  await ctx.close();
}

// 5. Member Nam (Mobile & Desktop)
{
  const session = await getSession("0901230101");
  const ctx = await browser.newContext({ viewport: { width: 420, height: 850 } }); // mobile view
  await ctx.addInitScript(([t, u]) => {
    localStorage.setItem("arena3.token", t);
    localStorage.setItem("arena3.user", JSON.stringify(u));
  }, [session.token, session.user]);
  const page = await ctx.newPage();

  await page.goto(`${base}/app`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/11_member_home_mobile.png` });

  await page.goto(`${base}/app/book`, { waitUntil: "networkidle" });
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${out}/12_member_book_court.png` });

  await page.goto(`${base}/app/classes`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/13_member_classes.png` });

  await page.goto(`${base}/app/pass`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/14_member_gate_pass.png` });

  await page.goto(`${base}/app/assistant`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/15_member_assistant.png` });

  await page.goto(`${base}/account`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/16_member_account_receipts.png` });

  await ctx.close();
}

await browser.close();
console.log("All screenshots captured successfully!");
