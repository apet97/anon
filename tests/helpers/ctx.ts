/**
 * Minimal fake contexts for Pumble handlers. Each fake records the
 * calls made against it so tests can assert on ack timing, modal
 * opens, and `say` responses without depending on the SDK.
 */
import type { FakePumbleClient } from "./pumbleClient";

export interface FakeSlashCommandCtx {
  payload: { userId: string; text: string; workspaceId: string; channelId: string; threadRootId?: string };
  ackCalls: number;
  sayCalls: Array<{ text: string; visibility: "ephemeral" | "in_channel" }>;
  spawnedModals: any[];
  ack(): Promise<void>;
  say(text: string, visibility: "ephemeral" | "in_channel"): Promise<void>;
  getBotClient(): Promise<FakePumbleClient | undefined>;
}

export function makeSlashCommandCtx(
  args: { userId: string; text: string; workspaceId?: string; channelId?: string; threadRootId?: string; botClient?: FakePumbleClient | undefined },
): FakeSlashCommandCtx {
  const ctx: FakeSlashCommandCtx = {
    payload: {
      userId: args.userId,
      text: args.text,
      workspaceId: args.workspaceId ?? "ws-1",
      channelId: args.channelId ?? "ch-1",
      ...(args.threadRootId ? { threadRootId: args.threadRootId } : {}),
    },
    ackCalls: 0,
    sayCalls: [],
    spawnedModals: [],
    async ack() {
      ctx.ackCalls += 1;
    },
    async say(text, visibility) {
      ctx.sayCalls.push({ text, visibility });
    },
    async getBotClient() {
      return args.botClient;
    },
  };
  return ctx;
}

export interface FakeBlockInteractionCtx {
  payload: {
    userId: string;
    payload: string;
    workspaceId: string;
  };
  ackCalls: number;
  spawnedModals: any[];
  ack(): Promise<void>;
  spawnModalView(view: any): Promise<void>;
  getBotClient(): Promise<FakePumbleClient | undefined>;
}

export function makeBlockInteractionCtx(args: {
  userId: string;
  value: string;
  workspaceId?: string;
  botClient?: FakePumbleClient | undefined;
}): FakeBlockInteractionCtx {
  const ctx: FakeBlockInteractionCtx = {
    payload: {
      userId: args.userId,
      payload: JSON.stringify({ value: args.value }),
      workspaceId: args.workspaceId ?? "ws-1",
    },
    ackCalls: 0,
    spawnedModals: [],
    async ack() {
      ctx.ackCalls += 1;
    },
    async spawnModalView(view) {
      ctx.spawnedModals.push(view);
    },
    async getBotClient() {
      return args.botClient;
    },
  };
  return ctx;
}

export interface FakeViewActionCtx {
  payload: {
    userId: string;
    workspaceId: string;
    view: { state: any };
  };
  // SDK-typed state accessor (ViewPayloadContext.viewState) — what the handler reads.
  viewState: any;
  ackCalls: number;
  ack(): Promise<void>;
  getBotClient(): Promise<FakePumbleClient | undefined>;
}

export function makeViewActionCtx(args: {
  userId: string;
  workspaceId?: string;
  state: any;
  botClient?: FakePumbleClient | undefined;
}): FakeViewActionCtx {
  const ctx: FakeViewActionCtx = {
    payload: {
      userId: args.userId,
      workspaceId: args.workspaceId ?? "ws-1",
      view: { state: args.state },
    },
    // viewState mirrors the SDK's ViewPayloadContext.viewState — keyed by blockId then onAction.
    viewState: args.state,
    ackCalls: 0,
    async ack() {
      ctx.ackCalls += 1;
    },
    async getBotClient() {
      return args.botClient;
    },
  };
  return ctx;
}
