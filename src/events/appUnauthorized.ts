import type { AppDeps } from "../deps";

/**
 * `APP_UNAUTHORIZED` — a user revoked the app's access.
 *
 * Action: delete that user's row from the SQLite credentials store
 * and record an audit entry. Pending reply rows for that user are
 * also purged so a revoked user cannot hold open an orphan modal.
 *
 * The Pumble SDK delivers the affected user and workspace IDs via
 * ctx.payload — the exact shape depends on the SDK version, so we
 * read them defensively.
 */
export type EventHandler = (ctx: any) => Promise<void>;

export function makeAppUnauthorizedHandler(deps: AppDeps): EventHandler {
  return async (ctx) => {
    const workspaceId: string | undefined =
      ctx?.payload?.workspaceId ?? ctx?.payload?.body?.workspaceId;
    const workspaceUserId: string | undefined =
      ctx?.payload?.userId ?? ctx?.payload?.body?.userId;

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
