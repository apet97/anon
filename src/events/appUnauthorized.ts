import type { AppDeps } from "../deps";

/**
 * `APP_UNAUTHORIZED` — a user revoked the app's access. In Phase 5
 * this will also call `credentialsStore.deleteForUser(...)`.
 */
export type EventHandler = (ctx: any) => Promise<void>;

export function makeAppUnauthorizedHandler(deps: AppDeps): EventHandler {
  return async (ctx) => {
    deps.logger.warn(
      {
        eventType: "APP_UNAUTHORIZED",
        workspaceId: ctx.payload?.workspaceId,
        body: undefined, // never log the raw body
        outcome: "received",
      },
      "app unauthorized event received",
    );
  };
}
