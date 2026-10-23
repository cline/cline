/**
 * Node-only fixture filesystem layer.
 *
 * Fixtures are committed, so writing is idempotent: re-recording an unchanged
 * scenario compares bytes (ignoring the `generatedBy` provenance stamp) and
 * leaves the file, and its mtime, alone. The fixture shape itself lives in
 * `./fixture-format`, which stays node-free for browser UI tests.
 */

import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	DEFAULT_GENERATED_BY,
	fixtureComparisonBytes,
	type HubFixture,
	serializedFixtureComparisonBytes,
	serializeFixture,
} from "./fixture-format";

export {
	buildFixture,
	DEFAULT_GENERATED_BY,
	fixtureComparisonBytes,
	type HubFixture,
	serializedFixtureComparisonBytes,
	serializeFixture,
} from "./fixture-format";

export const DEFAULT_FIXTURE_DIR = join(
	dirname(dirname(fileURLToPath(import.meta.url))),
	"fixtures",
	"hub-v1",
);

/** Resolved at most once per process; `null` records "asked, not a git checkout". */
let cachedGitDescription: string | null | undefined;

/**
 * `git describe` of the tree being recorded. Read-only, and best-effort: a
 * published tarball or exported source tree has no `.git`, so this returns
 * undefined and the caller falls back to {@link DEFAULT_GENERATED_BY}.
 */
function gitDescription(): string | undefined {
	if (cachedGitDescription !== undefined) {
		return cachedGitDescription ?? undefined;
	}
	try {
		const described = execFileSync("git", ["describe", "--always", "--dirty"], {
			cwd: dirname(DEFAULT_FIXTURE_DIR),
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
		cachedGitDescription = described || null;
	} catch {
		cachedGitDescription = null;
	}
	return cachedGitDescription ?? undefined;
}

/**
 * Provenance stamp for a recording: the `HUB_TESTKIT_GENERATED_BY` override, else
 * the recording tree's `git describe`, else a stable literal. Safe to move every
 * commit because `writeFixtureIfChanged` compares fixtures without it.
 */
export function resolveGeneratedBy(): string {
	return (
		process.env.HUB_TESTKIT_GENERATED_BY?.trim() ||
		gitDescription() ||
		DEFAULT_GENERATED_BY
	);
}

export function fixtureUpdateEnabled(): boolean {
	const raw = process.env.HUB_TESTKIT_UPDATE_FIXTURES?.trim();
	return raw === "1" || raw === "true";
}

export function fixturePath(
	scenario: string,
	dir = DEFAULT_FIXTURE_DIR,
): string {
	return join(dir, `${scenario}.json`);
}

export async function readFixture(
	scenario: string,
	dir = DEFAULT_FIXTURE_DIR,
): Promise<HubFixture | undefined> {
	try {
		return JSON.parse(
			await readFile(fixturePath(scenario, dir), "utf8"),
		) as HubFixture;
	} catch {
		return undefined;
	}
}

export async function readFixtureBytes(
	scenario: string,
	dir = DEFAULT_FIXTURE_DIR,
): Promise<string | undefined> {
	try {
		return await readFile(fixturePath(scenario, dir), "utf8");
	} catch {
		return undefined;
	}
}

export type FixtureWriteResult =
	| "created"
	| "updated"
	| "unchanged"
	| "mismatch";

/**
 * Writes only when the transcript actually differs.
 *
 * The comparison ignores `generatedBy` (see `fixtureComparisonBytes`), so
 * re-recording on a different commit is a no-op rather than a nine-file rewrite,
 * and the committed stamp always names the build whose transcript is on disk.
 *
 * With `update: false` a differing fixture is reported as `mismatch` and left on
 * disk, which is how the contract suite fails a drifted scenario in CI instead
 * of silently rewriting it.
 */
export async function writeFixtureIfChanged(
	fixture: HubFixture,
	options: { dir?: string; update?: boolean } = {},
): Promise<FixtureWriteResult> {
	const dir = options.dir ?? DEFAULT_FIXTURE_DIR;
	const update = options.update ?? true;
	const path = fixturePath(fixture.scenario, dir);
	const next = serializeFixture(fixture);
	const current = await readFile(path, "utf8").catch(() => undefined);
	if (
		current !== undefined &&
		serializedFixtureComparisonBytes(current) ===
			fixtureComparisonBytes(fixture)
	) {
		return "unchanged";
	}
	if (!update) {
		return "mismatch";
	}
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, next, "utf8");
	return current === undefined ? "created" : "updated";
}
