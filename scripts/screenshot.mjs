import puppeteer from "puppeteer";
import { mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "../.github/assets");
mkdirSync(OUT, { recursive: true });

const BASE = "http://localhost:3000";

const browser = await puppeteer.launch({
  headless: true,
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  args: ["--no-sandbox", "--disable-setuid-sandbox", "--window-size=1440,900"],
  defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 2 },
});

const page = await browser.newPage();

async function shot(name, url, waitFor, extraMs = 800) {
  await page.goto(`${BASE}${url}`, { waitUntil: "networkidle0" });
  if (waitFor) await page.waitForSelector(waitFor, { timeout: 8000 }).catch(() => {});
  await new Promise(r => setTimeout(r, extraMs));
  await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: false });
  console.log(`✓ ${name}.png`);
}

// 1. Dashboard with tasks
await shot("01-dashboard", "/", "table");

// 2. New Task form
await shot("02-new-task", "/tasks/new", "input");

// 3. Completed task detail — get first completed task id from the API
const tasks = await page.evaluate(async () => {
  const r = await fetch("/api/tasks");
  return r.json();
});
const completed = tasks.items?.find(t => t.status === "completed");
const failed    = tasks.items?.find(t => t.status === "failed");

if (completed) await shot("03-task-detail-completed", `/tasks/${completed.task_id}`, ".prose");
if (failed)    await shot("04-task-detail-failed",   `/tasks/${failed.task_id}`,   ".bg-rose-50");

// 4. Memory explorer
await shot("05-memory-explorer", "/memory", "table, .text-center");

// 5. Demo scenarios playground
await shot("06-demo-scenarios", "/demo", "button");

await browser.close();
console.log("\nAll screenshots saved to .github/assets/");
