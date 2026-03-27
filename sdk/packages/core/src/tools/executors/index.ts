/**
 * Built-in Executor Implementations
 *
 * This module provides ready-to-use implementations of the tool executors
 * using Node.js built-in modules. These can be used directly or as references
 * for custom implementations.
 */

import type { ToolExecutors } from "../types.js";
import {
	type ApplyPatchExecutorOptions,
	createApplyPatchExecutor,
} from "./apply-patch.js";
import { type BashExecutorOptions, createBashExecutor } from "./bash.js";
import { createEditorExecutor, type EditorExecutorOptions } from "./editor.js";
import {
	createFileReadExecutor,
	type FileReadExecutorOptions,
} from "./file-read.js";
import { createSearchExecutor, type SearchExecutorOptions } from "./search.js";
import {
	createWebFetchExecutor,
	type WebFetchExecutorOptions,
} from "./web-fetch.js";

// Re-export individual executors and their options types
export {
	type ApplyPatchExecutorOptions,
	createApplyPatchExecutor,
} from "./apply-patch.js";
export {
	type BashExecutorOptions,
	createBashExecutor,
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
	fileRead?: FileReadExecutorOptions;
	search?: SearchExecutorOptions;
	bash?: BashExecutorOptions;
	webFetch?: WebFetchExecutorOptions;
	applyPatch?: ApplyPatchExecutorOptions;
	editor?: EditorExecutorOptions;
}

/**
 * Create all default executors with optional configuration
 *
 * @example
 * ```typescript
 * import { createDefaultTools, createDefaultExecutors } from "@clinebot/core"
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
		bash: createBashExecutor(options.bash),
		webFetch: createWebFetchExecutor(options.webFetch),
		applyPatch: createApplyPatchExecutor(options.applyPatch),
		editor: createEditorExecutor(options.editor),
	};
}
