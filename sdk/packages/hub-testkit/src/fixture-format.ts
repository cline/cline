/**
 * Fixture shape and (de)serialization.
 *
 * Deliberately free of node builtins so the replay entry point
 * (`@cline/hub-testkit/replay`) can be imported from browser/jsdom UI tests.
 * Filesystem access lives in `./fixture`, which is node-only.
 */

import {
	type CanonicalFrame,
	type CanonicalizeOptions,
	canonicalizeTranscript,
	FIXTURE_SCHEMA,
	type RecordedFrame,
} from "./canonicalize";

export interface HubFixture {
	/** Format marker; bump when the fixture layout changes. */
	schema: typeof FIXTURE_SCHEMA;
	/**
	 * Provenance of the recording — which build produced these bytes. Excluded
	 * from the determinism comparison (see {@link fixtureComparisonBytes}), so it
	 * moves only when the transcript itself does.
	 */
	generatedBy: string;
	scenario: string;
	description?: string;
	frames: CanonicalFrame[];
	/**
	 * Canonicalized scenario result that is not itself a frame — e.g. the typed
	 * error a rejected command surfaced to the caller. Shares id placeholders
	 * with `frames`.
	 */
	outcome?: unknown;
}

/**
 * Fallback provenance, used when nothing better is available (no git checkout, no
 * `HUB_TESTKIT_GENERATED_BY`). The node layer's `resolveGeneratedBy()` prefers a
 * real `git describe`; re-records stay byte-identical anyway because provenance
 * is excluded from the comparison.
 */
export const DEFAULT_GENERATED_BY = "experiment";

/**
 * Stand-in substituted for `generatedBy` when comparing two serializations.
 * Never written to disk.
 */
const PROVENANCE_PLACEHOLDER = "<generatedBy>";

export function buildFixture(
	input: CanonicalizeOptions & {
		scenario: string;
		description?: string;
		frames: RecordedFrame[];
		outcome?: unknown;
		generatedBy?: string;
	},
): HubFixture {
	const canonical = canonicalizeTranscript({
		frames: input.frames,
		outcome: input.outcome,
		recordRegisterHandshake: input.recordRegisterHandshake,
	});
	return {
		schema: FIXTURE_SCHEMA,
		generatedBy: input.generatedBy ?? DEFAULT_GENERATED_BY,
		scenario: input.scenario,
		...(input.description ? { description: input.description } : {}),
		frames: canonical.frames,
		...(canonical.outcome === undefined ? {} : { outcome: canonical.outcome }),
	};
}

/**
 * Deterministic serialization: fixed key order, trailing newline, and tab
 * indentation so the repo formatter (biome, `indentStyle: "tab"`) leaves the
 * committed fixtures byte-for-byte alone. If the formatter rewrote them, the
 * next re-record would report drift for every scenario.
 */
export function serializeFixture(fixture: HubFixture): string {
	const ordered = {
		schema: fixture.schema,
		generatedBy: fixture.generatedBy,
		scenario: fixture.scenario,
		...(fixture.description ? { description: fixture.description } : {}),
		frames: fixture.frames.map((frame) => ({
			direction: frame.direction,
			label: frame.label,
			frame: frame.frame,
		})),
		...(fixture.outcome === undefined ? {} : { outcome: fixture.outcome }),
	};
	return `${JSON.stringify(ordered, null, "\t")}\n`;
}

/**
 * Serialization used to decide whether a re-record changed anything.
 *
 * `generatedBy` is neutralized here on purpose: it names the build that produced
 * the recording, so leaving it in the comparison would make every commit look
 * like fixture drift and rewrite all nine files on each `record` run. Comparing
 * without it means the committed stamp keeps naming the build whose *transcript*
 * is on disk, and only real protocol drift rewrites a fixture.
 */
export function fixtureComparisonBytes(fixture: HubFixture): string {
	return serializeFixture({
		...fixture,
		generatedBy: PROVENANCE_PLACEHOLDER,
	});
}

/**
 * {@link fixtureComparisonBytes} for a fixture already serialized to text, or
 * `undefined` when the text is not a fixture this build understands (a hand-edited
 * file, an older schema) — which counts as "differs".
 */
export function serializedFixtureComparisonBytes(
	text: string,
): string | undefined {
	try {
		const parsed = JSON.parse(text) as HubFixture;
		if (parsed?.schema !== FIXTURE_SCHEMA || !Array.isArray(parsed.frames)) {
			return undefined;
		}
		return fixtureComparisonBytes(parsed);
	} catch {
		return undefined;
	}
}
