import type { MermaidConfig } from "mermaid";
import { neutralizeDiagramLinks } from "./links.js";

/**
 * The lazy, serialized Mermaid render service: the module loads on first
 * render (and re-attempted after a failed chunk load) and initialize+render
 * run as one queued unit so diagrams from different renderers never
 * interleave on Mermaid's process-wide singleton.
 */

// ---------------------------------------------------------------------------
// Lazy Mermaid module
// ---------------------------------------------------------------------------

export interface LazyMermaidInstance {
	initialize: (config: MermaidConfig) => void;
	render: (id: string, source: string) => Promise<{ svg: string }>;
}

export type MermaidModule = {
	default: LazyMermaidInstance;
};

export type MermaidModuleLoader = () => Promise<MermaidModule>;

/** Dynamic import so Mermaid only loads when a diagram first appears. */
export const defaultMermaidLoader: MermaidModuleLoader = () =>
	import("mermaid");

// ---------------------------------------------------------------------------
// Render service
// ---------------------------------------------------------------------------

export interface MermaidService {
	/**
	 * Renders `source` with `config`. The Mermaid module is imported on first
	 * use (and re-attempted after a failed chunk load); `initialize` only runs
	 * when the config object changes.
	 */
	render: (
		id: string,
		source: string,
		config: MermaidConfig,
	) => Promise<{ svg: string }>;
}

/**
 * Mermaid is a process-wide singleton whose `render` is not safe to run
 * concurrently (it mutates shared config and a temporary DOM container), and a
 * render must see the config it was requested with. `initialize` + `render`
 * therefore run as one queued unit, shared by every service so blocks from
 * different renderers never interleave. A failed render never blocks the queue.
 */
let renderQueue: Promise<unknown> = Promise.resolve();

function enqueueRender<T>(task: () => Promise<T>): Promise<T> {
	const run = renderQueue.then(task, task);
	renderQueue = run.catch(() => undefined);
	return run;
}

// The config each Mermaid instance was last initialized with, tracked per
// instance so services sharing one singleton don't skip a needed re-init.
const appliedConfigs = new WeakMap<LazyMermaidInstance, MermaidConfig>();

export function createMermaidService(
	loader: MermaidModuleLoader = defaultMermaidLoader,
): MermaidService {
	let modulePromise: Promise<MermaidModule> | undefined;
	const getModule = () => {
		modulePromise ??= loader().catch((error: unknown) => {
			modulePromise = undefined;
			throw error;
		});
		return modulePromise;
	};

	return {
		async render(id, source, config) {
			const mermaid = (await getModule()).default;
			return enqueueRender(async () => {
				if (appliedConfigs.get(mermaid) !== config) {
					mermaid.initialize(config);
					appliedConfigs.set(mermaid, config);
				}
				const result = await mermaid.render(id, source);
				return { ...result, svg: neutralizeDiagramLinks(result.svg) };
			});
		},
	};
}

export function describeMermaidError(error: unknown): string {
	if (error instanceof Error && error.message) return error.message;
	if (typeof error === "string" && error) return error;
	return "Failed to render diagram";
}
