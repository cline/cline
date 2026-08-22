/**
 * Search Executor
 *
 * Built-in implementation for searching the codebase using ripgrep (if available) or regex.
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { AgentToolContext } from "@cline/shared";
import { getFileIndex } from "../../../services/workspace";
import type { SearchExecutor } from "../types";
import { MAX_LINE_CHARS, MAX_SEARCH_OUTPUT_CHARS } from "./output-limits";

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

/**
 * Max chars buffered for a single ripgrep --json event line. Each event
 * embeds the full text of the matched/context line (--max-columns is
 * ignored in JSON mode), so one match in a single-line multi-hundred-MB
 * file (e.g. a serialized trace/log dump) produces one event of about the
 * same size. Buffering the whole stream unbounded could grow a string past
 * the engine's max length and crash the host process with an uncaught
 * RangeError from the stream data handler. Events beyond this size are
 * dropped; legitimate code lines are far smaller and long lines get
 * truncated to MAX_LINE_CHARS in the result anyway.
 */
const MAX_RG_EVENT_CHARS = 256 * 1024;

/**
 * Max file size (bytes) the fallback regex scan reads into memory. Files
 * beyond this are skipped; they are almost never useful code-search
 * targets and reading them risks the same memory blowups the ripgrep
 * path guards against.
 */
const MAX_FALLBACK_FILE_BYTES = 10 * 1024 * 1024;

function truncateSearchLine(text: string): string {
	if (text.length <= MAX_LINE_CHARS) {
		return text;
	}
	return `${text.slice(0, MAX_LINE_CHARS)} [line truncated]`;
}

let rgAvailable: boolean | null = null;

function checkRipgrepAvailable(): Promise<boolean> {
	if (rgAvailable !== null) {
		return Promise.resolve(rgAvailable);
	}

	return new Promise((resolve) => {
		const child = spawn("rg", ["--version"], {
			stdio: ["ignore", "pipe", "pipe"],
			// Prevent a console window from flashing on Windows.
			windowsHide: true,
		});

		child.on("close", (code) => {
			rgAvailable = code === 0;
			resolve(rgAvailable);
		});

		child.on("error", () => {
			rgAvailable = false;
			resolve(false);
		});

		setTimeout(() => {
			if (!child.killed) {
				child.kill("SIGTERM");
			}
			if (rgAvailable === null) {
				rgAvailable = false;
				resolve(false);
			}
		}, 1000);
	});
}

function searchWithRipgrep(
	query: string,
	cwd: string,
	maxResults: number,
	contextLines: number,
	timeoutMs: number = 5000,
	abortSignal?: AbortSignal,
): Promise<SearchMatch[] | null> {
	return new Promise((resolve) => {
		const child = spawn(
			"rg",
			["--json", `--context=${contextLines}`, "--max-count=1", "-i", query],
			{
				cwd,
				stdio: ["ignore", "pipe", "pipe"],
				// Prevent a console window from flashing on Windows.
				windowsHide: true,
			},
		);

		const matches: SearchMatch[] = [];
		let buffer = "";
		let discardingOversizedEvent = false;
		let resolved = false;

		const cleanup = () => {
			if (!child.killed) {
				child.kill("SIGTERM");
			}
		};

		const timeout = setTimeout(() => {
			if (!resolved) {
				resolved = true;
				cleanup();
				resolve(null);
			}
		}, timeoutMs);

		const finalize = (result: SearchMatch[] | null) => {
			if (!resolved) {
				resolved = true;
				clearTimeout(timeout);
				cleanup();
				resolve(result);
			}
		};

		if (abortSignal?.aborted) {
			cleanup();
			resolve(null);
			return;
		}

		abortSignal?.addEventListener("abort", () => {
			finalize(null);
		});

		const processEventLine = (line: string) => {
			if (!line.trim() || matches.length >= maxResults) {
				return;
			}
			try {
				const json = JSON.parse(line);
				if (json.type === "match") {
					const matchData = json.data;
					const contextLines: string[] = [];

					if (json.data.submatches && json.data.submatches.length > 0) {
						const submatch = json.data.submatches[0];
						matches.push({
							file: matchData.path.text,
							line: matchData.line_number,
							column: (submatch?.start ?? 0) + 1,
							match: truncateSearchLine(submatch?.match?.text ?? ""),
							context: contextLines,
						});
					}
				} else if (json.type === "context" && matches.length > 0) {
					const lastMatch = matches[matches.length - 1];
					const prefix = json.data.line_number === lastMatch.line ? ">" : " ";
					lastMatch.context.push(
						`${prefix} ${json.data.line_number}: ${truncateSearchLine(json.data.lines?.text ?? json.data.line?.text ?? "")}`,
					);
				}
			} catch {
				// Tolerate undecodable event lines (e.g. cut off when the
				// process is killed mid-write); keep the matches parsed so far.
			}
		};

		child.stdout.on("data", (chunk: Buffer | string) => {
			if (resolved) {
				return;
			}
			buffer += chunk.toString();

			let newlineIndex = buffer.indexOf("\n");
			while (newlineIndex !== -1) {
				const line = buffer.slice(0, newlineIndex);
				buffer = buffer.slice(newlineIndex + 1);
				if (discardingOversizedEvent) {
					// This was the tail of a dropped oversized event.
					discardingOversizedEvent = false;
				} else {
					processEventLine(line);
					if (matches.length >= maxResults) {
						finalize(matches);
						return;
					}
				}
				newlineIndex = buffer.indexOf("\n");
			}

			if (buffer.length > MAX_RG_EVENT_CHARS) {
				buffer = "";
				discardingOversizedEvent = true;
			}
		});

		child.stderr.on("data", () => {
			// Ignore stderr
		});

		child.on("close", (code: number | null) => {
			if (code === 0 || code === 1) {
				if (!discardingOversizedEvent) {
					processEventLine(buffer);
				}
				finalize(matches.length > 0 ? matches : null);
				return;
			}

			finalize(null);
		});

		child.on("error", () => {
			finalize(null);
		});
	});
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
		context: AgentToolContext,
	): Promise<string> => {
		// Check for abort before starting
		if (context.signal?.aborted) {
			throw new Error("Search operation aborted");
		}

		// Try ripgrep first if available
		const isRgAvailable = await checkRipgrepAvailable();
		let rgMatches: SearchMatch[] | null = null;
		if (isRgAvailable) {
			rgMatches = await searchWithRipgrep(
				query,
				cwd,
				maxResults,
				contextLines,
				5000,
				context.signal,
			);
		}

		if (rgMatches) {
			const resultLines: string[] = [
				`Found ${rgMatches.length} result${rgMatches.length === 1 ? "" : "s"} for pattern: ${query}`,
				"",
			];

			for (const match of rgMatches) {
				resultLines.push(`${match.file}:${match.line}:${match.column}`);
				resultLines.push(...match.context);
				resultLines.push("");
			}

			if (rgMatches.length >= maxResults) {
				resultLines.push(
					`(Showing first ${maxResults} results. Refine your search for more specific results.)`,
				);
			}

			return capSearchOutput(resultLines.join("\n"));
		}

		// Fallback to manual regex search
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
		let oversizedFilesSkipped = 0;

		const fileList = await getFileIndex(cwd);

		// Search files from the fast index.
		for (const relativePath of fileList) {
			// Check for abort signal
			if (context.signal?.aborted) {
				throw new Error("Search operation aborted");
			}

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

			const filePath = path.join(cwd, relativePath);

			try {
				const stats = await fs.stat(filePath);
				if (stats.size > MAX_FALLBACK_FILE_BYTES) {
					oversizedFilesSkipped++;
					continue;
				}
				totalFilesSearched++;
				const content = await fs.readFile(filePath, "utf-8");
				const lines = content.split("\n");

				for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
					const line = lines[lineIdx];
					regex.lastIndex = 0; // Reset regex state

					let match = regex.exec(line);
					while (match !== null) {
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
							contextLinesArr.push(
								`${prefix} ${i + 1}: ${truncateSearchLine(lines[i])}`,
							);
						}

						matches.push({
							file: relativePath,
							line: lineIdx + 1,
							column: match.index + 1,
							match: truncateSearchLine(match[0]),
							context: contextLinesArr,
						});

						// Prevent infinite loop on zero-length matches
						if (match.index === regex.lastIndex) {
							regex.lastIndex++;
						}
						match = regex.exec(line);
					}
				}
			} catch {}
		}

		// Format results
		if (matches.length === 0) {
			const skippedNote =
				oversizedFilesSkipped > 0
					? `\nSkipped ${oversizedFilesSkipped} file${oversizedFilesSkipped === 1 ? "" : "s"} larger than ${Math.round(MAX_FALLBACK_FILE_BYTES / (1024 * 1024))}MB.`
					: "";
			return `No results found for pattern: ${query}\nSearched ${totalFilesSearched} files.${skippedNote}`;
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

		return capSearchOutput(resultLines.join("\n"));
	};
}

/**
 * Middle-truncate oversized search output. Matches with long context lines
 * can blow past the per-query cap even within the maxResults bound; the
 * head (earliest matches plus the result count) and tail (the refine hint)
 * are preserved and the middle is elided with a notice teaching the model
 * to narrow the pattern instead of retrying.
 */
function capSearchOutput(text: string): string {
	if (text.length <= MAX_SEARCH_OUTPUT_CHARS) {
		return text;
	}
	const headLimit = Math.ceil(MAX_SEARCH_OUTPUT_CHARS / 2);
	const tailLimit = Math.max(1, MAX_SEARCH_OUTPUT_CHARS - headLimit);
	return (
		`${text.slice(0, headLimit)}\n` +
		`[... search output truncated: ${text.length} chars total. ` +
		"Narrow the pattern or scope to view the elided matches ...]\n" +
		text.slice(-tailLimit)
	);
}
