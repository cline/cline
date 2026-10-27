# Cline mobile

Use Bun 1.3.13 and Node 22 or newer. Run `bun run test` and `bun run typecheck` from this directory. The shipped mobile surface uses Cloud; computer connections remain behind the release flag.

## Task alerts

Enable **Task alerts** in Settings to request the system notification permission. The client posts local notifications for newly received approvals, questions, failed runs, and completed tasks. Alerts omit prompt and repository contents, suppress the currently viewed conversation, deduplicate events, and open only an exact task already stored on the device. Disabling alerts or signing out clears them.

This is client-side delivery for connected sessions. iOS/Android can suspend the app and its socket; reliable delivery after suspension or termination requires a future backend push service and APNs/FCM credentials. This implementation does not register device tokens or call a push service. Permission is requested only from the Settings action.

## Files and branch review

Inline generated files have a **Save or share file** action. Validated base64 attachments use an 8 MiB encoded-data limit. Successful shares remain in a dedicated private cache so Android recipients can read the FileProvider URI after the chooser closes. Later shares prune files older than a day; the cache rejects additions above 64 MiB. The OS may clear cached files earlier. Unresolved artifact/remote file references remain unavailable, as in the desktop inline-file renderer.

GitHub review links use the task branch prescribed by the resolved Cloud workspace (`taskId`, otherwise the outer workspace ID), compared with its starting branch when known. They do not infer a task branch from the inner conversation ID and do not inspect the live checkout. Missing branch context falls back to repository pull requests. An agent must create/push the prescribed branch before GitHub can display its changes.

## Questions and native regeneration

Structured questions use the current Hub's creator-client ownership contract. Stable mobile routing identity supports reconnecting the same installation; another device cannot take over its question. Desktop Cloud creation now contributes its own question executor. Session-wide question handoff requires a future Hub protocol change.

The Expo `with-ios-scene-delegate.cjs` plugin preserves the scene lifecycle and cold/warm URL forwarding during native regeneration. Its regression tests exercise clean templates, repeated application, and the scene manifest. Do not maintain the migration only in the ignored generated iOS directory.
