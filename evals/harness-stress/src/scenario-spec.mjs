import { createHash } from "node:crypto";

export const SCENARIO_SPEC_VERSION = 1;

const SCENARIO_KINDS = new Set([
	"baseline",
	"text",
	"tool-arguments",
	"editor-old-text",
	"parallel-tools",
	"stall",
	"disconnect",
]);

const LIMITS = Object.freeze({
	size: { minimum: 1, maximum: 64 * 1024 * 1024 },
	chunkBytes: { minimum: 1, maximum: 16 * 1024 * 1024 },
	delayMs: { minimum: 0, maximum: 60_000 },
	rounds: { minimum: 1, maximum: 1_000 },
	parallel: { minimum: 1, maximum: 128 },
	seed: { minimum: 0, maximum: 0xffff_ffff },
});
const MAX_STREAM_CHUNKS = 262_144;

const SPEC_KEYS = [
	"version",
	"scenario",
	"seed",
	"size",
	"chunkBytes",
	"delayMs",
	"rounds",
	"parallel",
];

export const DEFAULT_SPEC = Object.freeze({
	version: SCENARIO_SPEC_VERSION,
	scenario: "baseline",
	seed: 1,
	size: 1,
	chunkBytes: 16 * 1024 * 1024,
	delayMs: 0,
	rounds: 1,
	parallel: 1,
});

export const PRESSURE_PROFILES = Object.freeze({
	ci: Object.freeze([
		{ scenario: "baseline" },
		{ scenario: "text", seed: 11, size: 256 * 1024, chunkBytes: 1024 },
		{
			scenario: "text",
			seed: 12,
			size: 128 * 1024,
			chunkBytes: 1,
		},
		{
			scenario: "tool-arguments",
			seed: 21,
			size: 128 * 1024,
			chunkBytes: 257,
		},
		{
			scenario: "editor-old-text",
			seed: 31,
			size: 10_000,
			chunkBytes: 509,
		},
		{ scenario: "parallel-tools", seed: 41, parallel: 8 },
	]),
	large: Object.freeze([
		{ scenario: "text", seed: 101, size: 8 * 1024 * 1024, chunkBytes: 1024 },
		{ scenario: "text", seed: 102, size: 128 * 1024, chunkBytes: 1 },
		{
			scenario: "tool-arguments",
			seed: 103,
			size: 4 * 1024 * 1024,
			chunkBytes: 4093,
		},
		{
			scenario: "editor-old-text",
			seed: 104,
			size: 250_000,
			chunkBytes: 4093,
		},
		{ scenario: "parallel-tools", seed: 105, parallel: 32 },
	]),
	extreme: Object.freeze([
		{
			scenario: "text",
			seed: 201,
			size: 64 * 1024 * 1024,
			chunkBytes: 16 * 1024 * 1024,
		},
		{ scenario: "text", seed: 202, size: 256 * 1024, chunkBytes: 1 },
		{
			scenario: "tool-arguments",
			seed: 203,
			size: 16 * 1024 * 1024,
			chunkBytes: 8191,
		},
		{
			scenario: "editor-old-text",
			seed: 204,
			size: 1_000_001,
			chunkBytes: 8191,
		},
		{ scenario: "parallel-tools", seed: 205, parallel: 128 },
	]),
});

export function normalizeScenarioSpec(input = {}) {
	if (!input || typeof input !== "object" || Array.isArray(input)) {
		throw new Error("Scenario spec must be an object");
	}
	const unknownKeys = Object.keys(input).filter(
		(key) => !SPEC_KEYS.includes(key),
	);
	if (unknownKeys.length > 0) {
		throw new Error(
			`Unknown scenario spec field(s): ${unknownKeys.join(", ")}`,
		);
	}
	const spec = { ...DEFAULT_SPEC, ...input };
	if (spec.version !== SCENARIO_SPEC_VERSION) {
		throw new Error(
			`Unsupported scenario spec version ${JSON.stringify(spec.version)}; expected ${SCENARIO_SPEC_VERSION}`,
		);
	}
	if (!SCENARIO_KINDS.has(spec.scenario)) {
		throw new Error(`Unknown scenario: ${JSON.stringify(spec.scenario)}`);
	}
	for (const [field, bounds] of Object.entries(LIMITS)) {
		assertBoundedInteger(field, spec[field], bounds.minimum, bounds.maximum);
	}
	const estimatedChunks = Math.ceil(spec.size / spec.chunkBytes);
	if (estimatedChunks > MAX_STREAM_CHUNKS) {
		throw new Error(
			`Scenario would emit approximately ${estimatedChunks} payload chunks, exceeding the limit of ${MAX_STREAM_CHUNKS}; increase chunkBytes or reduce size`,
		);
	}
	if (spec.rounds > 1 && spec.scenario !== "baseline") {
		throw new Error(
			"Only the bounded baseline callback scenario supports multiple rounds; payload pressure scenarios must use rounds=1",
		);
	}
	return Object.freeze(
		Object.fromEntries(SPEC_KEYS.map((key) => [key, spec[key]])),
	);
}

export function encodeReplayToken(input) {
	const spec = normalizeScenarioSpec(input);
	return Buffer.from(JSON.stringify(spec)).toString("base64url");
}

export function decodeReplayToken(token) {
	if (typeof token !== "string" || !/^[A-Za-z0-9_-]{1,2048}$/.test(token)) {
		throw new Error("Replay token must be 1-2048 base64url characters");
	}
	let parsed;
	try {
		parsed = JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
	} catch {
		throw new Error("Replay token is not valid encoded JSON");
	}
	const spec = normalizeScenarioSpec(parsed);
	if (encodeReplayToken(spec) !== token) {
		throw new Error("Replay token is not canonical");
	}
	return spec;
}

export function replayModel(input) {
	return `harness/replay-${encodeReplayToken(input)}`;
}

export function replaySpecFromModel(model) {
	if (typeof model !== "string") return undefined;
	const match = /^harness\/replay-([A-Za-z0-9_-]+)$/.exec(model);
	return match ? decodeReplayToken(match[1]) : undefined;
}

export function scenarioFingerprint(input) {
	return createHash("sha256")
		.update(encodeReplayToken(input))
		.digest("hex")
		.slice(0, 16);
}

export function profileSpecs(profile) {
	const entries = PRESSURE_PROFILES[profile];
	if (!entries) {
		throw new Error(
			`Unknown pressure profile ${JSON.stringify(profile)}; expected ${Object.keys(PRESSURE_PROFILES).join(", ")}`,
		);
	}
	return entries.map(normalizeScenarioSpec);
}

export function requiresExtremeOptIn(input) {
	const spec = normalizeScenarioSpec(input);
	return (
		spec.size > 8 * 1024 * 1024 ||
		spec.parallel > 32 ||
		Math.ceil(spec.size / spec.chunkBytes) > 131_072
	);
}

export function deterministicText(size, seed) {
	assertBoundedInteger("size", size, LIMITS.size.minimum, LIMITS.size.maximum);
	assertBoundedInteger("seed", seed, LIMITS.seed.minimum, LIMITS.seed.maximum);
	let state = seed || 0x6d2b79f5;
	// Generated pressure payloads stay ASCII so `chunkBytes: 1` means exactly
	// one byte per model delta. splitUtf8 is tested separately with multibyte
	// text to keep Unicode boundaries safe without muddying the chunk-count axis.
	const alphabet = Array.from(
		"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 \n",
	);
	const pieces = [];
	let remaining = size;
	while (remaining > 0) {
		const length = Math.min(remaining, 64 * 1024);
		const characters = [];
		let pieceBytes = 0;
		while (pieceBytes < length) {
			state = (Math.imul(state ^ (state >>> 15), 1 | state) + 0x6d2b79f5) >>> 0;
			const character = alphabet[state % alphabet.length];
			const characterBytes = Buffer.byteLength(character);
			if (pieceBytes + characterBytes > length) {
				characters.push("x".repeat(length - pieceBytes));
				pieceBytes = length;
				break;
			}
			characters.push(character);
			pieceBytes += characterBytes;
		}
		const piece = characters.join("");
		pieces.push(piece);
		remaining -= pieceBytes;
	}
	return pieces.join("");
}

export function* splitUtf8(text, maximumBytes) {
	assertBoundedInteger(
		"chunkBytes",
		maximumBytes,
		LIMITS.chunkBytes.minimum,
		LIMITS.chunkBytes.maximum,
	);
	const segmentLimit = Math.min(maximumBytes, 64 * 1024);
	let pieces = [];
	let segmentCharacters = [];
	let segmentBytes = 0;
	let chunkBytes = 0;
	const flushSegment = () => {
		if (segmentCharacters.length > 0) {
			pieces.push(segmentCharacters.join(""));
			segmentCharacters = [];
			segmentBytes = 0;
		}
	};
	for (const character of text) {
		const bytes = Buffer.byteLength(character);
		if (chunkBytes > 0 && chunkBytes + bytes > maximumBytes) {
			flushSegment();
			yield pieces.join("");
			pieces = [];
			chunkBytes = 0;
		}
		segmentCharacters.push(character);
		segmentBytes += bytes;
		chunkBytes += bytes;
		if (segmentBytes >= segmentLimit) flushSegment();
	}
	flushSegment();
	if (pieces.length > 0) yield pieces.join("");
}

function assertBoundedInteger(field, value, minimum, maximum) {
	if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
		throw new Error(
			`${field} must be an integer from ${minimum} to ${maximum}; received ${JSON.stringify(value)}`,
		);
	}
}
