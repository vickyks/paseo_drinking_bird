import test from "node:test";
import assert from "node:assert/strict";
import { ContinuationController, detectTurnKind, isControllerPrompt, prompts } from "../shared/controller.js";
import { buildDeciderPayload, DECIDER_SYSTEM_PROMPT, decodeDeciderDecision } from "../shared/decider-prompt.js";
import { controllerTimelineSchema } from "../shared/timeline.js";
import { buildTurnClassificationInput } from "../server/turn-input.js";
import { HeuristicClassifier, RulesClassifier, createClassifier, type TurnClassifier } from "../shared/classifier.js";

const runtime = { snapshot: { todos: "", files: "a.ts", tests: "pass", commit: "", mr: "false", blocker: "", action: "" }, continueAgent: async (_prompt: string) => {} };
test("requires verification when an MR is required but missing", async () => { const result = await new ContinuationController(new RulesClassifier()).evaluate({ task: { original_request: "ship it" }, recent_activity: [], last_agent_message: "done", runtime: { mr_required: true, mr_created: false } }, runtime); assert.equal(result.state, "VERIFY_DONE"); });
test("continues an existing todo plan", async () => { const result = await new ContinuationController(new RulesClassifier()).evaluate({ task: { original_request: "build it" }, plan: { items: [{ id: "1", text: "UI", status: "pending" }] }, recent_activity: [], last_agent_message: "progress" }, runtime); assert.equal(result.state, "NEXT_TODO"); });
test("stops when all plan items are done", async () => { const result = await new ContinuationController(new RulesClassifier()).evaluate({ task: { original_request: "build it" }, plan: { items: [{ id: "1", text: "UI", status: "done" }] }, recent_activity: [], last_agent_message: "done" }, runtime); assert.equal(result.state, "DONE"); });
test("verifies completion claims without evidence", async () => { const result = await new ContinuationController(new RulesClassifier()).evaluate({ task: { original_request: "build it" }, recent_activity: [], last_agent_message: "done" }, runtime); assert.equal(result.state, "VERIFY_DONE"); assert.match(result.prompt ?? "", /Verify that the task is actually complete/); });
test("accepts completion claims with passing test evidence", async () => { const result = await new ContinuationController(new RulesClassifier()).evaluate({ task: { original_request: "build it" }, recent_activity: [], last_agent_message: "done", runtime: { tests_run: true, tests_passed: true } }, runtime); assert.equal(result.state, "DONE"); });
test("heuristic classification recognizes a supported completion", async () => { const result = await new HeuristicClassifier().classify({ task: { original_request: "build it" }, recent_activity: [], last_agent_message: "Implemented and done", runtime: { tests_run: true, tests_passed: true } }); assert.equal(result.state, "DONE"); });
test("rules provider can be selected without orchestration changes", async () => { const classifier = createClassifier({ provider: "rules" }); const result = await classifier.classify({ task: { original_request: "build it" }, plan: { items: [{ id: "1", text: "UI", status: "done" }] }, recent_activity: [], last_agent_message: "done" }); assert.equal(result.state, "DONE"); });
test("supervised mode returns a proposed prompt without sending it", async () => { let sends = 0; const result = await new ContinuationController({ classify: async () => ({ state: "CONTINUE", confidence: 0.95, reason: "unfinished" }) }).evaluate({ task: { original_request: "continue" }, recent_activity: [], last_agent_message: "progress" }, { ...runtime, autoAct: false, continueAgent: async () => { sends++; } }); assert.equal(result.state, "CONTINUE"); assert.match(result.prompt ?? "", /Continue the current task/); assert.equal(sends, 0); });
test("low-confidence continuation does not send an automatic prompt", async () => { let sends = 0; const result = await new ContinuationController({ classify: async () => ({ state: "CONTINUE", confidence: 0.58, reason: "uncertain" }) }).evaluate({ task: { original_request: "unknown" }, recent_activity: [], last_agent_message: "" }, { ...runtime, continueAgent: async () => { sends++; } }); assert.equal(result.state, "NEEDS_USER"); assert.match(result.prompt ?? "", /what decisions or actions you need me to take/); assert.equal(sends, 0); });
test("turn snapshots do not carry failures forward from earlier turns", () => { const input = buildTurnClassificationInput({ id: "agent", workspaceId: null, parentAgentId: null, provider: "pi", cwd: "/tmp", title: "task" }, [
  { type: "user_message", text: "first" },
  { type: "tool_call", callId: "1", name: "shell", status: "failed", error: "bad", detail: { type: "shell", command: "npm test", exitCode: 1 } },
  { type: "user_message", text: "second" },
  { type: "tool_call", callId: "2", name: "shell", status: "completed", error: null, detail: { type: "shell", command: "npm test", exitCode: 0 } },
  { type: "assistant_message", text: "Done" },
], { kind: "completed" }); assert.deepEqual(input.runtime?.unresolved_errors, []); assert.equal(input.runtime?.tests_passed, true); });

test("the last user message is the driving message, the first is the original request", () => { const input = buildTurnClassificationInput({ id: "agent", workspaceId: null, parentAgentId: null, provider: "pi", cwd: "/tmp", title: "task" }, [
  { type: "user_message", text: "build the exporter" },
  { type: "assistant_message", text: "working" },
  { type: "user_message", text: "why is the exporter slow?" },
  { type: "assistant_message", text: "it buffers" },
], { kind: "completed" }); assert.equal(input.task.original_request, "build the exporter"); assert.equal(input.last_user_message, "why is the exporter slow?"); });

test("a question turn waits for the user instead of continuing", async () => {
  let sends = 0;
  const result = await new ContinuationController({ classify: async () => ({ state: "CONTINUE", confidence: 0.95, reason: "looks unfinished" }) }).evaluate(
    { task: { original_request: "fix the bug" }, recent_activity: [], last_agent_message: "It re-derives the cache key on every call.", last_user_message: "why does the exporter re-derive the cache key" },
    { ...runtime, continueAgent: async () => { sends++; } },
  );
  assert.equal(result.state, "WAIT_FOR_USER");
  assert.equal(result.prompt, undefined);
  assert.equal(sends, 0);
});

test("an interrupt turn never auto-continues, even at full confidence", async () => {
  let sends = 0;
  const result = await new ContinuationController({ classify: async () => ({ state: "CONTINUE", confidence: 0.99, reason: "unfinished" }) }).evaluate(
    { task: { original_request: "ship it" }, recent_activity: [], last_agent_message: "Kept the changes in place without committing.", last_user_message: "don't commit them for now, just keep them around" },
    { ...runtime, continueAgent: async () => { sends++; } },
  );
  assert.equal(result.state, "WAIT_FOR_USER");
  assert.equal(sends, 0);
});

test("a turn driven by a controller prompt routes through the task state normally", async () => {
  let sent = "";
  const controller = new ContinuationController({ classify: async () => ({ state: "CONTINUE", confidence: 0.95, reason: "unfinished" }) });
  const result = await controller.evaluate(
    { task: { original_request: "ship it" }, recent_activity: [], last_agent_message: "Made the first batch of changes; two to-dos remain.", last_user_message: prompts.CONTINUE },
    { ...runtime, continueAgent: async (prompt) => { sent = prompt; } },
  );
  assert.equal(result.state, "CONTINUE");
  assert.ok(sent.startsWith(prompts.CONTINUE));
  assert.match(sent, /automatic continuation turn 1 of up to 12/);
});

test("retry-with-evidence human turns are legitimized as continuations", async () => {
  let sends = 0;
  const result = await new ContinuationController({ classify: async () => ({ state: "CONTINUE", confidence: 0.95, reason: "new evidence supplied" }) }).evaluate(
    { task: { original_request: "make the request work" }, recent_activity: [], last_agent_message: "Retrying the request now.", last_user_message: "still failing: http://localhost:4200/v2/runs/x — try again" },
    { ...runtime, continueAgent: async () => { sends++; } },
  );
  assert.equal(result.state, "CONTINUE");
  assert.equal(sends, 1);
});

const oscillatingStagnationClassifier = (): TurnClassifier => {
  const calls = { count: 0 };
  return { classify: async () => ({ state: calls.count++ % 2 === 0 ? "CONTINUE" as const : "NEXT_TODO" as const, confidence: 0.95, reason: "unchanged" }) };
};

test("stagnation gets one recenter before escalation", async () => {
  let sends = 0;
  const controller = new ContinuationController(oscillatingStagnationClassifier(), { max_recenters: 1 });
  const input = { task: { original_request: "loop forever" }, recent_activity: [], last_agent_message: "nothing changed", last_user_message: prompts.CONTINUE };
  const states: string[] = [];
  for (let index = 0; index < 8; index++) {
    const result = await controller.evaluate(input, { ...runtime, continueAgent: async () => { sends++; } });
    states.push(result.state);
  }
  const timeline = states.join(" -> ");
  assert.ok(states.includes("RECENTER"), `expected a recenter, got ${timeline}`);
  assert.equal(states.filter((state) => state === "RECENTER").length, 1);
  assert.equal(states[states.length - 1], "NEEDS_USER", `recurred stagnation must escalate, got ${timeline}`);
  assert.equal(sends, 6); // sent: C, N, C, RECENTER, C, N — then two escalations without sends
});

test("recenter is approval-worthy in supervised mode without sending", async () => {
  let sends = 0;
  const controller = new ContinuationController(oscillatingStagnationClassifier());
  const input = { task: { original_request: "loop forever" }, recent_activity: [], last_agent_message: "nothing changed", last_user_message: prompts.CONTINUE };
  const states: string[] = [];
  for (let index = 0; index < 8; index++) {
    const result = await controller.evaluate(input, { ...runtime, autoAct: false, continueAgent: async () => { sends++; } });
    states.push(result.state);
  }
  const timeline = states.join(" -> ");
  assert.equal(states.filter((state) => state === "RECENTER").length, 1, `expected exactly one proposed recenter, got ${timeline}`);
  assert.equal(states[states.length - 1], "NEEDS_USER", timeline);
  assert.equal(sends, 0); // supervised mode proposes, never sends
});

test("controller prompts are recognised and turn kinds classify correctly", () => {
  assert.equal(isControllerPrompt(prompts.CONTINUE), "CONTINUE");
  assert.equal(detectTurnKind(prompts.CONTINUE), "controller_turn");
  assert.equal(detectTurnKind("still failing: http://x — try again"), "task_turn");
  assert.equal(detectTurnKind("why did the test fail?"), "question_turn");
  assert.equal(detectTurnKind("wait, where did you get that customer name?"), "interrupt_turn");
  assert.equal(detectTurnKind("make the export button primary"), "task_turn");
});

test("the decider payload carries the calibration rules and the turn facts", () => {
  const payload = buildDeciderPayload({ task: { original_request: "ship it" }, recent_activity: [], last_agent_message: "done", last_user_message: prompts.CONTINUE });
  assert.match(payload.system, /complete_evidenced/);
  assert.match(payload.system, /question_turn/);
  assert.match(payload.system, /confidence < 0.8 REQUIRES auto_executable false/);
  assert.equal(payload.input.last_user_message, prompts.CONTINUE);
});

test("a nested JEV decision decodes into a controller classification", () => {
  const decision = decodeDeciderDecision({
    assessment: { turn_kind: "question_turn", task_state: "complete_evidenced", evidence: [{ type: "tests", summary: "npm test passed" }], reason: "Answered a question with passing tests." },
    action: { decision: "WAIT_FOR_USER", confidence: 0.92, auto_executable: true },
  });
  assert.ok(decision);
  assert.equal(decision.classification.state, "WAIT_FOR_USER");
  assert.equal(decision.classification.turn_kind, "question_turn");
  assert.equal(decision.classification.task_state, "complete_evidenced");
  assert.equal(decision.decision.assessment.evidence.length, 1);
});

test("a flat JEV decision still decodes", () => {
  const decision = decodeDeciderDecision({ state: "CONTINUE", confidence: 0.9, reason: "unfinished work", turn_kind: "task_turn", task_state: "in_progress" });
  assert.ok(decision);
  assert.equal(decision.classification.state, "CONTINUE");
  assert.equal(decision.classification.turn_kind, "task_turn");
});

test("invalid JEV decisions are rejected", () => {
  assert.equal(decodeDeciderDecision({ state: "SPIN" }), undefined);
  assert.equal(decodeDeciderDecision({ assessment: { turn_kind: "bogus" }, action: { decision: "CONTINUE", confidence: 1 } }), undefined);
  assert.equal(decodeDeciderDecision({}), undefined);
});

test("the timeline schema accepts the new controller states", () => {
  const parse = (state: string) => controllerTimelineSchema.safeParse({ state, confidence: 0.9, reason: "r", turnId: null, action_status: "automatic" });
  for (const state of ["RECENTER", "WAIT_FOR_USER", "DONE", "CONTINUE"]) assert.ok(parse(state).success);
  assert.ok(!parse("SPIN").success);
});
