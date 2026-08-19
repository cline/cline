import { execFile, spawn } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { promisify } from "node:util";
import {
	type AgentTool,
	type AgentToolContext,
	createTool,
} from "@cline/shared";

const execFileAsync = promisify(execFile);
const OUTPUT_LIMIT = 100_000;

export const DEFAULT_CODING_TOOL_NAMES = [
	"read_files",
	"search_codebase",
	"run_commands",
	"editor",
	"fetch_web_content",
	"ask_question",
	"submit_and_exit",
] as const;
export type DefaultCodingToolName = (typeof DEFAULT_CODING_TOOL_NAMES)[number];

function safePath(workspaceRoot: string, value: unknown): string {
	if (typeof value !== "string" || value.length === 0) {
		throw new Error("path must be a non-empty string");
	}
	const candidate = resolve(workspaceRoot, value);
	const rel = relative(resolve(workspaceRoot), candidate);
	if (
		rel === ".." ||
		rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) ||
		isAbsolute(rel)
	) {
		throw new Error(`Path is outside the workspace: ${value}`);
	}
	return candidate;
}

function bounded(value: string): string {
	return value.length <= OUTPUT_LIMIT
		? value
		: `${value.slice(0, OUTPUT_LIMIT)}\n… output truncated …`;
}

function errorResult(error: unknown): { error: string } {
	return { error: error instanceof Error ? error.message : String(error) };
}

const readFilesSchema = {
	type: "object",
	properties: {
		files: {
			type: "array",
			items: {
				type: "object",
				properties: {
					path: { type: "string" },
					start_line: { type: ["integer", "null"], minimum: 1 },
					end_line: { type: ["integer", "null"], minimum: 1 },
				},
				required: ["path"],
				additionalProperties: false,
			},
		},
	},
	required: ["files"],
	additionalProperties: false,
} as const;

export interface BuiltinToolOptions {
	workspaceRoot: string;
	enabledToolNames?: readonly string[];
	shell?: string;
	commandTimeoutMs?: number;
	fetchTimeoutMs?: number;
	askQuestion?: (
		question: string,
		options: readonly string[],
	) => Promise<unknown>;
}

export function createBuiltinCodingTools(
	options: BuiltinToolOptions,
): readonly AgentTool[] {
	const enabled = new Set(
		options.enabledToolNames ?? DEFAULT_CODING_TOOL_NAMES,
	);
	const tools: AgentTool[] = [];

	if (enabled.has("read_files")) {
		tools.push(
			createTool({
				name: "read_files",
				description:
					"Read text files in the current workspace, optionally by inclusive one-based line range.",
				inputSchema: readFilesSchema,
				execute: async (raw: unknown) => {
					try {
						const input = raw as {
							files?: Array<{
								path?: unknown;
								start_line?: number | null;
								end_line?: number | null;
							}>;
						};
						if (!Array.isArray(input.files))
							throw new Error("files must be an array");
						return await Promise.all(
							input.files.map(async (request) => {
								const path = safePath(options.workspaceRoot, request.path);
								const content = await readFile(path, "utf8");
								const lines = content.split("\n");
								const start = request.start_line ?? 1;
								const end = request.end_line ?? lines.length;
								if (start > end)
									throw new Error("start_line must be <= end_line");
								return {
									path,
									content: bounded(lines.slice(start - 1, end).join("\n")),
								};
							}),
						);
					} catch (error) {
						return errorResult(error);
					}
				},
			}),
		);
	}

	if (enabled.has("search_codebase")) {
		tools.push(
			createTool({
				name: "search_codebase",
				description:
					"Search workspace file contents with ripgrep regular expressions.",
				inputSchema: {
					type: "object",
					properties: { queries: { type: "array", items: { type: "string" } } },
					required: ["queries"],
					additionalProperties: false,
				},
				execute: async (raw: unknown) => {
					try {
						const queries = (raw as { queries?: unknown }).queries;
						if (
							!Array.isArray(queries) ||
							queries.some((q) => typeof q !== "string")
						) {
							throw new Error("queries must be an array of strings");
						}
						return await Promise.all(
							queries.map(async (query) => {
								try {
									const { stdout } = await execFileAsync(
										"rg",
										["-n", "--no-heading", "--color", "never", query, "."],
										{
											cwd: options.workspaceRoot,
											maxBuffer: OUTPUT_LIMIT * 2,
										},
									);
									return { query, result: bounded(stdout) };
								} catch (error) {
									const shaped = error as {
										code?: number;
										stdout?: string;
										message?: string;
									};
									return shaped.code === 1
										? { query, result: "No matches" }
										: { query, error: shaped.message ?? String(error) };
								}
							}),
						);
					} catch (error) {
						return errorResult(error);
					}
				},
			}),
		);
	}

	if (enabled.has("run_commands")) {
		tools.push(
			createTool({
				name: "run_commands",
				description: "Run complete shell commands from the workspace root.",
				inputSchema: {
					type: "object",
					properties: {
						commands: { type: "array", items: { type: "string" } },
					},
					required: ["commands"],
					additionalProperties: false,
				},
				execute: async (raw: unknown, context: AgentToolContext) => {
					const commands = (raw as { commands?: unknown }).commands;
					if (
						!Array.isArray(commands) ||
						commands.some((c) => typeof c !== "string")
					) {
						return { error: "commands must be an array of strings" };
					}
					const outputs = [];
					for (const [index, command] of commands.entries()) {
						context.emitUpdate?.({
							commandIndex: index,
							command,
							status: "started",
						});
						try {
							const output = await runCommand(
								command,
								options.workspaceRoot,
								options.shell,
								options.commandTimeoutMs ?? 30_000,
								context.signal,
							);
							outputs.push({ command, success: true, output: bounded(output) });
						} catch (error) {
							outputs.push({ command, success: false, ...errorResult(error) });
						}
					}
					return outputs;
				},
			}),
		);
	}

	if (enabled.has("editor")) {
		tools.push(
			createTool({
				name: "editor",
				description:
					"Create a text file, replace one exact text occurrence, or insert text at a one-based line boundary within the workspace.",
				inputSchema: {
					type: "object",
					properties: {
						path: { type: "string" },
						old_text: { type: ["string", "null"] },
						new_text: { type: "string" },
						insert_line: { type: ["integer", "null"], minimum: 1 },
					},
					required: ["path", "new_text"],
					additionalProperties: false,
				},
				execute: async (raw: unknown) => {
					try {
						const input = raw as {
							path?: unknown;
							old_text?: string | null;
							new_text?: unknown;
							insert_line?: number | null;
						};
						if (typeof input.new_text !== "string")
							throw new Error("new_text must be a string");
						const path = safePath(options.workspaceRoot, input.path);
						let current = "";
						let exists = true;
						try {
							current = await readFile(path, "utf8");
						} catch {
							exists = false;
						}
						let next: string;
						if (input.insert_line != null) {
							if (!exists)
								throw new Error("insert_line requires an existing file");
							const lines = current.split("\n");
							if (input.insert_line < 1 || input.insert_line > lines.length + 1)
								throw new Error("insert_line is outside the file");
							lines.splice(input.insert_line - 1, 0, input.new_text);
							next = lines.join("\n");
						} else if (input.old_text != null) {
							const first = current.indexOf(input.old_text);
							if (first < 0) throw new Error("old_text was not found");
							if (
								current.indexOf(
									input.old_text,
									first + input.old_text.length,
								) >= 0
							)
								throw new Error("old_text occurs more than once");
							next = `${current.slice(0, first)}${input.new_text}${current.slice(first + input.old_text.length)}`;
						} else {
							if (exists)
								throw new Error(
									"old_text is required when editing an existing file",
								);
							next = input.new_text;
						}
						await mkdir(dirname(path), { recursive: true });
						await writeFile(path, next, "utf8");
						return { path, created: !exists, bytes: Buffer.byteLength(next) };
					} catch (error) {
						return errorResult(error);
					}
				},
			}),
		);
	}

	if (enabled.has("fetch_web_content")) {
		tools.push(
			createTool({
				name: "fetch_web_content",
				description: "Fetch textual content from HTTPS URLs.",
				inputSchema: {
					type: "object",
					properties: {
						requests: {
							type: "array",
							items: {
								type: "object",
								properties: {
									url: { type: "string" },
									prompt: { type: "string" },
								},
								required: ["url", "prompt"],
								additionalProperties: false,
							},
						},
					},
					required: ["requests"],
					additionalProperties: false,
				},
				execute: async (raw: unknown, context: AgentToolContext) => {
					const requests = (
						raw as { requests?: Array<{ url?: unknown; prompt?: unknown }> }
					).requests;
					if (!Array.isArray(requests))
						return { error: "requests must be an array" };
					return await Promise.all(
						requests.map(async ({ url, prompt }) => {
							try {
								if (typeof url !== "string" || !url.startsWith("https://"))
									throw new Error("Only HTTPS URLs are allowed");
								const signal = AbortSignal.any([
									context.signal ?? new AbortController().signal,
									AbortSignal.timeout(options.fetchTimeoutMs ?? 30_000),
								]);
								const response = await fetch(url, {
									signal,
									redirect: "follow",
								});
								if (!response.ok) throw new Error(`HTTP ${response.status}`);
								return { url, prompt, content: bounded(await response.text()) };
							} catch (error) {
								return { url, ...errorResult(error) };
							}
						}),
					);
				},
			}),
		);
	}

	if (enabled.has("ask_question") && options.askQuestion) {
		tools.push(
			createTool({
				name: "ask_question",
				description:
					"Ask the user one clarifying question with two to five selectable options.",
				inputSchema: {
					type: "object",
					properties: {
						question: { type: "string" },
						options: {
							type: "array",
							items: { type: "string" },
							minItems: 2,
							maxItems: 5,
						},
					},
					required: ["question", "options"],
					additionalProperties: false,
				},
				execute: async (raw: unknown) => {
					const input = raw as { question?: unknown; options?: unknown };
					if (
						typeof input.question !== "string" ||
						!Array.isArray(input.options) ||
						input.options.length < 2 ||
						input.options.length > 5 ||
						input.options.some((item) => typeof item !== "string")
					) {
						return { error: "question and 2-5 string options are required" };
					}
					return options.askQuestion?.(
						input.question,
						input.options as string[],
					);
				},
			}),
		);
	}

	if (enabled.has("submit_and_exit")) {
		tools.push(
			createTool({
				name: "submit_and_exit",
				description: "Submit the final task summary and finish the run.",
				inputSchema: {
					type: "object",
					properties: {
						summary: { type: "string" },
						verified: { type: "boolean" },
					},
					required: ["summary", "verified"],
					additionalProperties: false,
				},
				lifecycle: { completesRun: true },
				execute: async (raw: unknown) => {
					const input = raw as { summary?: unknown; verified?: unknown };
					if (
						typeof input.summary !== "string" ||
						typeof input.verified !== "boolean"
					) {
						return { error: "summary and verified are required" };
					}
					return input.summary;
				},
			}),
		);
	}

	return tools;
}

async function runCommand(
	command: string,
	cwd: string,
	shell: string | undefined,
	timeoutMs: number,
	abortSignal: AbortSignal | undefined,
): Promise<string> {
	await access(cwd);
	return await new Promise((resolvePromise, rejectPromise) => {
		const child = spawn(
			shell ?? (process.platform === "win32" ? "powershell.exe" : "/bin/sh"),
			process.platform === "win32" ? ["-Command", command] : ["-lc", command],
			{
				cwd,
				stdio: ["ignore", "pipe", "pipe"],
			},
		);
		let output = "";
		child.stdout.on("data", (chunk) => {
			output += String(chunk);
		});
		child.stderr.on("data", (chunk) => {
			output += String(chunk);
		});
		const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
		const abort = () => child.kill("SIGTERM");
		abortSignal?.addEventListener("abort", abort, { once: true });
		child.once("error", rejectPromise);
		child.once("close", (code, signal) => {
			clearTimeout(timer);
			abortSignal?.removeEventListener("abort", abort);
			if (abortSignal?.aborted) rejectPromise(new Error("Command cancelled"));
			else if (signal)
				rejectPromise(new Error(`Command terminated by ${signal}`));
			else if (code !== 0)
				rejectPromise(new Error(`Command exited ${code}\n${bounded(output)}`));
			else resolvePromise(output);
		});
	});
}
