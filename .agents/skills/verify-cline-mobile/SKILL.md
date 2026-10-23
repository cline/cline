---
name: verify-cline-mobile
description: Map and verify the real Cline iOS app with Maestro, including onboarding, Cloud sessions, sidebar navigation, keyboard, attachments and account settings. Use for mobile E2E and release checks.
---

# Verify Cline mobile

Run native/browser interaction through a dedicated Luna subagent under the workspace rules. One agent owns a simulator at a time. Read [the feature map](features/README.md) before choosing cases. Unit/component tests are supporting coverage, not native E2E.

## Launch

From the repository root, inspect `apps/mobile/app.json`, `apps/mobile/src/config/features.ts`, and `git status`. Record the revision and any source changes in the run report. Use Bun. The real entry is `apps/mobile/index.js` → `expo-router/entry`; never replace it with a component showcase for E2E.

Use an already built production Release app when its revision matches. For a fresh native project, `cd apps/mobile && EXPO_PUBLIC_ENV=production bunx expo prebuild --platform ios` generates the Xcode workspace. Existing generated native projects should not be regenerated unnecessarily. The workspace is `apps/mobile/ios/Cline.xcworkspace`, scheme `Cline`; use `EXPO_PUBLIC_ENV=production` when archiving or building a simulator Release. Keychain requires correctly embedded simulator signing entitlements matching the bundle and development team. Do not invent a signing identity or silently fall back to in-memory auth.

Do not run device and simulator Xcode builds concurrently: shared Pods preparation mutates dependencies. Keep device and simulator DerivedData separate. Build/CLI completion alone does not verify a screen.

For an available built app, select the simulator explicitly:

```sh
xcrun simctl install "$MOBILE_SIMULATOR_ID" "$MOBILE_APP_PATH"
xcrun simctl launch "$MOBILE_SIMULATOR_ID" bot.cline.app
```

A returning-user install must preserve app data. Fresh onboarding, sign-out, permission denial and destructive cases require a new disposable simulator or a designated test account. Never run `clearState: true` on the user's existing simulator. Choose device/runtime identifiers from `xcrun simctl list --json`; record the new simulator's UUID for cleanup. Readiness means the expected welcome or authenticated Home UI is visible and its controls respond.

## Doctor

Set `JAVA_HOME` to the installed JDK when the shell's default Java is unavailable. On Homebrew installations `brew --prefix openjdk@21` locates one if installed; do not assume a fixed machine path. Put its `bin` directory on `PATH` for Maestro commands. Run the read-only helper:

```sh
.agents/skills/verify-cline-mobile/scripts/doctor.py \
  --device "$MOBILE_SIMULATOR_ID" \
  --expected-version "$MOBILE_EXPECTED_VERSION" \
  --evidence-dir "$MOBILE_EVIDENCE_DIR"
```

Require the expected simulator, bundle, version and build. If any differs, explain it before interpreting a result. The helper does not verify account authorization; inspect that through the UI. Never read tokens to make the doctor pass.

## Drive

From `apps/mobile`, use an explicit simulator and an evidence directory outside this public repository:

```sh
maestro --device "$MOBILE_SIMULATOR_ID" test \
  --driver-host-port "$MOBILE_DRIVER_HOST_PORT" \
  --test-output-dir "$MOBILE_EVIDENCE_DIR" .maestro/connect-smoke.yaml
```

Set `MOBILE_DRIVER_HOST_PORT` to a free port unique to each concurrent Maestro process (for example, 7201, 7202 and 7203). Maestro 2.10 accepts this hidden option even though it is omitted from `--help`.

`connect-smoke.yaml` is the disposable, signed-out onboarding flow. Read it before running it: it clears state. Use separate non-destructive flows for the returning user's installation. Prefer accessibility names observed from the real UI hierarchy: `All sessions`, `Collapse sidebar`, `Search sessions`, `Settings`, `Back`, `Message Cline from Home`, `Message composer`, `Search Cloud repositories`, `Search Cloud branches`, `Search models`.

Exercise both Home and chat entry points, portrait and both landscape directions, keyboard open/closed, loading, failure/retry, cancel, foreground return and relaunch. A case passes only when all its assertions are observed. Test newly created Cloud sessions against a designated disposable repository. Use read-only prompts for execution checks. Rename/stop/delete only sessions created for this run. Failure injection must use a controlled test boundary; never disrupt a production service to manufacture an error.

## Evidence

Keep screenshots, UI hierarchies, action logs, test reports and account/session identifiers in a private evidence directory, never tracked files or public PRs. Record version/build/revision and the case ID. Capture actions and resulting UI, plus persistent side effects where relevant. For a send, prove one delivered message and one response; for delete, verify the exact disposable session disappears after refresh.

Report `passed`, `failed`, `partial`, `blocked` or `not run` for each case, with evidence or a concrete missing prerequisite. A launcher screenshot proves launch only. A mocked API, synthetic component entry, direct state setter or a passing unit test does not prove production end-to-end behavior. Mark account/OAuth steps needing a human, unavailable hardware, and server-runtime-dependent cases explicitly. Deferred features have absence checks; do not present them as implemented.

## Cleanup

Terminate only app/jobs started by this run. Shut down and delete only disposable simulator UUIDs recorded at creation. Return the user's original simulator to the full app; never leave a test component visible. Preserve user drafts and saved preferences, restoring any temporary reversible changes. Delete only run-created disposable sessions through the app, with server-side disappearance verified. Keep all evidence after cleanup.

## Helpers

The read-only executable helper is `scripts/doctor.py`, invoked above, and writes `doctor.json` to the supplied private evidence directory. Existing `.maestro` flows drive the actual app. Feature coverage is documented under `features/`; keep it aligned with the release flags and UI entry points.
