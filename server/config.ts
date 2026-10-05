import { readFile } from "node:fs/promises";
import type { ClassifierConfig, ControllerConfig } from "../shared/types.js";

export interface DrinkingBirdConfig {
  classifier: ClassifierConfig;
  limits: ControllerConfig;
  reviewer: { enabled: boolean; provider?: string; model?: string; max_context_round_trips: number };
  demo: { enabled: boolean; plan_file?: string; evidence_dir: string; base_url?: string; headless: boolean; speed: number };
}

const defaults: DrinkingBirdConfig = {
  classifier: { provider: "hybrid", deterministic_first: true, auto_act_confidence: 0.8, escalate_below: 0.55 },
  limits: { max_auto_turns: 12, max_repeated_state: 3, max_identical_blocker_repeats: 2 },
  reviewer: { enabled: false, max_context_round_trips: 3 },
  demo: { enabled: false, evidence_dir: "./drinking-bird-demo-evidence", headless: false, speed: 1 },
};

export async function loadConfig(): Promise<DrinkingBirdConfig> {
  const file = process.env.PASEO_DRINKING_BIRD_CONFIG_FILE;
  const fileConfig = file ? JSON.parse(await readFile(file, "utf8")) as Partial<DrinkingBirdConfig> : {};
  const classifier = { ...defaults.classifier, ...(fileConfig.classifier ?? {}) };
  const limits = { ...defaults.limits, ...(fileConfig.limits ?? {}) };
  const reviewer = { ...defaults.reviewer, ...(fileConfig.reviewer ?? {}) };
  const demo = { ...defaults.demo, ...(fileConfig.demo ?? {}) };
  const provider = process.env.PASEO_DRINKING_BIRD_CLASSIFIER as ClassifierConfig["provider"] | undefined;
  if (provider) classifier.provider = provider;
  if (process.env.PASEO_DRINKING_BIRD_CLASSIFIER_ENDPOINT) classifier.endpoint = process.env.PASEO_DRINKING_BIRD_CLASSIFIER_ENDPOINT;
  if (process.env.PASEO_DRINKING_BIRD_CLASSIFIER_MODEL) classifier.model = process.env.PASEO_DRINKING_BIRD_CLASSIFIER_MODEL;
  if (process.env.PASEO_DRINKING_BIRD_CLASSIFIER_API_KEY) classifier.api_key = process.env.PASEO_DRINKING_BIRD_CLASSIFIER_API_KEY;
  if (process.env.PASEO_DRINKING_BIRD_REVIEWER_ENABLED === "true") reviewer.enabled = true;
  if (process.env.PASEO_DRINKING_BIRD_REVIEWER_PROVIDER) reviewer.provider = process.env.PASEO_DRINKING_BIRD_REVIEWER_PROVIDER;
  if (process.env.PASEO_DRINKING_BIRD_REVIEWER_MODEL) reviewer.model = process.env.PASEO_DRINKING_BIRD_REVIEWER_MODEL;
  if (process.env.PASEO_DRINKING_BIRD_DEMO_ENABLED === "true") demo.enabled = true;
  if (process.env.PASEO_DRINKING_BIRD_DEMO_PLAN) demo.plan_file = process.env.PASEO_DRINKING_BIRD_DEMO_PLAN;
  if (process.env.PASEO_DRINKING_BIRD_DEMO_BASE_URL) demo.base_url = process.env.PASEO_DRINKING_BIRD_DEMO_BASE_URL;
  return { classifier, limits, reviewer, demo };
}
