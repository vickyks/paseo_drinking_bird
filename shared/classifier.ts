import type { ClassifierConfig, TurnClassification, TurnClassificationInput, TurnState } from "./types.js";

export interface TurnClassifier {
  classify(input: TurnClassificationInput): Promise<TurnClassification>;
}

export class RulesClassifier implements TurnClassifier {
  async classify(input: TurnClassificationInput): Promise<TurnClassification> {
    const runtime = input.runtime;
    if (runtime?.unresolved_errors?.length) return { state: "CONTINUE", confidence: 0.99, reason: "Runtime errors remain unresolved" };
    if (runtime?.mr_required && !runtime.mr_created) return { state: "VERIFY_DONE", confidence: 0.99, reason: "A merge request is required but has not been created" };
    if (runtime?.tests_run && runtime.tests_passed === false) return { state: "CONTINUE", confidence: 0.99, reason: "Required tests failed" };
    const remaining = input.plan?.items.filter((item) => item.status !== "done") ?? [];
    const hasCompletionEvidence = input.plan !== undefined || runtime?.tests_passed === true;
    if (hasCompletionEvidence && remaining.length === 0 && runtime?.tests_passed !== false) return { state: "DONE", confidence: 0.82, reason: "No unresolved plan items or runtime failures remain" };
    if (remaining.some((item) => item.status === "blocked")) return { state: "NEEDS_DECISION", confidence: 0.84, reason: "An existing plan item is blocked" };
    if (remaining.some((item) => item.status === "pending")) return { state: "NEXT_TODO", confidence: 0.88, reason: "The existing plan contains unresolved todo items" };
    return { state: "CONTINUE", confidence: 0.72, reason: "The task has not met deterministic completion conditions" };
  }
}

export class HeuristicClassifier implements TurnClassifier {
  async classify(input: TurnClassificationInput): Promise<TurnClassification> {
    const message = input.last_agent_message.toLowerCase();
    if (/\b(needs? you|need your|waiting for human|missing credentials|which product|business decision)\b/.test(message)) return { state: "NEEDS_USER", confidence: 0.78, reason: "The agent explicitly requests human or product input" };
    if (/\b(technical decision|architecture decision|which (library|framework|database)|should we choose|need to decide)\b/.test(message)) return { state: "NEEDS_DECISION", confidence: 0.76, reason: "The agent describes a technical choice requiring review" };
    if (/\b(done|complete|implemented|finished)\b/.test(message) && input.runtime?.tests_passed === true) return { state: "DONE", confidence: 0.84, reason: "Completion language is supported by passing test evidence" };
    if (/\b(progress|implemented part|next I will|remaining|still need)\b/.test(message)) return { state: "CONTINUE", confidence: 0.86, reason: "The final message describes unfinished work" };
    return { state: "CONTINUE", confidence: 0.58, reason: "Completion cannot be established from the available evidence" };
  }
}

export class HybridClassifier implements TurnClassifier {
  constructor(private readonly rules: TurnClassifier, private readonly fallback: TurnClassifier, private readonly autoActConfidence = 0.8) {}
  async classify(input: TurnClassificationInput): Promise<TurnClassification> {
    const result = await this.rules.classify(input);
    return result.confidence >= this.autoActConfidence ? result : this.fallback.classify(input);
  }
}

export class HttpClassifier implements TurnClassifier {
  constructor(private readonly endpoint: string, private readonly config: Pick<ClassifierConfig, "model" | "api_key"> = {}) {}
  async classify(input: TurnClassificationInput): Promise<TurnClassification> {
    const response = await fetch(this.endpoint, { method: "POST", headers: { "content-type": "application/json", ...(this.config.api_key ? { authorization: `Bearer ${this.config.api_key}` } : {}) }, body: JSON.stringify({ model: this.config.model, input }) });
    if (!response.ok) throw new Error(`Classifier request failed with HTTP ${response.status}`);
    const payload = await response.json() as Record<string, unknown>;
    const candidate = payload.state ? payload : extractOpenAiContent(payload);
    if (!candidate || typeof candidate.state !== "string" || !isTurnState(candidate.state)) throw new Error("Classifier returned an invalid state");
    const confidence = typeof candidate.confidence === "number" ? Math.max(0, Math.min(1, candidate.confidence)) : 0;
    return { state: candidate.state, confidence, reason: typeof candidate.reason === "string" ? candidate.reason : undefined };
  }
}

function extractOpenAiContent(payload: Record<string, unknown>): Record<string, unknown> | undefined {
  const choices = payload.choices;
  if (!Array.isArray(choices)) return undefined;
  const content = (choices[0] as { message?: { content?: unknown } } | undefined)?.message?.content;
  if (typeof content !== "string") return undefined;
  try { return JSON.parse(content) as Record<string, unknown>; } catch { return undefined; }
}

function isTurnState(value: string): value is TurnState {
  return ["DONE", "CONTINUE", "VERIFY_DONE", "NEXT_TODO", "NEEDS_DECISION", "NEEDS_USER"].includes(value);
}

export function createClassifier(config: ClassifierConfig): TurnClassifier {
  const rules = new RulesClassifier();
  const heuristic = new HeuristicClassifier();
  if (config.provider === "rules") return rules;
  if (config.provider === "hybrid") return config.endpoint ? new HybridClassifier(rules, new HttpClassifier(config.endpoint, config)) : new HybridClassifier(rules, heuristic, config.auto_act_confidence ?? 0.8);
  if (!config.endpoint) throw new Error(`Classifier provider ${config.provider} requires an endpoint`);
  return new HttpClassifier(config.endpoint, config);
}
