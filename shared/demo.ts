export type DemoStep = { action: "open" | "click" | "fill" | "wait_for" | "screenshot"; target: string; value?: string; explain?: string };
export interface DemoPlan { title: string; steps: DemoStep[]; }
export interface DemoBrowser { open(url: string): Promise<void>; click(target: string): Promise<void>; fill(target: string, value: string): Promise<void>; waitFor(target: string): Promise<void>; screenshot(name: string): Promise<void>; }
export interface DemoPacing { before_action_ms: number; after_click_ms: number; after_navigation_ms: number; after_major_state_change_ms: number; typing_delay_ms: number; final_hold_ms: number; speed: number; }
export async function runDemo(plan: DemoPlan, browser: DemoBrowser, pacing: Partial<DemoPacing> = {}): Promise<void> {
  const p: DemoPacing = { before_action_ms: 700, after_click_ms: 900, after_navigation_ms: 1500, after_major_state_change_ms: 1800, typing_delay_ms: 65, final_hold_ms: 3000, speed: 1, ...pacing };
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, Math.max(50, ms / p.speed)));
  for (const step of plan.steps) { await wait(p.before_action_ms); if (step.action === "open") { await browser.open(step.target); await wait(p.after_navigation_ms); } else if (step.action === "click") { await browser.click(step.target); await wait(p.after_click_ms); } else if (step.action === "fill") { await browser.fill(step.target, step.value ?? ""); await wait(p.typing_delay_ms * Math.max(1, (step.value ?? "").length)); } else if (step.action === "wait_for") { await browser.waitFor(step.target); await wait(p.after_major_state_change_ms); } else { await browser.screenshot(step.target); } }
  await wait(p.final_hold_ms);
}
