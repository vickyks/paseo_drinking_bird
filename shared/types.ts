export type TurnState =
  | "DONE"
  | "CONTINUE"
  | "VERIFY_DONE"
  | "NEXT_TODO"
  | "NEEDS_DECISION"
  | "NEEDS_USER"
  | "RECENTER"
  | "WAIT_FOR_USER";

export type TodoStatus = "pending" | "in_progress" | "done" | "blocked";

/**
 * What drove the agent turn being evaluated:
 * - controller_turn: the turn was triggered by a Drinking Bird prompt.
 * - task_turn: a human message that directs work or supplies new evidence; normal task-state routing applies.
 * - question_turn: a human interrogation or information pull; the agent answers, then waits.
 * - interrupt_turn: a human stop/wait/correction; the controller never auto-continues over it.
 */
export type TurnKind = "controller_turn" | "task_turn" | "question_turn" | "interrupt_turn";

/**
 * Where JEV believes the task actually is. Kept separate from the action so
 * evidence-free completion claims can be routed through VERIFY_DONE explicitly.
 */
export type TaskState =
  | "in_progress"
  | "complete_unverified"
  | "complete_evidenced"
  | "blocked_user"
  | "blocked_agent_decision"
  | "stagnating";

export interface Evidence {
  type: string;
  summary: string;
}

export interface TurnClassificationInput {
  task: { original_request: string; goal?: string; success_criteria?: string[] };
  plan?: { items: Array<{ id: string; text: string; status: TodoStatus }> };
  recent_activity: Array<{ type: string; summary: string; success?: boolean }>;
  last_agent_message: string;
  last_user_message?: string;
  runtime?: {
    files_modified?: string[];
    tests_run?: boolean;
    tests_passed?: boolean;
    working_tree_clean?: boolean;
    branch?: string;
    commit_created?: boolean;
    mr_required?: boolean;
    mr_created?: boolean;
    unresolved_errors?: string[];
  };
  explicit_blocker?: string;
}

export interface TurnClassification {
  state: TurnState;
  confidence: number;
  reason?: string;
  turn_kind?: TurnKind;
  task_state?: TaskState;
  evidence?: Evidence[];
}

/** Canonical JEV decision contract: assessment first, action second. */
export interface DeciderAssessment {
  turn_kind: TurnKind;
  task_state: TaskState;
  evidence: Evidence[];
  reason: string;
}

export interface DeciderAction {
  decision: TurnState;
  confidence: number;
  auto_executable: boolean;
}

export interface DeciderDecision {
  assessment: DeciderAssessment;
  action: DeciderAction;
}

export interface DecisionRequest {
  task_summary: string;
  decision_required: string;
  options?: Array<{ id: string; description: string }>;
  constraints?: string[];
  implementation_context?: string;
  agent_recommendation?: { option?: string; rationale: string };
  evidence?: Evidence[];
}

export type DecisionResponse =
  | { status: "DECIDED"; decision: string; rationale: string; implementation_constraints?: string[]; risks?: string[]; rejected_options?: Array<{ option: string; reason: string }>; confidence: number }
  | { status: "NEED_MORE_CONTEXT"; required_information: string[] };

export type ClassifierProvider = "rules" | "hybrid" | "jev" | "openai" | "local";

export interface ClassifierConfig {
  provider: ClassifierProvider;
  endpoint?: string;
  model?: string;
  api_key?: string;
  deterministic_first?: boolean;
  auto_act_confidence?: number;
  escalate_below?: number;
  decider_prompt?: string;
}

export interface ControllerConfig {
  max_auto_turns: number;
  max_repeated_state: number;
  max_identical_blocker_repeats: number;
  max_recenters: number;
  auto_act_confidence: number;
  escalate_below: number;
}

export interface ControllerAction {
  state: TurnState;
  prompt?: string;
  reason: string;
  confidence: number;
}