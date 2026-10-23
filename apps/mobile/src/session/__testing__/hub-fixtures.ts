/**
 * Test-only helpers for the committed `hub-v1` fixtures.
 *
 * Imported exclusively from `*.test.ts`, so nothing here reaches the app bundle
 * (`@cline/hub-testkit` is a devDependency and its node entry point touches node
 * builtins).
 */

import { readdir } from "node:fs/promises";
import {
	DEFAULT_FIXTURE_DIR,
	type HubFixture,
	readFixture,
} from "@cline/hub-testkit";
import type { HubEventEnvelope } from "@cline/shared";

export type FixtureScenario = string;

/**
 * Every scenario committed under `sdk/packages/hub-testkit/fixtures/hub-v1`,
 * read off disk rather than duplicated here: a fixture added upstream is then
 * covered by the invariant sweeps in `reducer.test.ts` automatically, and a
 * renamed one fails loudly instead of silently dropping out of the sweep.
 */
export async function listFixtureScenarios(): Promise<FixtureScenario[]> {
	const entries = await readdir(DEFAULT_FIXTURE_DIR);
	return entries
		.filter((entry) => entry.endsWith(".json"))
		.map((entry) => entry.slice(0, -".json".length))
		.sort();
}

export async function loadFixture(
	scenario: FixtureScenario,
): Promise<HubFixture> {
	const fixture = await readFixture(scenario);
	if (!fixture) {
		throw new Error(`Missing hub-v1 fixture: ${scenario}`);
	}
	return fixture;
}

/** Inbound event envelopes of a fixture, in recorded wire order. */
export function fixtureEventEnvelopes(fixture: HubFixture): HubEventEnvelope[] {
	return fixture.frames
		.filter((frame) => frame.direction === "in" && frame.frame.kind === "event")
		.map((frame) => (frame.frame as { envelope: HubEventEnvelope }).envelope);
}

export async function fixtureEvents(
	scenario: FixtureScenario,
): Promise<HubEventEnvelope[]> {
	return fixtureEventEnvelopes(await loadFixture(scenario));
}

/** The `session.messages` reply a fixture recorded, if it made that call. */
export function fixtureHydrateReply(
	fixture: HubFixture,
): Record<string, unknown> | undefined {
	for (const frame of fixture.frames) {
		if (frame.direction !== "in" || frame.frame.kind !== "reply") {
			continue;
		}
		const payload = (
			frame.frame as { envelope: { payload?: Record<string, unknown> } }
		).envelope.payload;
		if (payload && Array.isArray(payload.messages)) {
			return payload;
		}
	}
	return undefined;
}
