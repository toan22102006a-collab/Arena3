// Renders docs/ui-review/report.html to docs/Arena3-UIUX-Report.pdf
import { chromium } from "playwright";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage();
await page.goto(pathToFileURL(resolve("docs/ui-review/report.html")).href, { waitUntil: "load" });
await page.waitForTimeout(500);
await page.pdf({ path: "docs/Arena3-UIUX-Report.pdf", format: "A4", printBackground: true, preferCSSPageSize: true });
await browser.close();
console.log("ok");
