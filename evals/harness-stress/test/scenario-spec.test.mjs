import assert from "node:assert/strict";
import test from "node:test";
import {
	decodeReplayToken,
	deterministicText,
	encodeReplayToken,
	normalizeScenarioSpec,
	profileSpecs,
	replayModel,
	replaySpecFromModel,
	scenarioFingerprint,
	splitUtf8,
} from "../src/scenario-spec.mjs";

test("replay tokens round-trip to one canonical scenario snapshot", () => {
	const spec = normalizeScenarioSpec({
		scenario: "baseline",
		seed: 42,
		size: 123_456,
		chunkBytes: 257,
		delayMs: 3,
		rounds: 2,
	});
	const token = encodeReplayToken(spec);

	assert.deepEqual(decodeReplayToken(token), spec);
	assert.deepEqual(replaySpecFromModel(replayModel(spec)), spec);
	assert.equal(encodeReplayToken(decodeReplayToken(token)), token);
});

test("replay tokens reject unknown fields, versions, and out-of-bound sizes", () => {
	assert.throws(
		() => normalizeScenarioSpec({ surprise: true }),
		/Unknown scenario spec field/,
	);
	assert.throws(
		() => normalizeScenarioSpec({ version: 2 }),
		/Unsupported scenario spec version/,
	);
	assert.throws(
		() => normalizeScenarioSpec({ size: 64 * 1024 * 1024 + 1 }),
		/size must be an integer/,
	);
	const nonCanonical = Buffer.from(
		'{"scenario":"baseline","version":1}',
	).toString("base64url");
	assert.throws(() => decodeReplayToken(nonCanonical), /not canonical/);
});

test("deterministic payloads preserve exact UTF-8 size and seed identity", () => {
	const first = deterministicText(100_003, 7);
	const replay = deterministicText(100_003, 7);
	const other = deterministicText(100_003, 8);

	assert.equal(Buffer.byteLength(first), 100_003);
	assert.equal(first, replay);
	assert.notEqual(first, other);
	assert.equal(
		scenarioFingerprint({ scenario: "text", size: 10, seed: 7 }),
		scenarioFingerprint({ scenario: "text", size: 10, seed: 7 }),
	);
});

test("UTF-8 chunks never split a code point or exceed the byte limit", () => {
	const text = "a😀中b".repeat(100);
	const chunks = [...splitUtf8(text, 5)];

	assert.equal(chunks.join(""), text);
	assert.ok(chunks.every((chunk) => Buffer.byteLength(chunk) <= 5));
});

test("all pressure profiles normalize within hard limits", () => {
	for (const profile of ["ci", "large", "extreme"]) {
		const specs = profileSpecs(profile);
		assert.ok(specs.length > 0);
		assert.ok(specs.every((spec) => spec.version === 1));
	}
});

test("combined size and chunk bounds reject framing explosions", () => {
	assert.throws(
		() =>
			normalizeScenarioSpec({
				scenario: "text",
				size: 262_145,
				chunkBytes: 1,
			}),
		/exceeding the limit of 262144/,
	);
});
