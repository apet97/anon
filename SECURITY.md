# Security

## Threat model (one line)

Recipients must not learn the sender's identity; workspace admins must, on
report, learn the sender's identity. Everyone else — including anyone with
access to application logs — must see neither the sender identity for a given
message nor the raw message body.

## Secrets policy

- **Runtime configuration lives in the process environment.** `src/config.ts`
  fails fast at startup if any of `PUMBLE_APP_ID`, `PUMBLE_APP_KEY`,
  `PUMBLE_APP_CLIENT_SECRET`, or `PUMBLE_APP_SIGNING_SECRET` is missing.
- **Never commit:** `.env`, `.env.*` (except `.env.example`), `.pumbleapprc`,
  `.pumble-app-manifest.json`, `tokens.json`, `conversations.db*`, or anything
  under `data/`.
- **`.pumbleapprc` is a CLI convenience, not a secret source.** Do not use it
  in production. The CI pipeline and container images must source credentials
  from env vars or a managed secret store.
- **Logs never contain raw message bodies.** Handlers log only `workspaceId`,
  `userId`, `convId`, `eventType`, and outcome. The pino redaction list in
  `src/logger.ts` is the last-line defence.
- **Tokens persist in the SQLite `tokens` table** via `SqliteCredentialsStore`.
  `APP_UNAUTHORIZED` deletes the relevant user row; `APP_UNINSTALLED` deletes
  every row for the workspace.

## Rotation checklist

Use this whenever credentials may have been exposed (for example, if
`tokens.json` or `.pumbleapprc` ever sat on an untrusted machine, if a
contributor's laptop was lost, or on a routine schedule).

1. **Revoke current credentials in the Pumble marketplace.**
   - Open https://pumble.com/app/marketplace → your app (`69950af22720c2992bab57f7`
     for the dev workspace import) → Credentials.
   - Regenerate the App Key, OAuth Client Secret, and Signing Secret.
   - If the workspace already installed the app, uninstall and reinstall to
     force fresh OAuth consent. The old `accessToken` / `botToken` become
     invalid once the reinstall completes.

2. **Clean up any stale local files.**
   ```bash
   rm -f tokens.json tokens.json.migrated .pumbleapprc .env
   ```
   If you need a working local dev environment, regenerate `.env` from
   `.env.example` with fresh values; never restore the deleted `.pumbleapprc`.

3. **Populate production secrets.**
   - In production, provide the rotated values as environment variables or via
     your platform's secret store (Kubernetes Secret, Railway/Fly env, etc.).
   - For local verification, populate `.env` and start the app with
     `npm run start` or `docker run --env-file .env anon:latest`.

4. **Update trigger URLs if the host changed.**
   ```bash
   npx pumble-cli pre-publish --host https://<your-production-host>
   ```

5. **Verify lifecycle cleanup still fires.**
   Trigger an uninstall and confirm the `tokens` table row for that workspace
   is gone (see `tests/events/appUninstalled.test.ts` for the expected
   behaviour).

## What to do if a secret leaks

1. Rotate immediately (steps 1–4 above).
2. Review `audit_log` for any unexpected `SEND`, `REPLY`, or `REPORT` events
   from the compromise window and export them if needed.
3. If tokens.json or application logs were exfiltrated, consider this a
   confidentiality incident for every workspace currently installed. Notify
   workspace owners and force reinstall.

## Verified compromised credentials (2026-04-08)

The `abot/` prototype directory contains `tokens.json` and `.pumbleapprc`
with live credentials for workspace `64ad1305c701cc5be7c26fe4` and app
`69950af22720c2992bab57f7`. These **must be rotated** using the checklist
above before the standalone repo is used in production. The rotation is a
manual post-session step.
