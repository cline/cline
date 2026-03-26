/**
 * Built-in Executor Implementations
 *
 * This module provides ready-to-use implementations of the tool executors
 * using Node.js built-in modules. These can be used directly or as references
 * for custom implementations.
 */

import type { ToolExecutors } from "../types.js";
import { createApplyPatchExecutor } from "./apply-patch.js";
import { createBashExecutor, createWindowsExecutor } from "./bash.js";
import { createEditorExecutor } from "./editor.js";
import { createFileReadExecutor } from "./file-read.js";
import { createSearchExecutor } from "./search.js";
import { createWebFetchExecutor } from "./web-fetch.js";

// Re-export individual executors and their options types
export {
	type ApplyPatchExecutorOptions,
	createApplyPatchExecutor,
} from "./apply-patch.js";
export {
	type BashExecutorOptions,
	createBashExecutor,
	createWindowsExecutor,
} from "./bash.js";
export { createEditorExecutor, type EditorExecutorOptions } from "./editor.js";
export {
	createFileReadExecutor,
	type FileReadExecutorOptions,
} from "./file-read.js";
export { createSearchExecutor, type SearchExecutorOptions } from "./search.js";
export {
	createWebFetchExecutor,
	type WebFetchExecutorOptions,
} from "./web-fetch.js";

/**
 * Options for creating default executors
 */
export interface DefaultExecutorsOptions {
	fileRead?: import("./file-read.js").FileReadExecutorOptions;
	search?: import("./search.js").SearchExecutorOptions;
	bash?: import("./bash.js").BashExecutorOptions;
	webFetch?: import("./web-fetch.js").WebFetchExecutorOptions;
	applyPatch?: import("./apply-patch.js").ApplyPatchExecutorOptions;
	editor?: import("./editor.js").EditorExecutorOptions;
}

/**
 * Create all default executors with optional configuration
 *
 * @example
 * ```typescript
 * import { createDefaultTools, createDefaultExecutors } from "@clinebot/core/node"
 *
 * const executors = createDefaultExecutors({
 *   bash: { timeoutMs: 60000 },
 *   search: { maxResults: 50 },
 * })
 *
 * const tools = createDefaultTools({
 *   executors,
 *   cwd: "/path/to/project",
 * })
 * ```
 */
export function createDefaultExecutors(
	options: DefaultExecutorsOptions = {},
): ToolExecutors {
	return {
		readFile: createFileReadExecutor(options.fileRead),
		search: createSearchExecutor(options.search),
		bash:
			process?.platform === "win32"
				? (createWindowsExecutor(options.bash) as ToolExecutors["bash"])
				: createBashExecutor(options.bash),
		webFetch: createWebFetchExecutor(options.webFetch),
		applyPatch: createApplyPatchExecutor(options.applyPatch),
		editor: createEditorExecutor(options.editor),
	};
}
