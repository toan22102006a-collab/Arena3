/**
 * capture-manager-admin.mjs — Screenshot capture for Phần 5.6
 *
 * Captures all required screens in both Desktop (1440x900) and Mobile (390x844),
 * in light mode and Vietnamese (VI) locale:
 *   - /manager/media: list and change image dialog with preview
 *   - /manager/courts: list, add court dialog, blocked retire dialog
 *   - /manager/staff: list, add coach dialog with avatar upload
 *   - landing: before and after changing hero image
 *   - /app/book: after adding court
 *
 * Output: test-output/manager-admin/
 */

import { chromium } from "playwright";
import { existsSync, mkdirSync, openSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { execSync, spawn } from "node:child_process";

const BASE = "http://127.0.0.1:8090";
const OUT_DIR = resolve("test-output/manager-admin");
mkdirSync(OUT_DIR, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function killPid(pid) {
  try {
    if (process.platform === "win32") {
      execSync(`taskkill /PID ${pid} /T /F`, { stdio: "ignore", windowsHide: true });
    } else {
      process.kill(pid, "SIGKILL");
    }
  } catch {}
}

async function waitReady(timeoutMs = 120000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      const r = await fetch(`${BASE}/v1/classes`, { signal: AbortSignal.timeout(5000) });
      if (r.status === 200) return true;
    } catch {}
    await sleep(1000);
  }
  return false;
}

async function main() {
  console.log("===============================================================");
  console.log("  CAPTURING MANAGER-ADMIN SCREENSHOTS (DESKTOP & MOBILE, VI)");
  console.log("===============================================================\n");

  // Check if safe server is already running
  let serverProcess = null;
  let isReady = false;
  try {
    const res = await fetch(`${BASE}/v1/health`);
    if (res.ok) isReady = true;
  } catch {}

  if (!isReady) {
    console.log("Starting safe server on port 8090...");
    const logFd = openSync("test-output/logs/server-capture.log", "w");
    serverProcess = spawn(process.execPath, ["scripts/tests/start-safe-server.mjs"], {
      stdio: ["ignore", logFd, logFd],
      windowsHide: true,
    });
    const ready = await waitReady();
    if (!ready) {
      console.error("Safe server failed to become ready in time.");
      if (serverProcess) killPid(serverProcess.pid);
      process.exit(1);
    }
    console.log("Safe server ready on http://127.0.0.1:8090!");
  } else {
    console.log("Safe server is already running on http://127.0.0.1:8090");
  }

  try {
    // 1. Obtain Manager and Member credentials
    const mgrLoginRes = await fetch(`${BASE}/v1/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ login: "0900000001", password: "ChangeMe!a3" }),
    });
    const mgrData = await mgrLoginRes.json();
    const mgrToken = mgrData.token;
    const mgrUser = mgrData.user;

    const memLoginRes = await fetch(`${BASE}/v1/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ login: "0901230107", password: "ChangeMe!a3" }),
    });
    const memData = await memLoginRes.json();
    const memToken = memData.token;
    const memUser = memData.user;

    // Ensure court CL-13 exists for /app/book verification
    await fetch(`${BASE}/v1/manager/courts`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${mgrToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        sport: "badminton",
        court_code: "CL-13",
        display_name: "Sân Cầu Lông 13",
      }),
    });

    const browser = await chromium.launch({ headless: true });

    const viewports = [
      { name: "desktop", width: 1440, height: 900, isMobile: false },
      { name: "mobile", width: 390, height: 844, isMobile: true },
    ];

    for (const vp of viewports) {
      console.log(`\n--- Capturing viewport: ${vp.name} (${vp.width}x${vp.height}) ---`);

      // -------------------------------------------------------------
      // PART A: PUBLIC LANDING (No auth session, Vietnamese locale)
      // -------------------------------------------------------------
      {
        const publicContext = await browser.newContext({
          viewport: { width: vp.width, height: vp.height },
          isMobile: vp.isMobile,
          hasTouch: vp.isMobile,
        });

        const pubPage = await publicContext.newPage();
        await pubPage.addInitScript(() => {
          localStorage.clear();
          localStorage.setItem("arena3.lang", "vi");
        });

        // Disable video slot so image is rendered cleanly as poster / image fallback
        await fetch(`${BASE}/v1/manager/site-assets/landing.hero.video`, {
          method: "PATCH",
          headers: {
            authorization: `Bearer ${mgrToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ enabled: false }),
        });

        // Reset hero image to default
        await fetch(`${BASE}/v1/manager/site-assets/landing.hero.image/reset`, {
          method: "POST",
          headers: { authorization: `Bearer ${mgrToken}` },
        });

        console.log(`[${vp.name}] 08 - Landing before hero image change...`);
        await pubPage.goto(`${BASE}/`, { waitUntil: "networkidle" });
        await pubPage.waitForSelector("h1", { timeout: 15000 });
        await pubPage.waitForTimeout(1500);
        await pubPage.screenshot({
          path: join(OUT_DIR, `08-landing-before-hero-${vp.name}.png`),
          fullPage: false,
        });

        // Upload distinct exterior image to hero
        console.log(`[${vp.name}] 09 - Landing after hero image change...`);
        const imgPath = resolve("public/media/exterior.jpg");
        const imgBytes = readFileSync(imgPath);
        await fetch(`${BASE}/v1/manager/site-assets/upload`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${mgrToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            slot: "landing.hero.image",
            data_base64: imgBytes.toString("base64"),
            alt_vi: "Cơ sở thi đấu hiện đại",
          }),
        });

        await pubPage.goto(`${BASE}/`, { waitUntil: "networkidle" });
        await pubPage.waitForSelector("h1", { timeout: 15000 });
        await pubPage.waitForTimeout(1500);
        await pubPage.screenshot({
          path: join(OUT_DIR, `09-landing-after-hero-${vp.name}.png`),
          fullPage: false,
        });

        // Reset landing assets
        await fetch(`${BASE}/v1/manager/site-assets/landing.hero.image/reset`, {
          method: "POST",
          headers: { authorization: `Bearer ${mgrToken}` },
        });
        await fetch(`${BASE}/v1/manager/site-assets/landing.hero.video`, {
          method: "PATCH",
          headers: {
            authorization: `Bearer ${mgrToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ enabled: true }),
        });

        await publicContext.close();
      }

      // -------------------------------------------------------------
      // PART B: MEMBER APP (/app/book showing newly added court CL-13)
      // -------------------------------------------------------------
      {
        const memberContext = await browser.newContext({
          viewport: { width: vp.width, height: vp.height },
          isMobile: vp.isMobile,
          hasTouch: vp.isMobile,
        });

        const memPage = await memberContext.newPage();
        await memPage.addInitScript(
          ({ token, user }) => {
            localStorage.setItem("arena3.lang", "vi");
            localStorage.setItem("arena3.token", token);
            localStorage.setItem("arena3.user", JSON.stringify(user));
          },
          { token: memToken, user: memUser },
        );

        console.log(`[${vp.name}] 10 - /app/book after adding court...`);
        await memPage.goto(`${BASE}/app/book`, { waitUntil: "networkidle" });
        await memPage.waitForTimeout(2000);
        await memPage.screenshot({
          path: join(OUT_DIR, `10-app-book-after-court-${vp.name}.png`),
          fullPage: false,
        });

        await memberContext.close();
      }

      // -------------------------------------------------------------
      // PART C: MANAGER ADMIN (/manager/media, courts, staff)
      // -------------------------------------------------------------
      {
        const mgrContext = await browser.newContext({
          viewport: { width: vp.width, height: vp.height },
          isMobile: vp.isMobile,
          hasTouch: vp.isMobile,
        });

        const consoleErrors = [];
        const badRequests = [];

        const page = await mgrContext.newPage();
        page.on("console", (msg) => {
          if (msg.type() === "error") {
            consoleErrors.push(`[console.error] ${msg.text()}`);
          }
        });
        page.on("response", (res) => {
          if (res.status() >= 400 && !res.url().includes("/retire") && !res.url().includes("/favicon")) {
            badRequests.push(`[${res.status()}] ${res.url()}`);
          }
        });

        await page.addInitScript(
          ({ token, user }) => {
            localStorage.setItem("arena3.lang", "vi");
            localStorage.setItem("arena3.token", token);
            localStorage.setItem("arena3.user", JSON.stringify(user));
          },
          { token: mgrToken, user: mgrUser },
        );

        // --- 01 & 02: /manager/media ---
        console.log(`[${vp.name}] 01 - /manager/media list...`);
        await page.goto(`${BASE}/manager/media`, { waitUntil: "networkidle" });
        await page.waitForTimeout(1500);
        await page.screenshot({
          path: join(OUT_DIR, `01-media-list-${vp.name}.png`),
          fullPage: false,
        });

        console.log(`[${vp.name}] 02 - /manager/media change image dialog with preview...`);
        const changeBtn = page.locator('button:has-text("Thay ảnh")').first();
        if (await changeBtn.isVisible()) {
          await changeBtn.click({ force: true });
          await page.waitForTimeout(500);
          // Set preview file
          const fileInput = page.locator('input[type="file"]').first();
          if (await fileInput.count() > 0) {
            await fileInput.setInputFiles(resolve("public/media/exterior.jpg"));
            await page.waitForTimeout(500);
          }
          await page.screenshot({
            path: join(OUT_DIR, `02-media-dialog-${vp.name}.png`),
            fullPage: false,
          });
          await page.keyboard.press("Escape");
          await page.waitForTimeout(500);
        }

        // --- 03, 04 & 05: /manager/courts ---
        console.log(`[${vp.name}] 03 - /manager/courts list...`);
        await page.goto(`${BASE}/manager/courts`, { waitUntil: "networkidle" });
        await page.waitForTimeout(1500);
        await page.screenshot({
          path: join(OUT_DIR, `03-courts-list-${vp.name}.png`),
          fullPage: false,
        });

        console.log(`[${vp.name}] 04 - /manager/courts add court dialog...`);
        const addCourtBtn = page.locator('button:has-text("Thêm sân")').first();
        if (await addCourtBtn.isVisible()) {
          await addCourtBtn.click({ force: true });
          await page.waitForTimeout(600);
          await page.screenshot({
            path: join(OUT_DIR, `04-courts-create-${vp.name}.png`),
            fullPage: false,
          });
          await page.keyboard.press("Escape");
          await page.waitForTimeout(500);
        }

        console.log(`[${vp.name}] 05 - /manager/courts blocked retire dialog...`);
        // Find court CL-01 and click its retire button
        const retireBtns = page.locator('button:has-text("Ngừng sử dụng")');
        const count = await retireBtns.count();
        if (count > 0) {
          await retireBtns.first().click({ force: true });
          await page.waitForTimeout(500);
          // Click confirm button in the confirmation modal
          const confirmBtn = page.locator('[role="dialog"] button:has-text("Ngừng")').last();
          if (await confirmBtn.isVisible()) {
            await confirmBtn.click({ force: true });
            await page.waitForTimeout(1500);
          }
          await page.screenshot({
            path: join(OUT_DIR, `05-courts-blocked-${vp.name}.png`),
            fullPage: false,
          });
          await page.keyboard.press("Escape");
          await page.waitForTimeout(500);
        }

        // --- 06 & 07: /manager/staff ---
        console.log(`[${vp.name}] 06 - /manager/staff list...`);
        await page.goto(`${BASE}/manager/staff`, { waitUntil: "networkidle" });
        await page.waitForTimeout(1500);
        await page.screenshot({
          path: join(OUT_DIR, `06-staff-list-${vp.name}.png`),
          fullPage: false,
        });

        console.log(`[${vp.name}] 07 - /manager/staff add coach dialog with avatar...`);
        const addStaffBtn = page.locator('button:has-text("Thêm nhân viên")').first();
        if (await addStaffBtn.isVisible()) {
          await addStaffBtn.click({ force: true });
          await page.waitForTimeout(500);
          const roleSelect = page.locator('[role="dialog"] select').first();
          if (await roleSelect.isVisible()) {
            await roleSelect.selectOption("coach");
            await page.waitForTimeout(500);
          }
          await page.screenshot({
            path: join(OUT_DIR, `07-staff-create-coach-${vp.name}.png`),
            fullPage: false,
          });
          await page.keyboard.press("Escape");
          await page.waitForTimeout(500);
        }

        await mgrContext.close();

        if (consoleErrors.length > 0) {
          console.warn(`[WARN] Console errors detected on ${vp.name}:`, consoleErrors);
        }
        if (badRequests.length > 0) {
          console.warn(`[WARN] Unexpected 4xx/5xx requests on ${vp.name}:`, badRequests);
        }
      }
    }

    await browser.close();
    console.log("\nAll screenshots captured successfully into test-output/manager-admin/!");
  } finally {
    if (serverProcess) {
      console.log("Shutting down safe server...");
      killPid(serverProcess.pid);
    }
  }
}

main().catch((err) => {
  console.error("Capture failed:", err);
  process.exit(1);
});
