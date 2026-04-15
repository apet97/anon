/**
 * Fake ApiClient that captures outgoing calls so tests can assert
 * on the Pumble API interaction shape without running the SDK.
 *
 * The real `ApiClient` has a large surface area; tests only need a
 * few methods, so we implement just those. Missing methods will
 * throw at runtime if a test touches them.
 */
export interface CapturedPostMessage {
  channelId: string;
  body: any;
}

export interface CapturedChannelCreate {
  args: any;
}

export interface FakePumbleClientOptions {
  dmChannelId?: string;
  existingChannels?: Array<{ id: string; name: string }>;
  workspaceUsers?: Array<{ id: string; role: "OWNER" | "ADMIN" | "MEMBER" }>;
  createChannelId?: string;
}

export interface CapturedThreadReply {
  threadRootId: string;
  channelId: string;
  body: any;
}

export interface FakePumbleClient {
  posts: CapturedPostMessage[];
  channelPosts: CapturedPostMessage[];
  threadReplies: CapturedThreadReply[];
  channelCreates: CapturedChannelCreate[];
  addedToChannel: Array<{ channelId: string; userIds: string[] }>;
  v1: {
    channels: {
      getDirectChannel(userIds: string[]): Promise<any>;
      listChannels(kinds: string[]): Promise<any[]>;
      createChannel(args: any): Promise<any>;
      addUsersToChannel(channelId: string, body: { userIds: string[] }): Promise<void>;
    };
    messages: {
      // Mirrors the real Pumble SDK: postMessageToChannel resolves with the
      // created message object (we only need `id` for thread_root_id).
      postMessageToChannel(channelId: string, body: any): Promise<{ id: string }>;
      reply(threadRootId: string, channelId: string, body: any): Promise<void>;
    };
    users: {
      listWorkspaceUsers(): Promise<any[]>;
    };
  };
}

export function makeFakePumbleClient(
  opts: FakePumbleClientOptions = {},
): FakePumbleClient {
  const posts: CapturedPostMessage[] = [];
  const channelPosts: CapturedPostMessage[] = [];
  const threadReplies: CapturedThreadReply[] = [];
  const channelCreates: CapturedChannelCreate[] = [];
  const addedToChannel: Array<{ channelId: string; userIds: string[] }> = [];
  const dmChannelId = opts.dmChannelId ?? "dm-channel-1";
  const existingChannels = opts.existingChannels ?? [];
  const workspaceUsers = opts.workspaceUsers ?? [];
  const createChannelId = opts.createChannelId ?? "created-channel-1";
  let postCounter = 0;

  return {
    posts,
    channelPosts,
    threadReplies,
    channelCreates,
    addedToChannel,
    v1: {
      channels: {
        async getDirectChannel(_userIds) {
          return { channel: { id: dmChannelId } };
        },
        async listChannels(_kinds) {
          return existingChannels.map((c) => ({ channel: c }));
        },
        async createChannel(args) {
          channelCreates.push({ args });
          return { channel: { id: createChannelId } };
        },
        async addUsersToChannel(channelId, body) {
          addedToChannel.push({ channelId, userIds: body.userIds });
        },
      },
      messages: {
        async postMessageToChannel(channelId, body) {
          posts.push({ channelId, body });
          channelPosts.push({ channelId, body });
          postCounter += 1;
          return { id: `fake-msg-${postCounter}` };
        },
        async reply(threadRootId, channelId, body) {
          threadReplies.push({ threadRootId, channelId, body });
        },
      },
      users: {
        async listWorkspaceUsers() {
          return workspaceUsers;
        },
      },
    },
  };
}
