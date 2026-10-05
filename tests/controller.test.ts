import test from "node:test";
import assert from "node:assert/strict";
import { ContinuationController } from "../shared/controller.js";
import { buildTurnClassificationInput } from "../server/turn-input.js";
import { HeuristicClassifier, RulesClassifier, createClassifier } from "../shared/classifier.js";

const runtime = { snapshot: { todos: "", files: "a.ts", tests: "pass", commit: "", mr: "false", blocker: "", action: "" }, continueAgent: async (_prompt: string) => {} };
test("requires verification when an MR is required but missing", async () => { const result = await new ContinuationController(new RulesClassifier()).evaluate({ task: { original_request: "ship it" }, recent_activity: [], last_agent_message: "done", runtime: { mr_required: true, mr_created: false } }, runtime); assert.equal(result.state, "VERIFY_DONE"); });
test("continues an existing todo plan", async () => { const result = await new ContinuationController(new RulesClassifier()).evaluate({ task: { original_request: "build it" }, plan: { items: [{ id: "1", text: "UI", status: "pending" }] }, recent_activity: [], last_agent_message: "progress" }, runtime); assert.equal(result.state, "NEXT_TODO"); });
test("stops when all plan items are done", async () => { const result = await new ContinuationController(new RulesClassifier()).evaluate({ task: { original_request: "build it" }, plan: { items: [{ id: "1", text: "UI", status: "done" }] }, recent_activity: [], last_agent_message: "done" }, runtime); assert.equal(result.state, "DONE"); });
test("does not trust prose without completion evidence", async () => { const result = await new ContinuationController(new RulesClassifier()).evaluate({ task: { original_request: "build it" }, recent_activity: [], last_agent_message: "done" }, runtime); assert.equal(result.state, "CONTINUE"); });
test("heuristic classification recognizes a supported completion", async () => { const result = await new HeuristicClassifier().classify({ task: { original_request: "build it" }, recent_activity: [], last_agent_message: "Implemented and done", runtime: { tests_run: true, tests_passed: true } }); assert.equal(result.state, "DONE"); });
test("rules provider can be selected without orchestration changes", async () => { const classifier = createClassifier({ provider: "rules" }); const result = await classifier.classify({ task: { original_request: "build it" }, plan: { items: [{ id: "1", text: "UI", status: "done" }] }, recent_activity: [], last_agent_message: "done" }); assert.equal(result.state, "DONE"); });
test("turn snapshots do not carry failures forward from earlier turns", () => { const input = buildTurnClassificationInput({ id: "agent", workspaceId: null, parentAgentId: null, provider: "pi", cwd: "/tmp", title: "task" }, [
  { type: "user_message", text: "first" },
  { type: "tool_call", callId: "1", name: "shell", status: "failed", error: "bad", detail: { type: "shell", command: "npm test", exitCode: 1 } },
  { type: "user_message", text: "second" },
  { type: "tool_call", callId: "2", name: "shell", status: "completed", error: null, detail: { type: "shell", command: "npm test", exitCode: 0 } },
  { type: "assistant_message", text: "Done" },
], { kind: "completed" }); assert.deepEqual(input.runtime?.unresolved_errors, []); assert.equal(input.runtime?.tests_passed, true); });
