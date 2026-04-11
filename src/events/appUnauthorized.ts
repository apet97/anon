import type { PumbleEventContext } from "pumble-sdk/lib/core/types/contexts";
import type { AppDeps } from "../deps";

/**
 * `APP_UNAUTHORIZED` — a user revoked the app's access.
 *
 * Action: delete that user's row from the SQLite credentials store
 * and record an audit entry. Pending reply rows for that user are
 * also purged so a revoked user cannot hold open an orphan modal.
 *
 * Payload shape (SDK v1.1.1):
 *   ctx.payload.workspaceId            — top-level on PumbleEventPayload
 *   ctx.payload.body.workspaceUser     — the revoked workspace-user ID
 *   ctx.payload.workspaceUserIds       — array of affected user IDs
 */
export type EventHandler = (ctx: PumbleEventContext<"APP_UNAUTHORIZED">) => Promise<void>;

export function makeAppUnauthorizedHandler(deps: AppDeps): EventHandler {
  return async (ctx) => {
    const workspaceId = ctx.payload.workspaceId;
    // body.workspaceUser is the revoked workspace-user ID per NotificationAppUnauthorized.
    const workspaceUserId = ctx.payload.body.workspaceUser;

    if (workspaceId && workspaceUserId) {
      await deps.credentialsStore.deleteForUser(workspaceUserId, workspaceId);
      deps.pendingRepliesRepo.delete(workspaceId, workspaceUserId);
    }

    deps.auditLog.record({
      eventType: "APP_UNAUTHORIZED",
      workspaceId,
      actorId: workspaceUserId,
    });

    deps.logger.warn(
      {
        eventType: "APP_UNAUTHORIZED",
        workspaceId,
        actorId: workspaceUserId,
        outcome: workspaceId && workspaceUserId ? "cleaned" : "incomplete-payload",
      },
      "app unauthorized event processed",
    );
  };
}
