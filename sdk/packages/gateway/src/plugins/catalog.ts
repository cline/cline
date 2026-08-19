/**
 * Plugin catalog (Gateway RFC, Phase 4).
 *
 * The Gateway discovers and validates global, bot, and workspace plugins
 * and imports them once into an immutable catalog generation. A reload
 * reconciles files first and publishes the new generation atomically only
 * after reconciliation succeeded; a failed reload keeps the prior healthy
 * generation serving and reports a diagnostic. Unchanged plugins (same
 * resolved root, same content fingerprint) are never re-imported — the
 * previous generation's frozen entry is reused.
 *
 * Active runs pin the generation they started with; pinned generations
 * survive later publishes until every pin is released.
 */

import { readdirSync, realpathSync, statSync } from "node:fs";
import { join } from "node:path";
import type { BotId } from "@cline/shared/gateway";
import { fingerprintPluginDir, type LoadedPlugin, loadPlugin } from "./loader";
import type { PluginDiagnostic } from "./manifest";

export type PluginScope =
	| { readonly kind: "global" }
	| { readonly kind: "bot"; readonly botId: BotId }
	| { readonly kind: "workspace"; readonly workspaceRoot: string };

export function pluginScopeKey(scope: PluginScope): string {
	switch (scope.kind) {
		case "global":
			return "global";
		case "bot":
			return `bot:${scope.botId}`;
		case "workspace":
			return `workspace:${scope.workspaceRoot}`;
	}
}

/** One discovery source: a directory whose children are plugin roots. */
export interface PluginSource {
	readonly scope: PluginScope;
	readonly dir: string;
}

export interface CatalogEntry {
	readonly scope: PluginScope;
	readonly plugin: LoadedPlugin;
}

export interface CatalogDiagnostic extends PluginDiagnostic {
	readonly pluginRoot: string;
	readonly scopeKey: string;
}

export interface CatalogGenerationSnapshot {
	readonly generation: number;
	readonly publishedAt: number;
	readonly entries: readonly CatalogEntry[];
	/** Diagnostics gathered during the reconciliation that published this. */
	readonly diagnostics: readonly CatalogDiagnostic[];
}

export interface CatalogPin {
	readonly snapshot: CatalogGenerationSnapshot;
	release(): void;
}

export interface PluginCatalogOptions {
	sources?: readonly PluginSource[];
	clock?: () => number;
	/** Called after a generation publishes (e.g. bump the durable counter). */
	onPublish?: (snapshot: CatalogGenerationSnapshot) => void;
}

interface HeldGeneration {
	readonly snapshot: CatalogGenerationSnapshot;
	pins: number;
}

export interface CatalogReloadReport {
	readonly ok: boolean;
	readonly generation: number;
	/** Plugin roots imported fresh during this reconciliation. */
	readonly imported: readonly string[];
	/** Plugin roots reused from the prior generation (unchanged). */
	readonly reused: readonly string[];
	readonly diagnostics: readonly CatalogDiagnostic[];
	/** Set when the reload failed and the prior generation kept serving. */
	readonly error?: string;
}

const EMPTY_GENERATION: CatalogGenerationSnapshot = Object.freeze({
	generation: 0,
	publishedAt: 0,
	entries: Object.freeze([]) as unknown as readonly CatalogEntry[],
	diagnostics: Object.freeze([]) as unknown as readonly CatalogDiagnostic[],
});

export class PluginCatalog {
	private sources: readonly PluginSource[];
	private readonly clock: () => number;
	private readonly onPublish: (snapshot: CatalogGenerationSnapshot) => void;
	private readonly held = new Map<number, HeldGeneration>();
	private currentGeneration: CatalogGenerationSnapshot = EMPTY_GENERATION;
	private nextGeneration = 1;
	private lastReload: CatalogReloadReport | undefined;
	/** Total fresh imports (observability + no-re-import tests). */
	importCount = 0;

	constructor(options: PluginCatalogOptions = {}) {
		this.sources = options.sources ?? [];
		this.clock = options.clock ?? (() => Date.now());
		this.onPublish = options.onPublish ?? (() => {});
		this.held.set(0, { snapshot: this.currentGeneration, pins: 0 });
	}

	get current(): CatalogGenerationSnapshot {
		return this.currentGeneration;
	}

	get lastReloadReport(): CatalogReloadReport | undefined {
		return this.lastReload;
	}

	/** Replace the discovery sources (new bot/workspace registration). */
	setSources(sources: readonly PluginSource[]): void {
		this.sources = sources;
	}

	addSource(source: PluginSource): void {
		this.sources = [...this.sources, source];
	}

	/**
	 * Pin the current generation for an active run. The generation object
	 * stays alive — and identical — until the pin is released, regardless
	 * of how many reloads publish in between.
	 */
	pin(): CatalogPin {
		const snapshot = this.currentGeneration;
		const held = this.held.get(snapshot.generation);
		if (!held) {
			throw new Error(
				`invariant violation: current generation ${snapshot.generation} is not held`,
			);
		}
		held.pins += 1;
		let released = false;
		return {
			snapshot,
			release: () => {
				if (released) {
					return;
				}
				released = true;
				held.pins -= 1;
				this.collect();
			},
		};
	}

	/** Generations currently retained (current + pinned). */
	heldGenerations(): readonly number[] {
		return [...this.held.keys()].sort((a, b) => a - b);
	}

	/**
	 * Reconcile files and atomically publish a new immutable generation.
	 * On failure the prior generation keeps serving and the report (and
	 * `lastReloadReport`) carries the diagnostic.
	 */
	reload(): CatalogReloadReport {
		const previousByRoot = new Map<string, CatalogEntry>();
		for (const entry of this.currentGeneration.entries) {
			previousByRoot.set(
				`${pluginScopeKey(entry.scope)}\u0000${entry.plugin.rootPath}`,
				entry,
			);
		}
		const entries: CatalogEntry[] = [];
		const diagnostics: CatalogDiagnostic[] = [];
		const imported: string[] = [];
		const reused: string[] = [];
		try {
			for (const source of this.sources) {
				for (const rootDir of listPluginRoots(source.dir)) {
					const scopeKey = pluginScopeKey(source.scope);
					const previous = previousByRoot.get(`${scopeKey}\u0000${rootDir}`);
					if (
						previous &&
						fingerprintPluginDir(previous.plugin.rootPath) ===
							previous.plugin.fingerprint
					) {
						// Unchanged: reuse the imported, frozen entry as-is.
						entries.push(previous);
						reused.push(previous.plugin.rootPath);
						continue;
					}
					const result = loadPlugin(rootDir);
					if (!result.ok) {
						// An invalid plugin is isolated at the plugin boundary:
						// the rest of the generation still publishes.
						for (const diag of result.diagnostics) {
							diagnostics.push({
								...diag,
								pluginRoot: result.rootPath,
								scopeKey,
							});
						}
						continue;
					}
					for (const diag of result.plugin.diagnostics) {
						diagnostics.push({
							...diag,
							pluginRoot: result.plugin.rootPath,
							scopeKey,
						});
					}
					const entry: CatalogEntry = Object.freeze({
						scope: source.scope,
						plugin: result.plugin,
					});
					entries.push(entry);
					imported.push(result.plugin.rootPath);
					this.importCount += 1;
				}
			}
			// Duplicate plugin names within one scope are isolated: first wins.
			const seen = new Map<string, CatalogEntry>();
			const deduped: CatalogEntry[] = [];
			for (const entry of entries) {
				const key = `${pluginScopeKey(entry.scope)}\u0000${entry.plugin.manifest.name}`;
				if (seen.has(key)) {
					diagnostics.push({
						severity: "warning",
						code: "catalog.duplicate_plugin_name",
						message: `Duplicate plugin name "${entry.plugin.manifest.name}" in scope ${pluginScopeKey(entry.scope)}; later copy ignored`,
						boundary: "plugin",
						pluginRoot: entry.plugin.rootPath,
						scopeKey: pluginScopeKey(entry.scope),
					});
					continue;
				}
				seen.set(key, entry);
				deduped.push(entry);
			}

			// Reconciliation succeeded: atomically publish the new generation.
			const snapshot: CatalogGenerationSnapshot = Object.freeze({
				generation: this.nextGeneration,
				publishedAt: this.clock(),
				entries: Object.freeze(deduped) as readonly CatalogEntry[],
				diagnostics: Object.freeze(diagnostics) as readonly CatalogDiagnostic[],
			});
			this.nextGeneration += 1;
			this.held.set(snapshot.generation, { snapshot, pins: 0 });
			this.currentGeneration = snapshot;
			this.collect();
			this.lastReload = {
				ok: true,
				generation: snapshot.generation,
				imported,
				reused,
				diagnostics,
			};
			this.onPublish(snapshot);
			return this.lastReload;
		} catch (error) {
			// Failed reload: the prior healthy generation keeps serving.
			const message = error instanceof Error ? error.message : String(error);
			this.lastReload = {
				ok: false,
				generation: this.currentGeneration.generation,
				imported: [],
				reused: [],
				diagnostics: [
					...diagnostics,
					{
						severity: "error",
						code: "catalog.reload_failed",
						message: `Plugin reload failed; generation ${this.currentGeneration.generation} keeps serving: ${message}`,
						boundary: "plugin",
						pluginRoot: "",
						scopeKey: "",
					},
				],
				error: message,
			};
			return this.lastReload;
		}
	}

	/** Drop generations that are neither current nor pinned. */
	private collect(): void {
		for (const [generation, held] of this.held) {
			if (generation !== this.currentGeneration.generation && held.pins <= 0) {
				this.held.delete(generation);
			}
		}
	}
}

function listPluginRoots(sourceDir: string): string[] {
	let names: string[];
	try {
		names = readdirSync(sourceDir).sort();
	} catch {
		// A missing source directory contributes nothing (not an error).
		return [];
	}
	const roots: string[] = [];
	for (const name of names) {
		const candidate = join(sourceDir, name);
		try {
			if (statSync(candidate).isDirectory()) {
				roots.push(realpathSync(candidate));
			}
		} catch {
			// Races with concurrent deletion are tolerated.
		}
	}
	return roots;
}
