/**
 * `@cline/hub-testkit` — deterministic contract-test harness for Hub protocol v1.
 *
 * Three pieces:
 * - {@link startTestHub}: the real hub WebSocket server on an ephemeral port,
 *   backed by a scripted runtime host you drive declaratively.
 * - {@link createFrameRecorder} + {@link canonicalizeTranscript}: capture a wire
 *   transcript and strip every source of run-to-run drift.
 * - {@link fakeHubSocketFor}: replay a committed fixture into a real `HubClient`
 *   with no server at all (import from `@cline/hub-testkit/replay` in browser
 *   test environments).
 */

export {
	DEFAULT_FIXTURE_DIR,
	type FixtureWriteResult,
	fixturePath,
	fixtureUpdateEnabled,
	readFixture,
	readFixtureBytes,
	resolveGeneratedBy,
	writeFixtureIfChanged,
} from "./fixture";
export { createFrameRecorder, type FrameRecorder } from "./recorder";
export * from "./replay";
export {
	type ApprovalMode,
	type ScriptStep,
	scriptedTurnText,
	type TurnScript,
	toTurnScript,
} from "./script";
export {
	ScriptedRuntimeHost,
	type ScriptedRuntimeHostOptions,
} from "./scripted-runtime-host";
export {
	type RawRegisterOptions,
	type RawRegisterResult,
	type StartTestHubOptions,
	startTestHub,
	type TestHub,
	type TestHubClient,
	type TestHubClientOptions,
} from "./test-hub";
export {
	type VerifyFixtureInput,
	type VerifyFixtureResult,
	verifyFixture,
} from "./verify-fixture";
