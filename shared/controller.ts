import type { TurnClassifier } from "./classifier.js";
import { LoopGuard, type LoopGuardState, type ProgressSnapshot } from "./safety.js";
import type { ControllerAction, ControllerConfig, TurnClassificationInput, TurnState } from "./types.js";

export interface ControllerEvent { type: "STATE_EVALUATED" | "AUTO_CONTINUE_REQUESTED" | "CONTINUATION_PROPOSED" | "VERIFY_REQUESTED" | "NEXT_TODO_REQUESTED" | "USER_INPUT_REQUIRED" | "DECISION_REQUIRED" | "TASK_COMPLETED" | "LOOP_GUARD_TRIPPED"; state?: TurnState; confidence?: number; reason?: string; }
export type EventSink = (event: ControllerEvent) => void;

function hasCompletionEvidence(input: TurnClassificationInput): boolean {
  const remaining = input.plan?.items.filter((item) => item.status !== "done") ?? [];
  return (input.plan !== undefined && remaining.length === 0 && input.runtime?.tests_passed !== false)
    || input.runtime?.tests_passed === true;
}

function claimsCompletion(message: string): boolean {
  if (/\b(?:not|isn't|is not|unfinished|incomplete|still need|remaining)\b[\s\S]{0,30}\b(?:done|complete|completed|finished|implemented)\b/i.test(message)) return false;
  return /\b(?:done|complete|completed|finished|implemented|all set)\b/i.test(message);
}

export interface ControllerRuntime { snapshot: ProgressSnapshot; continueAgent(prompt: string): Promise<void>; autoAct?: boolean; }

export const prompts = {
  CONTINUE: "Continue the current task. Do not stop merely to report progress. Complete the current work unless genuinely blocked.",
  VERIFY_DONE: "Verify that the task is actually complete. Check the requirements, tests, repository state, remaining todos, and required deliverables. Finish anything missing before stopping.",
  NEXT_TODO: "Continue with the next appropriate unresolved item from the existing plan. Preserve the current task context and ordering constraints.",
  NEEDS_USER: "Tell me what decisions or actions you need me to take. State the relevant facts and options, then stop and wait for my response."
} as const;

export class ContinuationController {
  private readonly guard: LoopGuard;
  private readonly autoActConfidence: number;
  constructor(private readonly classifier: TurnClassifier, config: Partial<ControllerConfig> = {}, private readonly emit: EventSink = () => {}, initialGuardState?: LoopGuardState) {
    this.autoActConfidence = config.auto_act_confidence ?? 0.8;
    this.guard = new LoopGuard({ max_auto_turns: 12, max_repeated_state: 3, max_identical_blocker_repeats: 2, auto_act_confidence: 0.8, escalate_below: 0.55, ...config }, initialGuardState);
  }

  guardState(): LoopGuardState {
    return this.guard.snapshot();
  }

  async evaluate(input: TurnClassificationInput, runtime: ControllerRuntime): Promise<ControllerAction> {
    let classification = await this.classifier.classify(input);
    if ((classification.state === "DONE" || classification.state === "CONTINUE") && claimsCompletion(input.last_agent_message) && !hasCompletionEvidence(input)) {
      classification = { state: "VERIFY_DONE", confidence: Math.max(classification.confidence, 0.8), reason: "Completion was claimed without sufficient runtime evidence; verification is required" };
    }
    this.emit({ type: "STATE_EVALUATED", state: classification.state, confidence: classification.confidence, reason: classification.reason });
    const automaticState = classification.state === "CONTINUE" || classification.state === "VERIFY_DONE" || classification.state === "NEXT_TODO" || classification.state === "NEEDS_DECISION";
    if (automaticState && classification.confidence < this.autoActConfidence) {
      const reason = `Low-confidence classification (${classification.confidence.toFixed(2)}); automatic action requires ${this.autoActConfidence.toFixed(2)}`;
      this.emit({ type: "USER_INPUT_REQUIRED", state: "NEEDS_USER", confidence: classification.confidence, reason });
      return { state: "NEEDS_USER", confidence: classification.confidence, reason, prompt: prompts.NEEDS_USER };
    }
    const guardReason = classification.state === "DONE" || classification.state === "NEEDS_USER" ? undefined : this.guard.record(classification, runtime.snapshot);
    if (guardReason) {
      this.emit({ type: "LOOP_GUARD_TRIPPED", reason: guardReason });
      return { state: "NEEDS_USER", confidence: 1, reason: guardReason, prompt: prompts.NEEDS_USER };
    }
    if (classification.state === "DONE") { this.emit({ type: "TASK_COMPLETED", state: "DONE", confidence: classification.confidence, reason: classification.reason }); return { ...classification, reason: classification.reason ?? "Task complete" }; }
    if (classification.state === "NEEDS_USER" || classification.state === "NEEDS_DECISION") {
      this.emit({ type: classification.state === "NEEDS_USER" ? "USER_INPUT_REQUIRED" : "DECISION_REQUIRED", state: classification.state, confidence: classification.confidence, reason: classification.reason });
      return classification.state === "NEEDS_USER"
        ? { ...classification, prompt: prompts.NEEDS_USER, reason: classification.reason ?? "Controller requires user input" }
        : { ...classification, reason: classification.reason ?? `Controller requires ${classification.state}` };
    }
    const prompt = prompts[classification.state];
    this.emit({ type: runtime.autoAct === false ? "CONTINUATION_PROPOSED" : classification.state === "CONTINUE" ? "AUTO_CONTINUE_REQUESTED" : classification.state === "VERIFY_DONE" ? "VERIFY_REQUESTED" : "NEXT_TODO_REQUESTED", state: classification.state, confidence: classification.confidence, reason: classification.reason });
    if (runtime.autoAct !== false) await runtime.continueAgent(prompt);
    return { ...classification, prompt, reason: classification.reason ?? `Requested ${classification.state}` };
  }
}
