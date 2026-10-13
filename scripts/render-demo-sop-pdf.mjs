import { chromium } from "playwright";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage();

const htmlPath = resolve("docs/demo-sop-pdf.html");
const pdfPath = resolve("docs/Arena3-Phan-cong-va-Kich-ban-Nghiem-thu.pdf");

console.log("Loading HTML:", htmlPath);
await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "networkidle" });
await page.waitForTimeout(1000);

console.log("Generating PDF:", pdfPath);
await page.pdf({
  path: pdfPath,
  format: "A4",
  printBackground: true,
  preferCSSPageSize: true,
});

await browser.close();
console.log("Successfully generated:", pdfPath);
