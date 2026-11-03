import type { AgentEvent, TeamRealtimeEvent } from "@openbot/contracts/ipc";
import { z } from "zod";
export const peerInputSchema = z.object({
  hostId: z.string(),
  userId: z.string(),
  membershipId: z.string(),
  role: z.enum(["owner", "admin", "member"]),
  publicKey: z.string(),
  signalUrl: z.string().url(),
  rendererUrl: z.string().url(),
  preloadPath: z.string(),
  profile: z.string(),
});
export const peerCommandSchema = z.object({
  id: z.number().int(),
  operation: z.enum(["start", "request", "reconnect", "stop"]),
  input: peerInputSchema.optional(),
  path: z.string().optional(),
  method: z.enum(["GET", "POST"]).optional(),
  body: z.json().optional(),
});
export const peerReplySchema = z.object({
  type: z.literal("reply"),
  id: z.number(),
  ok: z.boolean(),
  failure: z.string().optional(),
  failureStatus: z.number().optional(),
  failureCode: z.string().optional(),
  sandboxForced: z.boolean().optional(),
  sessionId: z.string().nullable().optional(),
  response: z.object({ status: z.number(), body: z.json() }).optional(),
});
export type PeerReply = z.infer<typeof peerReplySchema>;

export type PeerRequest = Omit<z.infer<typeof peerCommandSchema>, "id">;
export type PeerOutput =
  | PeerReply
  | { type: "event"; event: AgentEvent | TeamRealtimeEvent }
  | { type: "disconnected" }
  | { type: "fatal" };
