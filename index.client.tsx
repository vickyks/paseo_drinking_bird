import type { PluginCleanup } from "@getpaseo/plugin";
import type { PluginClientContext } from "@getpaseo/plugin/client";
import { contributeTimeline } from "./client/controller-timeline.js";
import { supervisionRpc } from "./shared/supervision.js";

export default function contribute(client: PluginClientContext): PluginCleanup {
  const removeTimeline = contributeTimeline(client);
  const removeCommand = client.addSlashCommand({
    name: "drinking-bird",
    description: "Approve or reject a pending Drinking Bird action",
    argumentHint: "auto|supervise|approve|reject",
    context: "agent",
    async onSubmit({ args, agent, rpc }) {
      const action = args.trim();
      if (!["auto", "supervise", "approve", "reject"].includes(action)) throw new Error("Use /drinking-bird auto, supervise, approve, or reject");
      await rpc(supervisionRpc, { agentId: agent.id, action: action as "auto" | "supervise" | "approve" | "reject" });
    },
  });
  return () => { removeCommand(); removeTimeline(); };
}
