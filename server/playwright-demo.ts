import { execFile } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { resolve } from "node:path";
import type { DemoPlan, DemoPacing } from "../shared/demo.js";

const execFileAsync = promisify(execFile);

export interface PlaywrightDemoConfig extends Partial<DemoPacing> {
  command?: string;
  args?: string[];
  base_url?: string;
  evidence_dir: string;
  headless?: boolean;
}

export async function runPlaywrightDemo(planFile: string, config: PlaywrightDemoConfig): Promise<{ evidenceDir: string; output: string }> {
  const plan = JSON.parse(await readFile(planFile, "utf8")) as DemoPlan;
  const evidenceDir = resolve(config.evidence_dir);
  await mkdir(evidenceDir, { recursive: true });
  const command = config.command ?? "npx";
  const args = config.args ?? ["playwright", "test", planFile];
  const result = await execFileAsync(command, args, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PASEO_DRINKING_BIRD_DEMO_PLAN: resolve(planFile),
      PASEO_DRINKING_BIRD_DEMO_EVIDENCE_DIR: evidenceDir,
      PASEO_DRINKING_BIRD_DEMO_BASE_URL: config.base_url ?? "",
      PASEO_DRINKING_BIRD_DEMO_HEADLESS: String(config.headless ?? false),
      PASEO_DRINKING_BIRD_DEMO_SPEED: String(config.speed ?? 1),
      PASEO_DRINKING_BIRD_DEMO_PACING: JSON.stringify(config),
    },
    maxBuffer: 10 * 1024 * 1024,
  });
  return { evidenceDir, output: `${result.stdout}${result.stderr}` };
}
