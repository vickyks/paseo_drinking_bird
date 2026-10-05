import { readFile } from "node:fs/promises";
import type { ClassifierConfig, ControllerConfig } from "../shared/types.js";

export interface DrinkingBirdConfig {
  classifier: ClassifierConfig;
  limits: ControllerConfig;
}

const defaults: DrinkingBirdConfig = {
  classifier: { provider: "hybrid", deterministic_first: true, auto_act_confidence: 0.8, escalate_below: 0.55 },
  limits: { max_auto_turns: 12, max_repeated_state: 3, max_identical_blocker_repeats: 2 },
};

export async function loadConfig(): Promise<DrinkingBirdConfig> {
  const file = process.env.PASEO_DRINKING_BIRD_CONFIG_FILE;
  const fileConfig = file ? JSON.parse(await readFile(file, "utf8")) as Partial<DrinkingBirdConfig> : {};
  const classifier = { ...defaults.classifier, ...(fileConfig.classifier ?? {}) };
  const limits = { ...defaults.limits, ...(fileConfig.limits ?? {}) };
  const provider = process.env.PASEO_DRINKING_BIRD_CLASSIFIER as ClassifierConfig["provider"] | undefined;
  if (provider) classifier.provider = provider;
  if (process.env.PASEO_DRINKING_BIRD_CLASSIFIER_ENDPOINT) classifier.endpoint = process.env.PASEO_DRINKING_BIRD_CLASSIFIER_ENDPOINT;
  if (process.env.PASEO_DRINKING_BIRD_CLASSIFIER_MODEL) classifier.model = process.env.PASEO_DRINKING_BIRD_CLASSIFIER_MODEL;
  if (process.env.PASEO_DRINKING_BIRD_CLASSIFIER_API_KEY) classifier.api_key = process.env.PASEO_DRINKING_BIRD_CLASSIFIER_API_KEY;
  return { classifier, limits };
}
