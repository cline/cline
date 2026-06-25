/**
 * Built-in Executor Implementations
 *
 * This module provides ready-to-use implementations of the tool executors
 * using Node.js built-in modules. These can be used directly or as references
 * for custom implementations.
 */

import type { ToolExecutors } from "../types";
import {
	type ApplyPatchExecutorOptions,
	createApplyPatchExecutor,
} from "./apply-patch";
import { type ShellExecutorOptions, createShellExecutor } from "./bash";
import { createEditorExecutor, type EditorExecutorOptions } from "./editor";
import {
	createFileReadExecutor,
	type FileReadExecutorOptions,
} from "./file-read";
import { createSearchExecutor, type SearchExecutorOptions } from "./search";
import {
	createWebFetchExecutor,
	type WebFetchExecutorOptions,
} from "./web-fetch";

// Re-export individual executors and their options types
export {
	type ApplyPatchExecutorOptions,
	createApplyPatchExecutor,
} from "./apply-patch";
export {
	type ShellExecutorOptions,
	createShellExecutor,
} from "./bash";
export { createEditorExecutor, type EditorExecutorOptions } from "./editor";
export {
	createFileReadExecutor,
	type FileReadExecutorOptions,
} from "./file-read";
export { createSearchExecutor, type SearchExecutorOptions } from "./search";
export {
	createWebFetchExecutor,
	type WebFetchExecutorOptions,
} from "./web-fetch";

/**
 * Options for creating default executors
 */
export interface DefaultExecutorsOptions {
	fileRead?: FileReadExecutorOptions;
	search?: SearchExecutorOptions;
	bash?: ShellExecutorOptions;
	webFetch?: WebFetchExecutorOptions;
	applyPatch?: ApplyPatchExecutorOptions;
	editor?: EditorExecutorOptions;
}

/**
 * Create the default shell executor for the current platform.
 *
 * This is factored out from {@link createDefaultExecutors} so host integrations
 * can reuse the SDK's cross-platform shell selection while supplying their own
 * tool wrapper.
 */
export function createDefaultShellExecutor(options: ShellExecutorOptions = {}) {
	return createShellExecutor(options);
}

/**
 * Create all default executors with optional configuration
 *
 * @example
 * ```typescript
 * import { createDefaultTools, createDefaultExecutors } from "@cline/core"
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
		bash: createDefaultShellExecutor(options.bash),
		webFetch: createWebFetchExecutor(options.webFetch),
		applyPatch: createApplyPatchExecutor(options.applyPatch),
		editor: createEditorExecutor(options.editor),
	};
}
