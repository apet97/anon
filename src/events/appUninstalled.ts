import type { AppDeps } from "../deps";

/**
 * `APP_UNINSTALLED` — the app was removed from a workspace. In
 * Phase 5 this will also call `credentialsStore.deleteForWorkspace(...)`
 * and purge `pending_replies` rows belonging to that workspace.
 */
export type EventHandler = (ctx: any) => Promise<void>;

export function makeAppUninstalledHandler(deps: AppDeps): EventHandler {
  return async (ctx) => {
    deps.logger.warn(
      {
        eventType: "APP_UNINSTALLED",
        workspaceId: ctx.payload?.workspaceId,
        outcome: "received",
      },
      "app uninstalled event received",
    );
  };
}
