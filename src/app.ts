import type { App } from "pumble-sdk";
import type { AppDeps } from "./deps";
import { makeAnonCommand } from "./commands/anon";
import { makeAnonBlockCommand } from "./commands/anonBlock";
import { makeAnonUnblockCommand } from "./commands/anonUnblock";
import { makeReplyAnonHandler } from "./interactions/replyAnon";
import { makeReportAnonHandler } from "./interactions/reportAnon";
import {
  makeAnonReplyModalSubmit,
  makeAnonReplyModalClose,
} from "./views/anonReplyModal";
import { makeAppUnauthorizedHandler } from "./events/appUnauthorized";
import { makeAppUninstalledHandler } from "./events/appUninstalled";

/**
 * Assemble the Pumble `App` config from injected dependencies. This
 * function is pure — it has no side effects (no file I/O, no SDK
 * `start()` call, no env reads) — so tests can instantiate it with
 * in-memory repos and capture the emitted App shape directly.
 *
 * The runtime bootstrap in `main.ts` is responsible for constructing
 * the real `AppDeps` object and passing the returned `App` to the
 * SDK's `start()`.
 */
export function createApp(deps: AppDeps): App {
  return {
    slashCommands: [
      makeAnonCommand(deps),
      makeAnonBlockCommand(deps),
      makeAnonUnblockCommand(deps),
    ],
    blockInteraction: {
      interactions: [
        {
          sourceType: "MESSAGE",
          handlers: {
            reply_anon: makeReplyAnonHandler(deps),
            report_anon: makeReportAnonHandler(deps),
          },
        },
      ],
    },
    viewAction: {
      onSubmit: {
        anon_reply_modal: makeAnonReplyModalSubmit(deps),
      },
      onClose: {
        anon_reply_modal: makeAnonReplyModalClose(deps),
      },
    },
    events: [
      {
        name: "APP_UNAUTHORIZED",
        handler: makeAppUnauthorizedHandler(deps),
      },
      {
        name: "APP_UNINSTALLED",
        handler: makeAppUninstalledHandler(deps),
      },
    ],
    eventsPath: "/hook",
    tokenStore: deps.credentialsStore,
  };
}
