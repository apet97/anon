import type { PumbleEventContext } from "pumble-sdk/lib/core/types/contexts";
import type { AppDeps } from "../deps";

/**
 * `APP_UNINSTALLED` — the app was removed from a workspace.
 *
 * Action: delete every token row for that workspace, purge every
 * pending reply row for that workspace, and record an audit entry.
 * Conversation history is preserved so the workspace's admins can
 * still review historical audit records after an uninstall.
 *
 * Payload shape (SDK v1.1.1):
 *   ctx.payload.workspaceId  — top-level on PumbleEventPayload (always present)
 */
export type EventHandler = (ctx: PumbleEventContext<"APP_UNINSTALLED">) => Promise<void>;

export function makeAppUninstalledHandler(deps: AppDeps): EventHandler {
  return async (ctx) => {
    // workspaceId is guaranteed present at the top level of PumbleEventPayload.
    const workspaceId = ctx.payload.workspaceId;

    let pendingRemoved = 0;
    let blockedRemoved = 0;
    let rateLimitsRemoved = 0;
    let targetLimitsRemoved = 0;
    let configRemoved = 0;
    if (workspaceId) {
      await deps.credentialsStore.deleteForWorkspace(workspaceId);
      pendingRemoved = deps.pendingRepliesRepo.deleteForWorkspace(workspaceId);
      blockedRemoved = deps.repos.blockedUsers.deleteForWorkspace(workspaceId);
      rateLimitsRemoved = deps.repos.rateLimits.deleteForWorkspace(workspaceId);
      targetLimitsRemoved = deps.repos.targetLimits.deleteForWorkspace(workspaceId);
      configRemoved = deps.repos.config.deleteForWorkspace(workspaceId);
    }

    deps.auditLog.record({
      eventType: "APP_UNINSTALLED",
      workspaceId,
      metadata: { pendingRemoved, blockedRemoved, rateLimitsRemoved, targetLimitsRemoved, configRemoved },
    });

    deps.logger.warn(
      {
        eventType: "APP_UNINSTALLED",
        workspaceId,
        pendingRemoved,
        blockedRemoved,
        rateLimitsRemoved,
        targetLimitsRemoved,
        configRemoved,
        outcome: workspaceId ? "cleaned" : "incomplete-payload",
      },
      "app uninstalled event processed",
    );
  };
}
