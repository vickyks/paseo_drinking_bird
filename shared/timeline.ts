import { z } from "zod";

export const controllerTimelineKind = "drinking-bird.controller-decision";
export const controllerTimelineVersion = 1;
export const controllerTimelineSchema = z.object({
  state: z.enum(["DONE", "CONTINUE", "VERIFY_DONE", "NEXT_TODO", "NEEDS_DECISION", "NEEDS_USER"]),
  confidence: z.number().min(0).max(1),
  reason: z.string(),
  turnId: z.string().nullable(),
});
export type ControllerTimelineData = z.infer<typeof controllerTimelineSchema>;
