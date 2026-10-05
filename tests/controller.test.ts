import test from "node:test";
import assert from "node:assert/strict";
import { ContinuationController } from "../shared/controller.js";
import { RulesClassifier } from "../shared/classifier.js";

const runtime = { snapshot: { todos: "", files: "a.ts", tests: "pass", commit: "", mr: "false", blocker: "", action: "" }, continueAgent: async (_prompt: string) => {} };
test("requires verification when an MR is required but missing", async () => { const result = await new ContinuationController(new RulesClassifier()).evaluate({ task: { original_request: "ship it" }, recent_activity: [], last_agent_message: "done", runtime: { mr_required: true, mr_created: false } }, runtime); assert.equal(result.state, "VERIFY_DONE"); });
test("continues an existing todo plan", async () => { const result = await new ContinuationController(new RulesClassifier()).evaluate({ task: { original_request: "build it" }, plan: { items: [{ id: "1", text: "UI", status: "pending" }] }, recent_activity: [], last_agent_message: "progress" }, runtime); assert.equal(result.state, "NEXT_TODO"); });
test("stops when all plan items are done", async () => { const result = await new ContinuationController(new RulesClassifier()).evaluate({ task: { original_request: "build it" }, plan: { items: [{ id: "1", text: "UI", status: "done" }] }, recent_activity: [], last_agent_message: "done" }, runtime); assert.equal(result.state, "DONE"); });
test("does not trust prose without completion evidence", async () => { const result = await new ContinuationController(new RulesClassifier()).evaluate({ task: { original_request: "build it" }, recent_activity: [], last_agent_message: "done" }, runtime); assert.equal(result.state, "CONTINUE"); });
