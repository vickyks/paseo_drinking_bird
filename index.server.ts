import type { PluginServerContext } from "@getpaseo/plugin/server";
import { ContinuationController } from "./shared/controller.js";
import { RulesClassifier } from "./shared/classifier.js";
import { buildTurnClassificationInput } from "./server/turn-input.js";
import { latestOutputText } from "./server/inspect.js";
import { StateStore } from "./server/state-store.js";

const controllers = new Map<string, ContinuationController>();
const queues = new Map<string, Promise<void>>();

export default function contribute(server: PluginServerContext) {
  const stateStore = new StateStore();

  server.on("agent.turn_ended", async (event, { paseo, signal }) => {
    const previous = queues.get(event.agent.id) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(async () => {
      if (signal.aborted || event.outcome.kind === "canceled") return;

      const input = buildTurnClassificationInput(event.agent, event.timeline, event.outcome);
      let controller = controllers.get(event.agent.id);
      if (!controller) {
        const persisted = await stateStore.get(event.agent.id);
        controller = new ContinuationController(new RulesClassifier(), {}, (decision) => {
          console.error(JSON.stringify({ event: decision.type, agentId: event.agent.id, ...decision }));
        }, persisted?.guard);
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

      console.error(JSON.stringify({
        event: "STATE_EVALUATED",
        agentId: event.agent.id,
        turnId: event.turnId,
        state: action.state,
        confidence: action.confidence,
        reason: action.reason,
        outputLength: latestOutputText(event.timeline).length,
      }));

      if (action.state === "DONE" || action.state === "NEEDS_USER") {
        controllers.delete(event.agent.id);
        await stateStore.delete(event.agent.id);
      } else {
        await stateStore.set(event.agent.id, { guard: controller.guardState(), updatedAt: new Date().toISOString() });
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
    queues.clear();
  };
}
