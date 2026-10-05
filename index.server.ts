import type { PluginServerContext } from "@getpaseo/plugin/server";
import { ContinuationController } from "./shared/controller.js";
import { createClassifier } from "./shared/classifier.js";
import { buildTurnClassificationInput } from "./server/turn-input.js";
import { latestOutputText } from "./server/inspect.js";
import { StateStore } from "./server/state-store.js";
import { loadConfig } from "./server/config.js";
import { controllerTimelineKind, controllerTimelineVersion } from "./shared/timeline.js";
import { contextPrompt, decisionPrompt } from "./shared/reviewer.js";
import { requestTechnicalReview } from "./server/decision-router.js";
import { runPlaywrightDemo } from "./server/playwright-demo.js";
import { prompts } from "./shared/controller.js";

const controllers = new Map<string, ContinuationController>();
const queues = new Map<string, Promise<void>>();
const reviewerContextRounds = new Map<string, number>();

export default function contribute(server: PluginServerContext) {
  const stateStore = new StateStore();
  const configPromise = loadConfig();

  server.on("agent.turn_ended", async (event, { paseo, signal }) => {
    const previous = queues.get(event.agent.id) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(async () => {
      if (signal.aborted || event.outcome.kind === "canceled") return;

      const input = buildTurnClassificationInput(event.agent, event.timeline, event.outcome);
      const config = await configPromise;
      let controller = controllers.get(event.agent.id);
      if (!controller) {
        const persisted = await stateStore.get(event.agent.id);
        controller = new ContinuationController(createClassifier(config.classifier), config.limits, (decision) => {
          console.error(JSON.stringify({ event: decision.type, agentId: event.agent.id, ...decision }));
        }, persisted?.guard);
        reviewerContextRounds.set(event.agent.id, persisted?.reviewerContextRounds ?? 0);
        controllers.set(event.agent.id, controller);
      }

      const agent = paseo.agents.ref(event.agent.id);
      const action = await controller.evaluate(input, {
        snapshot: {
          todos: JSON.stringify(input.plan?.items ?? []),
          files: JSON.stringify(input.runtime?.files_modified ?? []),
          tests: `${input.runtime?.tests_run ?? false}:${input.runtime?.tests_passed ?? "unknown"}`,
          commit: "unknown",
          mr: "unknown",
          blocker: input.explicit_blocker ?? "",
          action: input.last_agent_message,
        },
        continueAgent: async (prompt) => {
          if (signal.aborted) return;
          await agent.send(prompt);
        },
      });

      await agent.timeline.append({
        type: "plugin",
        id: `turn-${event.turnId ?? Date.now()}`,
        kind: controllerTimelineKind,
        version: controllerTimelineVersion,
        data: { state: action.state, confidence: action.confidence, reason: action.reason, turnId: event.turnId },
      });

      console.error(JSON.stringify({
        event: "STATE_EVALUATED",
        agentId: event.agent.id,
        turnId: event.turnId,
        state: action.state,
        confidence: action.confidence,
        reason: action.reason,
        outputLength: latestOutputText(event.timeline).length,
      }));

      if (action.state === "NEEDS_DECISION" && config.reviewer.enabled) {
        try {
          const review = await requestTechnicalReview(paseo, {
            agentId: event.agent.id,
            parentAgentId: event.agent.parentAgentId,
            cwd: event.agent.cwd,
            provider: config.reviewer.provider ?? event.agent.provider,
            model: config.reviewer.model,
            request: {
              task_summary: input.task.original_request,
              decision_required: input.last_agent_message || action.reason,
              constraints: input.task.success_criteria,
              implementation_context: JSON.stringify(input.recent_activity.slice(-10)),
              evidence: input.runtime?.files_modified?.map((file) => ({ type: "modified_file", summary: file })),
            },
          });
          if (review.status === "DECIDED") {
            reviewerContextRounds.set(event.agent.id, 0);
            await agent.send(decisionPrompt(review));
          } else {
            const rounds = (reviewerContextRounds.get(event.agent.id) ?? 0) + 1;
            reviewerContextRounds.set(event.agent.id, rounds);
            if (rounds > config.reviewer.max_context_round_trips) {
              console.error(JSON.stringify({ event: "REVIEW_CONTEXT_LIMIT", agentId: event.agent.id, rounds }));
            } else {
              await agent.send(contextPrompt(review.required_information));
            }
          }
          console.error(JSON.stringify({ event: "REVIEW_COMPLETED", agentId: event.agent.id, status: review.status, decision: review.status === "DECIDED" ? review.decision : undefined }));
        } catch (error) {
          console.error(JSON.stringify({ event: "REVIEW_FAILED", agentId: event.agent.id, reason: error instanceof Error ? error.message : String(error) }));
        }
      }

      let demoFailed = false;
      if (action.state === "DONE" && config.demo.enabled && config.demo.plan_file) {
        try {
          const demo = await runPlaywrightDemo(config.demo.plan_file, config.demo);
          console.error(JSON.stringify({ event: "DEMO_COMPLETED", agentId: event.agent.id, evidenceDir: demo.evidenceDir, output: demo.output.slice(-2000) }));
        } catch (error) {
          demoFailed = true;
          console.error(JSON.stringify({ event: "DEMO_FAILED", agentId: event.agent.id, reason: error instanceof Error ? error.message : String(error) }));
          await agent.send(`The implementation appears complete, but the human-watchable Playwright demo failed. Inspect the demo failure and determine whether the feature is broken, the demo script is wrong, or the environment is unsuitable. Fix the appropriate issue and rerun the demo.\n\n${error instanceof Error ? error.message : String(error)}`);
        }
      }

      if ((action.state === "DONE" && !demoFailed) || action.state === "NEEDS_USER") {
        controllers.delete(event.agent.id);
        reviewerContextRounds.delete(event.agent.id);
        await stateStore.delete(event.agent.id);
      } else {
        await stateStore.set(event.agent.id, { guard: controller.guardState(), reviewerContextRounds: reviewerContextRounds.get(event.agent.id) ?? 0, updatedAt: new Date().toISOString() });
      }
    });
    queues.set(event.agent.id, current);
    try {
      await current;
    } finally {
      if (queues.get(event.agent.id) === current) queues.delete(event.agent.id);
    }
  });

  return () => {
    controllers.clear();
    reviewerContextRounds.clear();
    queues.clear();
  };
}
