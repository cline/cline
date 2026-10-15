import { FACTS_BUDGET_MS, PROBE_BUDGET_MS } from "../config";
import { withinBudget } from "../deadline";
import type { ContextSource, Facts, SourceEnv, SourceState } from "./source";

/**
 * The environment manifest: which sources are
 * present, unknown, absent or off this run, and which capabilities the
 * planner may name. It decides the planner's sections, the kinds that may be
 * offered and, as tags on each offer record, how pick rate is compared across
 * environments.
 */
export type Manifest = Pick<SourceEnv, "client" | "mode"> & {
	sources: Record<string, SourceState>;
	capabilities: string[];
};

export function isPresent(
	manifest: Pick<Manifest, "sources">,
	sourceId: string,
): boolean {
	return manifest.sources[sourceId] === "present";
}

/** Overrides the per-tier budget of a probe or a facts read, for tests. */
type BudgetOverride = (source: ContextSource) => number;

type ManifestOptions = {
	/** Sources the person turned off; they are recorded as `off` and never probed. */
	isOff?: (source: ContextSource) => boolean;
	budgetMs?: BudgetOverride;
};

async function probe(
	source: ContextSource,
	env: SourceEnv,
	options: ManifestOptions,
): Promise<SourceState> {
	if (options.isOff?.(source)) return "off";
	const budget = options.budgetMs?.(source) ?? PROBE_BUDGET_MS[source.tier];
	return withinBudget<SourceState>(() => source.probe(env), budget, "unknown");
}

function capabilitiesOf(source: ContextSource, env: SourceEnv): string[] {
	try {
		return source.capabilities?.(env) ?? [];
	} catch {
		return [];
	}
}

function presentCapabilities(
	sources: readonly ContextSource[],
	states: Record<string, SourceState>,
	env: SourceEnv,
): string[] {
	return [
		...new Set(
			sources.flatMap((source) =>
				states[source.id] === "present" ? capabilitiesOf(source, env) : [],
			),
		),
	].sort();
}

/** Probe every source in parallel, each under its budget; a throw or a timeout reads as unknown. */
export async function buildManifest(
	sources: readonly ContextSource[],
	env: SourceEnv,
	options: ManifestOptions = {},
): Promise<Manifest> {
	const probed = await Promise.all(
		sources.map(async (source) => ({
			source,
			state: await probe(source, env, options),
		})),
	);
	const states = Object.fromEntries(
		probed.map(({ source, state }) => [source.id, state]),
	);
	return {
		client: env.client,
		mode: env.mode,
		sources: states,
		capabilities: presentCapabilities(sources, states, env),
	};
}

/**
 * The manifest as a later planner call on the same turn should see it: every
 * source `isOff` now refuses is marked off, and the capabilities are read
 * again from the sources still present, so a source turned off or a script
 * removed since the turn is neither read nor named.
 */
export function withCurrentSources(
	manifest: Manifest,
	sources: readonly ContextSource[],
	env: SourceEnv,
	isOff: (source: ContextSource) => boolean,
): Manifest {
	const states: Record<string, SourceState> = Object.fromEntries(
		Object.entries(manifest.sources).map(([id, state]) => {
			const source = sources.find((candidate) => candidate.id === id);
			return [id, source && isOff(source) ? "off" : state];
		}),
	);
	return {
		...manifest,
		sources: states,
		capabilities: presentCapabilities(sources, states, env),
	};
}

/**
 * The manifest as flat tags for the offer record, each a label token
 * (`source:tasks:present`, `cap:github`). Ids and states only, never content,
 * so pick rate can be sliced by environment and each source ablated in replay.
 */
export function manifestTags(manifest: Manifest): string[] {
	const tags = Object.entries(manifest.sources)
		.map(([id, state]) => `source:${id}:${state}`)
		.sort();
	for (const capability of manifest.capabilities)
		tags.push(`cap:${capability}`);
	if (manifest.client) tags.push(`client:${manifest.client}`);
	if (manifest.mode) tags.push(`mode:${manifest.mode}`);
	return tags;
}

type FactsSource = ContextSource & Required<Pick<ContextSource, "facts">>;

/**
 * The facts of every present source, each under its tier's budget, in
 * parallel. Absent and off sources are not asked and leave no entry, so the
 * planner says nothing about them. A throw or a timeout reads as `unknown`.
 */
export async function collectFacts(
	sources: readonly ContextSource[],
	manifest: Manifest,
	env: SourceEnv,
	options: { budgetMs?: BudgetOverride } = {},
): Promise<Record<string, Facts | "unknown">> {
	const asked = sources.filter(
		(source): source is FactsSource =>
			source.facts !== undefined && isPresent(manifest, source.id),
	);
	return Object.fromEntries(
		await Promise.all(
			asked.map(async (source) => {
				const budget =
					options.budgetMs?.(source) ?? FACTS_BUDGET_MS[source.tier];
				const facts = await withinBudget<Facts | "unknown">(
					() => source.facts(env, budget),
					budget,
					"unknown",
				);
				return [source.id, facts] as const;
			}),
		),
	);
}
