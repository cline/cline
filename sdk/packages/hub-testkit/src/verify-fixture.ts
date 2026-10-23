/**
 * Fixture verification used by the contract suite.
 *
 * Default behaviour is verify-only: a scenario whose canonical transcript no
 * longer matches the committed fixture fails the test instead of silently
 * rewriting it. `HUB_TESTKIT_UPDATE_FIXTURES=1` (i.e. `bun run record:update`)
 * flips it to write mode. A missing fixture is always written so a brand-new
 * scenario bootstraps itself.
 */

import type { CanonicalizeOptions, RecordedFrame } from "./canonicalize";
import {
	fixturePath,
	fixtureUpdateEnabled,
	readFixtureBytes,
	resolveGeneratedBy,
	writeFixtureIfChanged,
} from "./fixture";
import {
	buildFixture,
	type HubFixture,
	serializeFixture,
} from "./fixture-format";

export interface VerifyFixtureInput extends CanonicalizeOptions {
	scenario: string;
	description?: string;
	frames: RecordedFrame[];
	/** Non-frame scenario result (typed errors, hydrated transcripts). */
	outcome?: unknown;
	dir?: string;
	update?: boolean;
	/** Provenance stamp; defaults to `resolveGeneratedBy()`. */
	generatedBy?: string;
}

export interface VerifyFixtureResult {
	fixture: HubFixture;
	path: string;
	outcome: "created" | "updated" | "unchanged";
}

export async function verifyFixture(
	input: VerifyFixtureInput,
): Promise<VerifyFixtureResult> {
	const fixture = buildFixture({
		scenario: input.scenario,
		description: input.description,
		frames: input.frames,
		outcome: input.outcome,
		generatedBy: input.generatedBy ?? resolveGeneratedBy(),
		recordRegisterHandshake: input.recordRegisterHandshake,
	});
	const path = fixturePath(input.scenario, input.dir);
	const existing = await readFixtureBytes(input.scenario, input.dir);
	const update = input.update ?? fixtureUpdateEnabled() ?? false;
	const outcome = await writeFixtureIfChanged(fixture, {
		dir: input.dir,
		update: update || existing === undefined,
	});
	if (outcome === "mismatch") {
		throw new Error(
			[
				`Fixture drift for scenario "${input.scenario}".`,
				`Expected (committed): ${path}`,
				"Re-run with HUB_TESTKIT_UPDATE_FIXTURES=1 (bun -F @cline/hub-testkit record:update) to accept.",
				"(`generatedBy` is excluded from this comparison; a differing stamp alone is never drift.)",
				"--- actual ---",
				serializeFixture(fixture),
			].join("\n"),
		);
	}
	return { fixture, path, outcome };
}
