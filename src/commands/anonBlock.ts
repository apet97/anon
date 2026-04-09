import type { App } from "pumble-sdk";
import type { AppDeps } from "../deps";

type AnonCommand = NonNullable<App["slashCommands"]>[number];

export function makeAnonBlockCommand(deps: AppDeps): AnonCommand {
  return {
    command: "/anon-block",
    description: "Stop receiving anonymous messages",
    usageHint: "/anon-block",
    handler: async (ctx) => {
      await ctx.ack();
      deps.repos.blockedUsers.block(ctx.payload.userId);
      deps.logger.info(
        { eventType: "BLOCK", actorId: ctx.payload.userId, outcome: "ok" },
        "user blocked anonymous messages",
      );
      deps.auditLog.record({
        eventType: "BLOCK",
        workspaceId: ctx.payload.workspaceId,
        actorId: ctx.payload.userId,
      });
      await ctx.say(
        "You will no longer receive anonymous messages. Use `/anon-unblock` to opt back in.",
        "ephemeral",
      );
    },
  };
}
