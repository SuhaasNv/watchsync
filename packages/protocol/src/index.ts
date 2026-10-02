import type { ClientMessage, RoomTicket, ServerMessage } from "./generated/types";
import {
  validateClientMessage,
  validateRoomTicket,
  validateServerMessage,
} from "./generated/validators.js";

export * from "./generated/types";

/** Narrowed message types: `type` and `payload` are always present on a valid message. */
type Strict<T> = T extends { type?: infer K; payload?: infer P }
  ? Omit<T, "type" | "payload"> & { type: K; payload: P }
  : never;
export type AnyClientMessage = Strict<ClientMessage>;
export type AnyServerMessage = Strict<ServerMessage>;
export type ClientMessageOf<K extends AnyClientMessage["type"]> = Extract<
  AnyClientMessage,
  { type: K }
>;
export type ServerMessageOf<K extends AnyServerMessage["type"]> = Extract<
  AnyServerMessage,
  { type: K }
>;

export const isClientMessage = (m: unknown): m is AnyClientMessage => validateClientMessage(m);
export const isServerMessage = (m: unknown): m is AnyServerMessage => validateServerMessage(m);
export const isRoomTicket = (m: unknown): m is RoomTicket => validateRoomTicket(m);

/** Wrap a payload in the protocol envelope. */
export function envelope<M extends AnyClientMessage | AnyServerMessage>(
  type: M["type"],
  payload: M["payload"],
): M {
  return { id: crypto.randomUUID(), type, timestamp: Date.now(), payload } as M;
}
