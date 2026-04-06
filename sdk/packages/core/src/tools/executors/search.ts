/**
 * Search Executor
 *
 * Built-in implementation for searching the codebase using regex.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { ToolContext } from "@clinebot/shared";
import { getFileIndex } from "../../input";
import type { SearchExecutor } from "../types";

/**
 * Options for the search executor
 */
export interface SearchExecutorOptions {
	/**
	 * File extensions to include in search (without dot)
	 * @default common code extensions
	 */
	includeExtensions?: string[];

	/**
	 * Directories to exclude from search
	 * @default ["node_modules", ".git", "dist", "build", ".next", "coverage"]
	 */
	excludeDirs?: string[];

	/**
	 * Maximum number of results to return
	 * @default 100
	 */
	maxResults?: number;

	/**
	 * Number of context lines before and after match
	 * @default 2
	 */
	contextLines?: number;

	/**
	 * Maximum depth to traverse
	 * @default 20
	 */
	maxDepth?: number;
}

const DEFAULT_INCLUDE_EXTENSIONS = [
	"ts",
	"tsx",
	"js",
	"jsx",
	"mjs",
	"cjs",
	"json",
	"md",
	"mdx",
	"txt",
	"yaml",
	"yml",
	"toml",
	"py",
	"rb",
	"go",
	"rs",
	"java",
	"kt",
	"swift",
	"c",
	"cpp",
	"h",
	"hpp",
	"css",
	"scss",
	"less",
	"html",
	"vue",
	"svelte",
	"sql",
	"sh",
	"bash",
	"zsh",
	"fish",
	"ps1",
	"env",
	"gitignore",
	"dockerignore",
	"editorconfig",
];

const DEFAULT_EXCLUDE_DIRS = [
	"node_modules",
	".git",
	"dist",
	"build",
	".next",
	"coverage",
	"__pycache__",
	".venv",
	"venv",
	".cache",
	".turbo",
	".output",
	"out",
	"target",
	"bin",
	"obj",
];

/**
 * Search result for a single file match
 */
interface SearchMatch {
	file: string;
	line: number;
	column: number;
	match: string;
	context: string[];
}

function shouldIncludeFile(
	relativePath: string,
	excludeDirs: Set<string>,
	includeExtensions: Set<string>,
	maxDepth: number,
): boolean {
	const segments = relativePath.split("/");
	const fileName = segments[segments.length - 1] ?? "";
	const directoryDepth = segments.length - 1;

	if (directoryDepth > maxDepth) {
		return false;
	}

	for (let i = 0; i < segments.length - 1; i++) {
		if (excludeDirs.has(segments[i] ?? "")) {
			return false;
		}
	}

	const ext = path.posix.extname(fileName).slice(1).toLowerCase();
	return includeExtensions.has(ext) || (!ext && !fileName.startsWith("."));
}

/**
 * Create a search executor using regex pattern matching
 *
 * @example
 * ```typescript
 * const search = createSearchExecutor({
 *   maxResults: 50,
 *   contextLines: 3,
 * })
 *
 * const results = await search("function\\s+handleClick", "/path/to/project", context)
 * ```
 */
export function createSearchExecutor(
	options: SearchExecutorOptions = {},
): SearchExecutor {
	const {
		includeExtensions = DEFAULT_INCLUDE_EXTENSIONS,
		excludeDirs = DEFAULT_EXCLUDE_DIRS,
		maxResults = 100,
		contextLines = 2,
		maxDepth = 20,
	} = options;
	const excludeDirsSet = new Set(excludeDirs);
	const includeExtensionsSet = new Set(
		includeExtensions.map((extension) => extension.toLowerCase()),
	);

	return async (
		query: string,
		cwd: string,
		_context: ToolContext,
	): Promise<string> => {
		// Compile regex
		let regex: RegExp;
		try {
			regex = new RegExp(query, "gim");
		} catch (error) {
			throw new Error(
				`Invalid regex pattern: ${query}. ${error instanceof Error ? error.message : ""}`,
			);
		}

		const matches: SearchMatch[] = [];
		let totalFilesSearched = 0;

		const fileList = await getFileIndex(cwd);

		// Search files from the fast index.
		for (const relativePath of fileList) {
			if (
				!shouldIncludeFile(
					relativePath,
					excludeDirsSet,
					includeExtensionsSet,
					maxDepth,
				)
			) {
				continue;
			}

			if (matches.length >= maxResults) break;

			totalFilesSearched++;
			const filePath = path.join(cwd, relativePath);

			try {
				const content = await fs.readFile(filePath, "utf-8");
				const lines = content.split("\n");

				for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
					const line = lines[lineIdx];
					regex.lastIndex = 0; // Reset regex state

					let match: RegExpExecArray | null;
					while ((match = regex.exec(line)) !== null) {
						if (matches.length >= maxResults) break;

						// Get context lines
						const contextStart = Math.max(0, lineIdx - contextLines);
						const contextEnd = Math.min(
							lines.length - 1,
							lineIdx + contextLines,
						);
						const contextLinesArr: string[] = [];

						for (let i = contextStart; i <= contextEnd; i++) {
							const prefix = i === lineIdx ? ">" : " ";
							contextLinesArr.push(`${prefix} ${i + 1}: ${lines[i]}`);
						}

						matches.push({
							file: relativePath,
							line: lineIdx + 1,
							column: match.index + 1,
							match: match[0],
							context: contextLinesArr,
						});

						// Prevent infinite loop on zero-length matches
						if (match.index === regex.lastIndex) {
							regex.lastIndex++;
						}
					}
				}
			} catch {}
		}

		// Format results
		if (matches.length === 0) {
			return `No results found for pattern: ${query}\nSearched ${totalFilesSearched} files.`;
		}

		const resultLines: string[] = [
			`Found ${matches.length} result${matches.length === 1 ? "" : "s"} for pattern: ${query}`,
			`Searched ${totalFilesSearched} files.`,
			"",
		];

		for (const match of matches) {
			resultLines.push(`${match.file}:${match.line}:${match.column}`);
			resultLines.push(...match.context);
			resultLines.push("");
		}

		if (matches.length >= maxResults) {
			resultLines.push(
				`(Showing first ${maxResults} results. Refine your search for more specific results.)`,
			);
		}

		return resultLines.join("\n");
	};
}
