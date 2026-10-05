import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const supervisionAction = z.enum(["approve", "reject", "auto", "supervise"]);
export const supervisionRpc = defineRpc({
  name: "drinking-bird.supervision",
  input: z.object({ agentId: z.string(), action: supervisionAction }),
  output: z.object({ ok: z.boolean(), message: z.string() }),
});
