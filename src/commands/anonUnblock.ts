import type { App } from "pumble-sdk";
import type { AppDeps } from "../deps";

type AnonCommand = NonNullable<App["slashCommands"]>[number];

export function makeAnonUnblockCommand(deps: AppDeps): AnonCommand {
  return {
    command: "/anon-unblock",
    description: "Resume receiving anonymous messages",
    usageHint: "/anon-unblock",
    handler: async (ctx) => {
      await ctx.ack();
      deps.repos.blockedUsers.unblock(ctx.payload.workspaceId, ctx.payload.userId);
      deps.logger.info(
        { eventType: "UNBLOCK", actorId: ctx.payload.userId, outcome: "ok" },
        "user unblocked anonymous messages",
      );
      deps.auditLog.record({
        eventType: "UNBLOCK",
        workspaceId: ctx.payload.workspaceId,
        actorId: ctx.payload.userId,
      });
      await ctx.say("You can now receive anonymous messages again.", "ephemeral");
    },
  };
}
