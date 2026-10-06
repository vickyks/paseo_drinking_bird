import type { TurnClassifier } from "./classifier.js";
import { LoopGuard, type LoopGuardState, type GuardTrip, type ProgressSnapshot } from "./safety.js";
import type { ControllerAction, ControllerConfig, TurnClassificationInput, TurnKind, TurnState } from "./types.js";

export interface ControllerEvent { type: "STATE_EVALUATED" | "AUTO_CONTINUE_REQUESTED" | "CONTINUATION_PROPOSED" | "VERIFY_REQUESTED" | "NEXT_TODO_REQUESTED" | "USER_INPUT_REQUIRED" | "DECISION_REQUIRED" | "TASK_COMPLETED" | "LOOP_GUARD_TRIPPED" | "WAITING_FOR_USER"; state?: TurnState; confidence?: number; reason?: string; }
export type EventSink = (event: ControllerEvent) => void;

export const prompts = {
  CONTINUE: "Continue the current task. Do not stop merely to report progress. Complete the current work unless genuinely blocked.",
  VERIFY_DONE: "Verify that the task is actually complete. Check the requirements, tests, repository state, remaining todos, and required deliverables. Finish anything missing before stopping.",
  NEXT_TODO: "Continue with the next appropriate unresolved item from the existing plan. Preserve the current task context and ordering constraints. One item per turn.",
  NEEDS_USER: "Tell me what decisions or actions you need me to take. State the relevant facts and options, then stop and wait for my response.",
  RECENTER: "Step back and regain focus.\n\nState the problem.\nState the known facts.\nCreate an investigation plan.\nList the steps you intend to follow.\nTell me what you believe is happening and why.\nExecute the plan.\nUpdate me on each stage."
} as const;

export type ControllerPromptId = keyof typeof prompts;

const CONTINUABLE_TURN_KINDS: ReadonlySet<TurnKind> = new Set(["controller_turn", "task_turn"]);

const retryEvidencePattern = /\b(still (?:failing|broken|not working|erroring|crashing)|try again|retry|re-?run that|run it again|here(?:'s| is) (?:the|a) (?:output|log|trace|error)|you (?:can|should) (?:see|access))\b|```|^Traceback[: ]|^Error[: ]|exit code/im;
const interrogativePattern = /^(?:why|what|how|where|when|who|which|are you|do you|did you|have you|is there|can you|could you|tell me|show me|give me)\b|^\s*[-0-9]*(?:\s|[a-z(])*\?\s*$/im;
const interruptPattern = /(?:^|\s)(?:stop|wait|hold (?:on|off)|hang on|don't|dont|do not|nope|no[,.\s]|actually[,.\s]|cancel that|pause)\b/i;

const CONTINUE_TURN_PREFIX = prompts.CONTINUE;
export function isControllerPrompt(message: string): string | undefined {
  const text = message.trim();
  if (!text) return undefined;
  if (text.startsWith(CONTINUE_TURN_PREFIX)) return "CONTINUE";
  for (const [id, prompt] of Object.entries(prompts)) {
    if (id !== "CONTINUE" && text.startsWith(prompt)) return id;
  }
  return undefined;
}

export function detectTurnKind(lastUserMessage: string | undefined): TurnKind {
  const message = (lastUserMessage ?? "").trim();
  if (!message) return "task_turn";
  if (isControllerPrompt(message)) return "controller_turn";
  if (retryEvidencePattern.test(message)) return "task_turn";
  if (interrogativePattern.test(message)) return "question_turn";
  if (interruptPattern.test(message)) return "interrupt_turn";
  return "task_turn";
}

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

export class ContinuationController {
  private readonly guard: LoopGuard;
  private readonly autoActConfidence: number;
  private readonly limits: ControllerConfig;
  constructor(private readonly classifier: TurnClassifier, config: Partial<ControllerConfig> = {}, private readonly emit: EventSink = () => {}, initialGuardState?: LoopGuardState) {
    this.autoActConfidence = config.auto_act_confidence ?? 0.8;
    this.limits = { max_auto_turns: 12, max_repeated_state: 3, max_identical_blocker_repeats: 2, max_recenters: 1, auto_act_confidence: 0.8, escalate_below: 0.55, ...config };
    this.guard = new LoopGuard(this.limits, initialGuardState);
  }

  guardState(): LoopGuardState {
    return this.guard.snapshot();
  }

  private recenterAction(reason: string): ControllerAction {
    this.guard.markRecenter();
    return { state: "RECENTER", confidence: 0.85, reason, prompt: prompts.RECENTER };
  }

  async evaluate(input: TurnClassificationInput, runtime: ControllerRuntime): Promise<ControllerAction> {
    let classification = await this.classifier.classify(input);
    const turnKind = detectTurnKind(input.last_user_message);
    const continuable = CONTINUABLE_TURN_KINDS.has(turnKind);

    // Question and interrupt turns belong to the user, not the loop: answer, then wait.
    if (!continuable) {
      if (classification.state === "DONE" && hasCompletionEvidence(input)) {
        this.emit({ type: "TASK_COMPLETED", state: "DONE", confidence: classification.confidence, reason: classification.reason });
        return { ...classification, reason: classification.reason ?? "Task complete" };
      }
      const reason = turnKind === "question_turn"
        ? "The agent replied to a user question; no automatic continuation until the user responds."
        : "The user interrupted or set a new constraint; no automatic continuation until the user responds.";
      this.emit({ type: "WAITING_FOR_USER", state: "WAIT_FOR_USER", confidence: classification.confidence, reason });
      return { state: "WAIT_FOR_USER", confidence: classification.confidence, reason };
    }

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
    const trip: GuardTrip | undefined = classification.state === "DONE" || classification.state === "NEEDS_USER" ? undefined : this.guard.record(classification, runtime.snapshot);
    if (trip) {
      this.emit({ type: "LOOP_GUARD_TRIPPED", reason: trip.reason });
      if (trip.stagnation && this.guard.snapshot().recenterAttempts < this.limits.max_recenters) {
        const recenter = this.recenterAction(`${trip.reason}; a recenter is attempted before escalation`);
        if (runtime.autoAct !== false) await runtime.continueAgent(prompts.RECENTER);
        return recenter;
      }
      return { state: "NEEDS_USER", confidence: 1, reason: trip.reason, prompt: prompts.NEEDS_USER };
    }

    // A decider (JEV) may flag stagnation structurally even before the guard fingerprint does.
    if (classification.task_state === "stagnating" && this.guard.snapshot().recenterAttempts < this.limits.max_recenters) {
      const recenter = this.recenterAction("The decider assessed the turn as stagnating");
      if (runtime.autoAct !== false) await runtime.continueAgent(prompts.RECENTER);
      return recenter;
    }

    if (classification.state === "DONE") { this.emit({ type: "TASK_COMPLETED", state: "DONE", confidence: classification.confidence, reason: classification.reason }); return { ...classification, reason: classification.reason ?? "Task complete" }; }
    if (classification.state === "NEEDS_USER" || classification.state === "NEEDS_DECISION") {
      this.emit({ type: classification.state === "NEEDS_USER" ? "USER_INPUT_REQUIRED" : "DECISION_REQUIRED", state: classification.state, confidence: classification.confidence, reason: classification.reason });
      return classification.state === "NEEDS_USER"
        ? { ...classification, prompt: prompts.NEEDS_USER, reason: classification.reason ?? "Controller requires user input" }
        : { ...classification, reason: classification.reason ?? `Controller requires ${classification.state}` };
    }

    let prompt: string = prompts[classification.state as ControllerPromptId];
    if (classification.state === "CONTINUE") {
      prompt = `${prompt}\n\nYou are on automatic continuation turn ${this.guard.turnsUsed()} of up to ${this.limits.max_auto_turns}. If you are genuinely blocked, end with one line: BLOCKED: <what you need>. When finished, end with one line: DONE.`;
    }
    this.emit({ type: runtime.autoAct === false ? "CONTINUATION_PROPOSED" : classification.state === "CONTINUE" ? "AUTO_CONTINUE_REQUESTED" : classification.state === "VERIFY_DONE" ? "VERIFY_REQUESTED" : "NEXT_TODO_REQUESTED", state: classification.state, confidence: classification.confidence, reason: classification.reason });
    if (runtime.autoAct !== false) await runtime.continueAgent(prompt);
    return { ...classification, prompt, reason: classification.reason ?? `Requested ${classification.state}` };
  }
}