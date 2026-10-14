import { FACTS_BUDGET_MS, PROBE_BUDGET_MS } from "../config";
import type { ContextSource, Facts, SourceEnv, SourceState } from "./source";

/**
 * The environment manifest: which sources are
 * present, unknown, absent or off this run, and which capabilities the
 * planner may name. It decides the planner's sections, the kinds that may be
 * offered and, as tags on each offer record, how pick rate is compared across
 * environments.
 */
export type Manifest = {
	client?: string;
	mode?: "act" | "plan";
	sources: Record<string, SourceState>;
	capabilities: string[];
};

export type ManifestOptions = {
	/** Sources the person turned off; they are recorded as `off` and never probed. */
	isOff?: (sourceId: string) => boolean;
	/** Overrides the per-tier probe budget, for tests. */
	budgetMs?: (source: ContextSource) => number;
};

const UNKNOWN: SourceState = "unknown";

/** Resolves with `onTimeout` when the work throws or outlasts the budget. */
export function withinBudget<T>(
	work: () => Promise<T> | T,
	budgetMs: number,
	onTimeout: T,
): Promise<T> {
	return new Promise<T>((resolve) => {
		const timer = setTimeout(() => resolve(onTimeout), budgetMs);
		Promise.resolve()
			.then(work)
			.then(
				(value) => {
					clearTimeout(timer);
					resolve(value);
				},
				() => {
					clearTimeout(timer);
					resolve(onTimeout);
				},
			);
	});
}

async function probe(
	source: ContextSource,
	env: SourceEnv,
	options: ManifestOptions,
): Promise<SourceState> {
	if (options.isOff?.(source.id)) return "off";
	const budget = options.budgetMs?.(source) ?? PROBE_BUDGET_MS[source.tier];
	return withinBudget(() => source.probe(env), budget, UNKNOWN);
}

function capabilitiesOf(source: ContextSource, env: SourceEnv): string[] {
	try {
		return source.capabilities?.(env) ?? [];
	} catch {
		return [];
	}
}

/** Probe every source in parallel, each under its budget; a throw or a timeout reads as unknown. */
export async function buildManifest(
	sources: readonly ContextSource[],
	env: SourceEnv,
	options: ManifestOptions = {},
): Promise<Manifest> {
	const states = await Promise.all(
		sources.map((source) => probe(source, env, options)),
	);
	const manifest: Manifest = {
		client: env.client,
		mode: env.mode,
		sources: {},
		capabilities: [],
	};
	const capabilities = new Set<string>();
	sources.forEach((source, index) => {
		const state = states[index] ?? UNKNOWN;
		manifest.sources[source.id] = state;
		if (state === "present")
			for (const tag of capabilitiesOf(source, env)) capabilities.add(tag);
	});
	manifest.capabilities = [...capabilities].sort();
	return manifest;
}

/** The sources the planner may mention: present or unknown. Absent and off ones are never named. */
export function nameableSources(manifest: Manifest): string[] {
	return Object.entries(manifest.sources)
		.filter(([, state]) => state === "present" || state === "unknown")
		.map(([id]) => id)
		.sort();
}

/**
 * The manifest as flat tags for the offer record (ADR-0021), each a label
 * token (`source:tasks:present`, `cap:github`). Ids and states only, never content, so pick rate can be sliced by environment and each
 * source ablated in replay.
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

export type FactsOptions = {
	/** Overrides the per-tier facts budget, for tests. */
	budgetMs?: (source: ContextSource) => number;
};

/**
 * The facts of every present source, each under its tier's budget, in
 * parallel. Absent and off sources are not asked and leave no entry, so the
 * planner says nothing about them. A throw or a timeout reads as `unknown`
 *.
 */
export async function collectFacts(
	sources: readonly ContextSource[],
	manifest: Manifest,
	env: SourceEnv,
	options: FactsOptions = {},
): Promise<Record<string, Facts | "unknown">> {
	const asked = sources.filter(
		(source) => source.facts && manifest.sources[source.id] === "present",
	);
	const results = await Promise.all(
		asked.map((source) => {
			const budget = options.budgetMs?.(source) ?? FACTS_BUDGET_MS[source.tier];
			return withinBudget<Facts | "unknown">(
				() => source.facts?.(env, budget) ?? "unknown",
				budget,
				"unknown",
			);
		}),
	);
	const facts: Record<string, Facts | "unknown"> = {};
	asked.forEach((source, index) => {
		facts[source.id] = results[index] ?? "unknown";
	});
	return facts;
}
