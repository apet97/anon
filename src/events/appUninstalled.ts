import type { AppDeps } from "../deps";

/**
 * `APP_UNINSTALLED` — the app was removed from a workspace.
 *
 * Action: delete every token row for that workspace, purge every
 * pending reply row for that workspace, and record an audit entry.
 * Conversation history is preserved so the workspace's admins can
 * still review historical audit records after an uninstall.
 */
export type EventHandler = (ctx: any) => Promise<void>;

export function makeAppUninstalledHandler(deps: AppDeps): EventHandler {
  return async (ctx) => {
    const workspaceId: string | undefined =
      ctx?.payload?.workspaceId ?? ctx?.payload?.body?.workspaceId;

    let pendingRemoved = 0;
    if (workspaceId) {
      await deps.credentialsStore.deleteForWorkspace(workspaceId);
      pendingRemoved = deps.pendingRepliesRepo.deleteForWorkspace(workspaceId);
    }

    deps.auditLog.record({
      eventType: "APP_UNINSTALLED",
      workspaceId,
      metadata: { pendingRemoved },
    });

    deps.logger.warn(
      {
        eventType: "APP_UNINSTALLED",
        workspaceId,
        pendingRemoved,
        outcome: workspaceId ? "cleaned" : "incomplete-payload",
      },
      "app uninstalled event processed",
    );
  };
}
