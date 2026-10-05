import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { runDemo, type DemoBrowser, type DemoPlan, type DemoPacing } from "../shared/demo.js";

export interface PlaywrightDemoConfig extends Partial<DemoPacing> {
  base_url?: string;
  evidence_dir: string;
  headless?: boolean;
}

export async function runPlaywrightDemo(planFile: string, config: PlaywrightDemoConfig): Promise<{ screenshots: string[]; consoleErrors: string[]; pageErrors: string[] }> {
  const plan = JSON.parse(await readFile(planFile, "utf8")) as DemoPlan;
  const evidenceDir = resolve(config.evidence_dir);
  await mkdir(evidenceDir, { recursive: true });
  const browser = await chromium.launch({ headless: config.headless ?? false });
  const page = await browser.newPage();
  const screenshots: string[] = [];
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const adapter: DemoBrowser = {
    open: async (target) => { await page.goto(new URL(target, config.base_url).toString(), { waitUntil: "domcontentloaded" }); },
    click: async (target) => { await page.getByText(target, { exact: true }).click(); },
    fill: async (target, value) => { await page.locator(target).fill(value); },
    waitFor: async (target) => { await page.getByText(target, { exact: true }).waitFor({ state: "visible" }); },
    screenshot: async (name) => { const path = resolve(evidenceDir, `${screenshots.length + 1}-${name.replace(/[^a-z0-9_-]+/gi, "-")}.png`); await page.screenshot({ path, fullPage: false }); screenshots.push(path); },
  };
  try {
    await runDemo(plan, adapter, config);
    const finalPath = resolve(evidenceDir, "final.png");
    await page.screenshot({ path: finalPath, fullPage: false });
    screenshots.push(finalPath);
    if (consoleErrors.length || pageErrors.length) throw new Error(`Demo produced browser errors: ${[...consoleErrors, ...pageErrors].join("; ")}`);
    return { screenshots, consoleErrors, pageErrors };
  } finally {
    await browser.close();
  }
}
