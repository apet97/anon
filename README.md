# Abot - Anonymous Messaging for Pumble

Send anonymous messages and have two-way anonymous conversations in Pumble.

## Setup

1. `npm install`
2. `npx pumble-cli login`
3. `npm run dev`

## Usage

Type in any channel:

```
/anon @username Your anonymous message here
```

The recipient gets a DM with your message, a "Reply Anonymously" button, and a "Report" button. Replies bounce back and forth without revealing identities.

### Opt out

```
/anon-block      -- stop receiving anonymous messages
/anon-unblock    -- resume receiving anonymous messages
```

## Features

- Two-way anonymous conversations via reply button + modal
- Opt-out system (`/anon-block` / `/anon-unblock`)
- Rate limiting: 5 messages per minute globally, 2 per recipient per hour
- Message length cap (2000 characters)
- Report button reveals sender identity to workspace admins
- Auto-created private `#abot-reports` channel for admin review
- Conversation data hidden server-side (not exposed in UI)
- SQLite persistence (survives restarts)
- Production-ready with optional MongoDB token store

## Storage

Conversations, blocked users, rate limits, and config are stored in a local SQLite database (`conversations.db`). Created automatically on first run.

## Scopes

- `messages:read` -- read messages
- `messages:write` -- send DMs via bot
- `channels:read` -- resolve DM channels
- `channels:list` -- list channels to find report channel
- `channels:write` -- create report channel
- `users:list` -- list workspace users to find admins

## Production

1. `npx pumble-cli pre-publish --host https://yourhost.com`
2. Set `MONGODB_URI` for persistent token storage (optional, falls back to local JSON file)
3. `npm start`
