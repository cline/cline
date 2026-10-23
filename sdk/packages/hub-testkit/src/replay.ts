/**
 * Portable entry point: fixture replay + canonicalization only.
 *
 * Nothing here touches node builtins or `@cline/core`, so browser/jsdom UI tests
 * can import `@cline/hub-testkit/replay` to drive a `HubClient` from a committed
 * fixture. The node-only harness (`startTestHub`) lives behind the root export.
 */

export {
	type CanonicalFrame,
	type CanonicalizeOptions,
	type Canonicalizer,
	canonicalizeFrames,
	canonicalizeTranscript,
	createCanonicalizer,
	FIXTURE_SCHEMA,
	type FrameDirection,
	frameLabel,
	PORT_PLACEHOLDER,
	REDACTED_PLACEHOLDER,
	REGISTER_COMMAND_ENVELOPE_KEYS,
	REGISTER_COMMAND_PAYLOAD_KEYS,
	REGISTER_REPLY_ENVELOPE_KEYS,
	REGISTER_REPLY_HANDSHAKE_PAYLOAD_KEYS,
	REGISTER_REPLY_PAYLOAD_KEYS,
	type RecordedFrame,
	TIMESTAMP_PLACEHOLDER,
} from "./canonicalize";
export {
	FakeHubSocket,
	type FakeHubSocketOptions,
	fakeHubSocketFor,
	fixtureRejectsConnect,
} from "./fake-socket";
export {
	buildFixture,
	DEFAULT_GENERATED_BY,
	fixtureComparisonBytes,
	type HubFixture,
	serializedFixtureComparisonBytes,
	serializeFixture,
} from "./fixture-format";
