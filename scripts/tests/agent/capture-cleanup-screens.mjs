import { chromium } from "playwright";
import { mkdirSync, openSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

const BASE = "http://127.0.0.1:8090";
const SCREENS_DIR = resolve("test-output/cleanup/screens");
mkdirSync(SCREENS_DIR, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  console.log("Starting safe server on port 8090...");
  const logFd = openSync("test-output/logs/server-capture.log", "w");
  const server = spawn(process.execPath, ["scripts/tests/start-safe-server.mjs"], {
    stdio: ["ignore", logFd, logFd],
    windowsHide: true,
  });

  const ready = await waitReady();
  if (!ready) {
    console.error("Safe server failed to become ready in time.");
    server.kill();
    process.exit(1);
  }
  console.log("Safe server ready on http://127.0.0.1:8090!");

  try {
    console.log("Launching headless browser to capture cleanup screens...");
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();

    // 1. Sign in as Receptionist using demo pill
    console.log("Navigating to login page...");
    await page.goto(`${BASE}/login`);
    await page.waitForLoadState("networkidle");
    console.log("Clicking Front Desk demo account...");
    await page.click('button:has-text("Front Desk")');
    await page.waitForTimeout(2000);

    // Screen 1: /desk (menu & body should not have Vé ngày)
    console.log("Capturing 01-desk-no-daypass.png...");
    await page.goto(`${BASE}/desk`);
    await page.waitForTimeout(2000);
    await page.screenshot({ path: join(SCREENS_DIR, "01-desk-no-daypass.png"), fullPage: false });
    console.log("Captured 01-desk-no-daypass.png");

    // Screen 3: /desk/payments (EN and VI)
    console.log("Capturing 03-desk-payments-en.png...");
    await page.goto(`${BASE}/desk/payments`);
    await page.waitForTimeout(2000);
    await page.screenshot({ path: join(SCREENS_DIR, "03-desk-payments-en.png"), fullPage: false });
    console.log("Captured 03-desk-payments-en.png");

    console.log("Capturing 03-desk-payments-vi.png...");
    try {
      const viBtn = page.locator('button[lang="vi"]');
      if (await viBtn.isVisible()) {
        await viBtn.click();
        await page.waitForTimeout(1000);
      }
    } catch {}
    await page.screenshot({ path: join(SCREENS_DIR, "03-desk-payments-vi.png"), fullPage: false });
    console.log("Captured 03-desk-payments-vi.png");

    // Screen 5: /desk/day-passes (not found / 404)
    console.log("Capturing 05-desk-daypasses-not-found.png...");
    await page.goto(`${BASE}/desk/day-passes`);
    await page.waitForTimeout(2000);
    await page.screenshot({ path: join(SCREENS_DIR, "05-desk-daypasses-not-found.png"), fullPage: false });
    console.log("Captured 05-desk-daypasses-not-found.png");

    // Switch to Manager (Arena3 Manager)
    console.log("Signing in as Manager...");
    await page.goto(`${BASE}/login`);
    await page.waitForLoadState("networkidle");
    await page.click('button:has-text("Arena3 Manager")');
    await page.waitForTimeout(2000);

    // Screen 2: /manager/settings
    console.log("Capturing 02-manager-settings-no-daypass.png...");
    await page.goto(`${BASE}/manager/settings`);
    await page.waitForTimeout(2000);
    await page.screenshot({ path: join(SCREENS_DIR, "02-manager-settings-no-daypass.png"), fullPage: true });
    console.log("Captured 02-manager-settings-no-daypass.png");

    // Screen 4: /manager/audit with historical "Bán vé ngày" audit row
    console.log("Setting up /manager/audit with historical audit item...");
    await page.route("**/v1/audit*", async (route) => {
      try {
        const response = await route.fetch();
        const json = await response.json();
        const historicalItem = {
          id: 9999,
          at: new Date(Date.now() - 5 * 86400000).toISOString(),
          actor_id: "00000000-0000-0000-0000-000000000002",
          actor_name: "Lễ tân (Nguyễn Thị Mai)",
          actor_role: "receptionist",
          action: "sell_day_pass",
          entity: "day_pass",
          entity_id: "10000000-0000-0000-0000-000000000099",
          before: null,
          after: { code: "DP-20261005-001", price_vnd: 60000, guest: "Trần Văn Nam" },
        };
        if (Array.isArray(json.items)) {
          json.items.unshift(historicalItem);
        }
        if (Array.isArray(json.actions) && !json.actions.includes("sell_day_pass")) {
          json.actions.push("sell_day_pass");
        }
        if (Array.isArray(json.entities) && !json.entities.includes("day_pass")) {
          json.entities.push("day_pass");
        }
        await route.fulfill({ json });
      } catch (e) {
        await route.continue();
      }
    });

    console.log("Navigating to /manager/audit...");
    await page.goto(`${BASE}/manager/audit`);
    await page.waitForTimeout(2000);
    try {
      const viBtn = page.locator('button[lang="vi"]');
      if (await viBtn.isVisible()) {
        await viBtn.click();
        await page.waitForTimeout(1500);
      }
    } catch (e) {
      console.log("Language toggle not needed or failed:", e.message);
    }
    // phản hồi /v1/audit được giả lập bằng Playwright page.route (capture-cleanup-screens.mjs:101-131); bằng chứng phía server là RMV-11 trong rmv-legacy-daypass.mjs
    await page.screenshot({ path: join(SCREENS_DIR, "04-manager-audit-MOCKED.png"), fullPage: false });
    console.log("Captured 04-manager-audit-MOCKED.png with visible 'Bán vé ngày'");

    await browser.close();
    console.log("All screenshots captured successfully in test-output/cleanup/screens/!");
  } finally {
    server.kill();
  }
}

main().catch((err) => {
  console.error("Screenshot capture failed:", err);
  process.exit(1);
});
