/**
 * Default AgentTool Definitions
 *
 * Factory functions for creating the default tools.
 */

import {
	type AgentTool,
	type AgentToolContext,
	createTool,
	validateWithZod,
	zodToJsonSchema,
} from "@cline/shared";
import { captureRunCommandsTimeout } from "../../services/telemetry/core-events";
import { getToolContextTelemetry } from "../../services/telemetry/tool-context";
import { CommandExitError } from "./executors/bash";
import {
	MAX_COMMAND_OUTPUT_CHARS,
	MAX_READ_LINES,
	MAX_READ_OUTPUT_CHARS,
	MAX_SEARCH_OUTPUT_CHARS,
} from "./executors/output-limits";
import {
	formatError,
	formatReadFileQuery,
	formatRunCommandQuery,
	formatRunCommandQueryPreview,
	getEditorSizeError,
	getReadFileRangeError,
	normalizeRunCommandsInput,
	TimeoutError,
	withTimeout,
} from "./helpers";
import {
	type ApplyPatchInput,
	ApplyPatchInputSchema,
	ApplyPatchInputUnionSchema,
	type AskQuestionInput,
	AskQuestionInputSchema,
	type EditFileInput,
	EditFileInputSchema,
	type FetchWebContentInput,
	FetchWebContentInputSchema,
	type ReadFileRequest,
	type ReadFilesInput,
	ReadFilesInputSchema,
	ReadFilesInputUnionSchema,
	RunCommandsInputSchema,
	type SearchCodebaseInput,
	SearchCodebaseInputSchema,
	SearchCodebaseUnionInputSchema,
	type SkillsInput,
	type StructuredCommandInput,
	SkillsInputSchema,
	type SubmitInput,
	SubmitInputSchema,
} from "./schemas";
import type {
	ApplyPatchExecutor,
	AskQuestionExecutor,
	CreateDefaultToolsOptions,
	DefaultToolsConfig,
	EditorExecutor,
	FileReadExecutor,
	SearchExecutor,
	ShellExecutor,
	SkillsExecutorWithMetadata,
	ToolOperationResult,
	VerifySubmitExecutor,
	WebFetchExecutor,
} from "./types";

// =============================================================================
// Helper Functions
// =============================================================================

function getStringMetadata(
	context: AgentToolContext,
	key: string,
): string | undefined {
	const value = context.metadata?.[key];
	return typeof value === "string" ? value : undefined;
}

function captureRunCommandsTimeoutFromContext(
	context: AgentToolContext,
	properties: {
		effectiveTimeoutMs: number;
		timeoutSource: "default_setting" | "configured_setting";
		commandCount: number;
		durationMs: number;
	},
): void {
	captureRunCommandsTimeout(getToolContextTelemetry(context.metadata), {
		tool_name: "run_commands",
		effective_timeout_ms: properties.effectiveTimeoutMs,
		timeout_source: properties.timeoutSource,
		command_count: properties.commandCount,
		duration_ms: properties.durationMs,
		ulid: context.sessionId,
		mode: getStringMetadata(context, "mode"),
		source: getStringMetadata(context, "source"),
		session_id: context.sessionId,
		agent_id: context.agentId,
		conversation_id: context.conversationId,
		run_id: context.runId,
		iteration: context.iteration,
		tool_call_id: context.toolCallId,
	});
}

function getHeredocDelimiter(command: string): string | undefined {
	const match = command.match(
		/(?<![<])<<-?\s*(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9_./-]+))/,
	);
	return match?.[1] ?? match?.[2] ?? match?.[3];
}

function coalesceSplitHeredocCommands(commands: string[]): string[] {
	const coalesced: string[] = [];
	for (let index = 0; index < commands.length; index += 1) {
		const command = commands[index];
		const delimiter = getHeredocDelimiter(command);
		if (!delimiter) {
			coalesced.push(command);
			continue;
		}

		const endIndex = commands.findIndex(
			(nextCommand, nextIndex) =>
				nextIndex > index && nextCommand.trim() === delimiter,
		);
		if (endIndex === -1) {
			coalesced.push(command);
			continue;
		}

		const parts = [command];
		while (index < endIndex) {
			index += 1;
			const nextCommand = commands[index];
			parts.push(nextCommand);
		}
		coalesced.push(parts.join("\n"));
	}
	return coalesced;
}

function coalesceAdjacentStringHeredocs(
	commands: Array<string | StructuredCommandInput>,
): Array<string | StructuredCommandInput> {
	const coalesced: Array<string | StructuredCommandInput> = [];
	let stringRun: string[] = [];

	const flushStringRun = () => {
		if (stringRun.length > 0) {
			coalesced.push(...coalesceSplitHeredocCommands(stringRun));
			stringRun = [];
		}
	};

	for (const command of commands) {
		if (typeof command === "string") {
			stringRun.push(command);
			continue;
		}

		flushStringRun();
		coalesced.push(command);
	}

	flushStringRun();
	return coalesced;
}

const MAX_TOOL_HISTORY_SCOPES = 200;
const workspaceMutationRevisionByScope = new Map<string, number>();
const previousRunCommandResultsByScope = new Map<
	string,
	Map<
		string,
		{
			count: number;
			revision: number;
			query: string;
			success: boolean;
			error?: string;
		}
	>
>();

type PreviousRunCommandResult = {
	count: number;
	revision: number;
	query: string;
	success: boolean;
	error?: string;
};

function getToolHistoryScopeKey(context: AgentToolContext): string | undefined {
	if (context.runId) {
		return `run:${context.runId}`;
	}
	if (context.sessionId) {
		return `session:${context.sessionId}`;
	}
	return undefined;
}

function getScopeMutationRevision(scope: string | undefined): number {
	if (!scope) {
		return 0;
	}
	return workspaceMutationRevisionByScope.get(scope) ?? 0;
}

function bumpScopeMutationRevisionForScope(scope: string | undefined): void {
	if (!scope) {
		return;
	}
	workspaceMutationRevisionByScope.set(
		scope,
		getScopeMutationRevision(scope) + 1,
	);
}

function bumpScopeMutationRevision(context: AgentToolContext): void {
	bumpScopeMutationRevisionForScope(getToolHistoryScopeKey(context));
}

function getScopedCommandResultMap(
	scope: string | undefined,
): Map<string, PreviousRunCommandResult> | undefined {
	if (!scope) {
		return undefined;
	}
	if (
		!previousRunCommandResultsByScope.has(scope) &&
		previousRunCommandResultsByScope.size >= MAX_TOOL_HISTORY_SCOPES
	) {
		const oldestScope = previousRunCommandResultsByScope.keys().next().value;
		if (oldestScope) {
			previousRunCommandResultsByScope.delete(oldestScope);
			workspaceMutationRevisionByScope.delete(oldestScope);
		}
	}
	let commands = previousRunCommandResultsByScope.get(scope);
	if (!commands) {
		commands = new Map();
		previousRunCommandResultsByScope.set(scope, commands);
	}
	return commands;
}

function getRepeatedCommandSkip(
	scope: string | undefined,
	commandKey: string,
): ToolOperationResult | undefined {
	const commandResults = getScopedCommandResultMap(scope);
	const previous = commandResults?.get(commandKey);
	if (!previous || previous.revision !== getScopeMutationRevision(scope)) {
		return undefined;
	}
	previous.count += 1;
	const skippedResult: ToolOperationResult = {
		query: previous.query,
		result:
			`Tool guidance: Skipped exact repeated command (already run ${previous.count} times since the last file edit). ` +
			"Reuse the previous result already in the conversation, edit files before rerunning tests, or run a different targeted command.",
		success: previous.success,
	};
	if (!previous.success && previous.error) {
		skippedResult.error = previous.error;
	}
	return skippedResult;
}

function rememberCommandResult(
	scope: string | undefined,
	commandKey: string,
	result: ToolOperationResult,
): void {
	const commandResults = getScopedCommandResultMap(scope);
	if (!commandResults) {
		return;
	}
	commandResults.set(commandKey, {
		count: 1,
		revision: getScopeMutationRevision(scope),
		query: result.query,
		success: result.success,
		error: result.error,
	});
}

function commandLikelyMutatesWorkspace(command: string): boolean {
	return (
		/(?:^|[;&|({]\s*)(?:rm|mv|cp|mkdir|touch|chmod|chown|ln|install)\b/.test(
			command,
		) ||
		/(?:^|[;&|({]\s*)(?:git\s+(?:apply|checkout|switch|restore|clean|reset))\b/.test(
			command,
		) ||
		/(?:^|[;&|({]\s*)(?:sed\s+-i|perl\s+-pi)\b/.test(command) ||
		/(?:^|[;&|({]\s*)(?:(?:npm|pnpm|yarn|bun)\s+install)\b/.test(command) ||
		/(?:^|[;&|({]\s*)(?:tar\s+[\s\S]*\b-x|unzip)\b/.test(command) ||
		/(?:^|[;&|({]\s*)(?:curl[\s\S]*\s-o\s|wget[\s\S]*\s-O\s)/.test(command) ||
		/(?:^|[\s;|&({])(?:\d*)>>?\s*(?!&\d\b|\/dev\/null\b)\S/.test(command)
	);
}

async function executeShellCommands(
	commands: Array<string | StructuredCommandInput>,
	options: {
		executor: ShellExecutor;
		cwd: string;
		context: AgentToolContext;
		timeoutMs: number;
		timeoutSource: "default_setting" | "configured_setting";
	},
): Promise<ToolOperationResult[]> {
	const { executor, cwd, context, timeoutMs, timeoutSource } = options;
	const scope = getToolHistoryScopeKey(context);

	return Promise.all(
		commands.map(async (command): Promise<ToolOperationResult> => {
			const startedAt = Date.now();
			const commandKey = formatRunCommandQuery(command);
			const query = formatRunCommandQueryPreview(command);
			const skippedRepeat = getRepeatedCommandSkip(scope, commandKey);
			if (skippedRepeat) {
				return skippedRepeat;
			}
			try {
				const output = await withTimeout(
					executor(command, cwd, context),
					timeoutMs,
					`Command timed out after ${timeoutMs}ms`,
				);
				const result = {
					query,
					result: output,
					success: true,
				};
				if (commandLikelyMutatesWorkspace(commandKey)) {
					bumpScopeMutationRevisionForScope(scope);
				}
				rememberCommandResult(scope, commandKey, result);
				return result;
			} catch (error) {
				if (error instanceof TimeoutError) {
					captureRunCommandsTimeoutFromContext(context, {
						effectiveTimeoutMs: error.timeoutMs,
						timeoutSource,
						commandCount: commands.length,
						durationMs: Date.now() - startedAt,
					});
				}
				if (error instanceof CommandExitError) {
					const result = {
						query,
						result: error.output,
						error: error.message,
						success: false,
					};
					rememberCommandResult(scope, commandKey, result);
					return result;
				}
				const msg = formatError(error);
				const result = {
					query,
					result: "",
					error: `Command failed: ${msg}`,
					success: false,
				};
				rememberCommandResult(scope, commandKey, result);
				return result;
			}
		}),
	);
}

// =============================================================================
// AgentTool Factory Functions
// =============================================================================

/**
 * Create the read_files tool
 *
 * Reads the content of one or more files from the filesystem.
 */
export function createReadFilesTool(
	executor: FileReadExecutor,
	config: Pick<DefaultToolsConfig, "fileReadTimeoutMs"> = {},
): AgentTool<ReadFilesInput, ToolOperationResult[]> {
	const timeoutMs = config.fileReadTimeoutMs ?? 10000;

	return createTool<ReadFilesInput, ToolOperationResult[]>({
		name: "read_files",
		description:
			"Read the content of text or image files at the provided absolute paths, or return only an inclusive one-based line range when start_line/end_line are provided. " +
			"When you already know multiple files you need, read them together in one call, and call this tool in the same response as other independent tool calls. " +
			`Each read returns at most ${MAX_READ_LINES} lines / ~${Math.round(MAX_READ_OUTPUT_CHARS / 1024)}k characters; longer files report their total line count, page through them with start_line/end_line. ` +
			"Binary files that are not image and large files are not supported. " +
			"Returns file contents or error messages for each path. ",
		inputSchema: zodToJsonSchema(ReadFilesInputSchema),
		timeoutMs: timeoutMs * 2, // Account for multiple files
		retryable: true,
		maxRetries: 1,
		execute: async (input, context) => {
			const validate = validateWithZod(ReadFilesInputUnionSchema, input);
			let requests: ReadFileRequest[];
			if (typeof validate === "string") {
				requests = [{ path: validate }];
			} else if (Array.isArray(validate)) {
				requests = validate.map((value) =>
					typeof value === "string" ? { path: value } : value,
				);
			} else if ("files" in validate) {
				const files = Array.isArray(validate.files)
					? validate.files
					: [validate.files];
				requests = files.map((file) =>
					typeof file === "string" ? { path: file } : file,
				);
			} else if ("file_paths" in validate) {
				const filePaths = Array.isArray(validate.file_paths)
					? validate.file_paths
					: [validate.file_paths];
				requests = filePaths.map((path) => ({ path }));
			} else if ("paths" in validate) {
				const paths = Array.isArray(validate.paths)
					? validate.paths
					: [validate.paths];
				requests = paths.map((path) =>
					typeof path === "string" ? { path } : path,
				);
			} else {
				requests = [validate];
			}

			return Promise.all(
				requests.map(async (request): Promise<ToolOperationResult> => {
					const rangeError = getReadFileRangeError(request);
					if (rangeError) {
						return {
							query: formatReadFileQuery(request),
							result: "",
							error: `Invalid file range: ${rangeError}`,
							success: false,
						};
					}

					try {
						const content = await withTimeout(
							executor(request, context),
							timeoutMs,
							`File read timed out after ${timeoutMs}ms`,
						);
						return {
							query: formatReadFileQuery(request),
							result: content,
							success: true,
						};
					} catch (error) {
						const msg = formatError(error);
						return {
							query: formatReadFileQuery(request),
							result: "",
							error: `Error reading file: ${msg}`,
							success: false,
						};
					}
				}),
			);
		},
	});
}

/**
 * Create the search_codebase tool
 *
 * Performs regex pattern searches across the codebase.
 */
export function createSearchTool(
	executor: SearchExecutor,
	config: Pick<DefaultToolsConfig, "cwd" | "searchTimeoutMs"> = {},
): AgentTool<SearchCodebaseInput, ToolOperationResult[]> {
	const timeoutMs = config.searchTimeoutMs ?? 30000;
	const cwd = config.cwd ?? process.cwd();

	return createTool<SearchCodebaseInput, ToolOperationResult[]>({
		name: "search_codebase",
		description:
			"Perform regex pattern searches across the codebase. " +
			"Supports multiple parallel searches. When several search patterns could be useful and do not depend on each other, run them together in one call, and call this tool in the same response as other independent tool calls. " +
			"Use for finding code patterns, function definitions, class names, imports, etc. " +
			`Output beyond ~${Math.round(MAX_SEARCH_OUTPUT_CHARS / 1000)}k characters per query is middle-truncated; narrow patterns beat broad ones.`,
		inputSchema: zodToJsonSchema(SearchCodebaseInputSchema),
		timeoutMs: timeoutMs * 2,
		retryable: true,
		maxRetries: 1,
		execute: async (input, context) => {
			// Validate input with Zod schema
			const validate = validateWithZod(SearchCodebaseUnionInputSchema, input);
			const queries = Array.isArray(validate)
				? validate
				: typeof validate === "object"
					? Array.isArray(validate.queries)
						? validate.queries
						: [validate.queries]
					: [validate];

			return Promise.all(
				queries.map(async (query): Promise<ToolOperationResult> => {
					try {
						const results = await withTimeout(
							executor(query, cwd, context),
							timeoutMs,
							`Search timed out after ${timeoutMs}ms`,
						);
						return {
							query,
							result: results,
							success: true,
						};
					} catch (error) {
						const msg = formatError(error);
						return {
							query,
							result: "",
							error: `Search failed: ${msg}`,
							success: false,
						};
					}
				}),
			);
		},
	});
}

/**
 * Create the run_commands shell tool for the current platform.
 *
 * This preserves the SDK's platform-specific prompting/schema choices while
 * exposing a single generic shell-tool factory for host integrations.
 */
export function createShellTool(
	executor: ShellExecutor,
	config: Pick<DefaultToolsConfig, "cwd" | "bashTimeoutMs"> = {},
): AgentTool<unknown, ToolOperationResult[]> {
	const timeoutMs = config.bashTimeoutMs ?? 30000;
	const timeoutSource =
		config.bashTimeoutMs === undefined
			? "default_setting"
			: "configured_setting";
	const cwd = config.cwd ?? process.cwd();
	const isWindows = process.platform === "win32";

	return createTool<unknown, ToolOperationResult[]>({
		name: "run_commands",
		description: isWindows
			? "Run shell commands from the root of the workspace in Windows environment. " +
				"Use for listing files, checking git status, running builds, executing tests, etc. " +
				`Output beyond ~${Math.round(MAX_COMMAND_OUTPUT_CHARS / 1000)}k characters is middle-truncated (start and end preserved); filter output when you need specific sections. ` +
				"Prefer structured { command, args } entries for portability; plain string commands should be properly shell-escaped. Include multiple commands in the same call when they are independent and safe to run concurrently. When independent reads, searches, or edits are also needed, call those tools in the same response."
			: "Run shell commands from the root of the workspace. " +
				"Use for listing files, checking git status, running builds, executing tests, etc. " +
				"Commands should be properly shell-escaped and targeted to avoid error or timeout. Include multiple commands in the same call when they are independent complete shell commands and safe to run concurrently; multiline scripts and heredocs must be a single command string. When independent reads, searches, or edits are also needed, call those tools in the same response. " +
				`Output beyond ~${Math.round(MAX_COMMAND_OUTPUT_CHARS / 1000)}k characters is middle-truncated (start and end preserved); pipe through grep/head/tail when you need specific sections of large output. ` +
				"For long-running commands, run them in background and redirect output to a tmp file that you can read from later.",
		inputSchema: zodToJsonSchema(RunCommandsInputSchema),
		timeoutMs: timeoutMs * 2,
		retryable: false,
		maxRetries: 0,
		execute: async (input, context) => {
			const commands = coalesceAdjacentStringHeredocs(
				normalizeRunCommandsInput(input),
			);

			return executeShellCommands(commands, {
				executor,
				cwd,
				context,
				timeoutMs,
				timeoutSource,
			});
		},
	});
}

/**
 * Create the fetch_web_content tool
 *
 * Fetches content from URLs and analyzes them using provided prompts.
 */
export function createWebFetchTool(
	executor: WebFetchExecutor,
	config: Pick<DefaultToolsConfig, "webFetchTimeoutMs"> = {},
): AgentTool<FetchWebContentInput, ToolOperationResult[]> {
	const timeoutMs = config.webFetchTimeoutMs ?? 30000;

	return createTool<FetchWebContentInput, ToolOperationResult[]>({
		name: "fetch_web_content",
		description:
			"Fetch content from URLs and analyze them using the provided prompts. " +
			"Use for retrieving documentation, API references, or any web content. " +
			"Each request includes a URL and a prompt describing what information to extract. Fetch independent URLs together in one call, and call this tool in the same response as other independent tool calls.",
		inputSchema: zodToJsonSchema(FetchWebContentInputSchema),
		timeoutMs: timeoutMs * 2,
		retryable: true,
		maxRetries: 2,
		execute: async (input, context) => {
			// Validate input with Zod schema
			const validatedInput = validateWithZod(FetchWebContentInputSchema, input);

			return Promise.all(
				validatedInput.requests.map(
					async (request): Promise<ToolOperationResult> => {
						try {
							const content = await withTimeout(
								executor(request.url, request.prompt, context),
								timeoutMs,
								`Web fetch timed out after ${timeoutMs}ms`,
							);
							return {
								query: request.url,
								result: content,
								success: true,
							};
						} catch (error) {
							const msg = formatError(error);
							return {
								query: request.url,
								result: "",
								error: `Error fetching web content: ${msg}`,
								success: false,
							};
						}
					},
				),
			);
		},
	});
}

const APPLY_PATCH_TOOL_DESC = `Use \`apply_patch\` to edit files with the canonical freeform patch grammar. Pass the patch text directly as the \`input\` string. Prefer the exact format below:

*** Begin Patch
*** Update File: path/to/file.ts
@@ optional section marker
 [context before]
-[old line]
+[new line]
 [context after]
*** End Patch

Supported actions:
- \`*** Add File: <path>\`
- \`*** Update File: <path>\`
- \`*** Delete File: <path>\`
- optional \`*** Move to: <new path>\` immediately after an Update File header

Rules:
- In an Add File section, every file-content line must start with \`+\`.
- In an Update section, use context lines plus \`-\` and \`+\` lines to describe the change.
- Use \`@@\` markers when extra context is needed to disambiguate repeated code blocks.
- Do not use line numbers; this format is context-based.
- Prefer sending the patch body directly. Legacy shell wrappers such as \`%%bash\` and \`apply_patch <<"EOF"\` are accepted for compatibility but are not preferred.

Example:

*** Begin Patch
*** Update File: src/page.tsx
@@
   return (
     <div>
       <button onClick={() => console.log("clicked")}>Click me</button>
+      <button onClick={() => console.log("cancel clicked")}>Cancel</button>
     </div>
   );
 }
*** End Patch`;

/**
 * Create the apply_patch tool
 *
 * Applies the canonical apply_patch format to one or more files.
 */
export function createApplyPatchTool(
	executor: ApplyPatchExecutor,
	config: Pick<DefaultToolsConfig, "cwd" | "applyPatchTimeoutMs"> = {},
): AgentTool<ApplyPatchInput, ToolOperationResult> {
	const timeoutMs = config.applyPatchTimeoutMs ?? 30000;
	const cwd = config.cwd ?? process.cwd();

	return createTool<ApplyPatchInput, ToolOperationResult>({
		name: "apply_patch",
		description: APPLY_PATCH_TOOL_DESC,
		inputSchema: zodToJsonSchema(ApplyPatchInputSchema),
		timeoutMs,
		retryable: false,
		maxRetries: 0,
		execute: async (input, context) => {
			const validate = validateWithZod(ApplyPatchInputUnionSchema, input);
			const patchInput =
				typeof validate === "string" ? validate : validate.input;

			try {
				const result = await withTimeout(
					executor({ input: patchInput }, cwd, context),
					timeoutMs,
					`apply_patch timed out after ${timeoutMs}ms`,
				);

				bumpScopeMutationRevision(context);
				return {
					query: "apply_patch",
					result,
					success: true,
				};
			} catch (error) {
				const msg = formatError(error);
				return {
					query: "apply_patch",
					result: "",
					error: `apply_patch failed: ${msg}`,
					success: false,
				};
			}
		},
	});
}

/**
 * Create the editor tool
 *
 * Supports controlled filesystem edits with create, replace, and insert commands.
 */
export function createEditorTool(
	executor: EditorExecutor,
	config: Pick<DefaultToolsConfig, "cwd" | "editorTimeoutMs"> = {},
): AgentTool<EditFileInput, ToolOperationResult> {
	const timeoutMs = config.editorTimeoutMs ?? 30000;
	const cwd = config.cwd ?? process.cwd();

	return createTool<EditFileInput, ToolOperationResult>({
		name: "editor",
		description:
			"An editor for controlled filesystem edits on the text file at the provided path. " +
			"Provide `insert_line` to insert `new_text` at a specific line number. " +
			"Otherwise, the tool replaces `old_text` with `new_text`, or creates the file with `new_text` if file does not exist. " +
			"Use this tool for making small, precise edits to existing files or creating new files over shell commands. If several edits to different files or non-overlapping regions are already known, emit multiple editor tool calls in the same response instead of serializing them across turns.",

		inputSchema: zodToJsonSchema(EditFileInputSchema),
		timeoutMs,
		retryable: false, // Editing operations are stateful and should not auto-retry
		maxRetries: 0,
		execute: async (input, context) => {
			const validatedInput = validateWithZod(EditFileInputSchema, input);
			const operation = validatedInput.insert_line == null ? "edit" : "insert";
			const sizeError = getEditorSizeError(validatedInput);

			if (sizeError) {
				return {
					query: `${operation}:${validatedInput.path}`,
					result: "",
					error: sizeError,
					success: false,
				};
			}

			try {
				const result = await withTimeout(
					executor(validatedInput, cwd, context),
					timeoutMs,
					`Editor operation timed out after ${timeoutMs}ms`,
				);

				bumpScopeMutationRevision(context);
				return {
					query: `${operation}:${validatedInput.path}`,
					result,
					success: true,
				};
			} catch (error) {
				const msg = formatError(error);
				return {
					query: `${operation}:${validatedInput.path}`,
					result: "",
					error: `Editor operation failed: ${msg}`,
					success: false,
				};
			}
		},
	});
}

/**
 * Create the skills tool
 *
 * Invokes a configured skill by name and optional arguments.
 */
export function createSkillsTool(
	executor: SkillsExecutorWithMetadata,
	config: Pick<DefaultToolsConfig, "skillsTimeoutMs"> = {},
): AgentTool<SkillsInput, string> {
	const timeoutMs = config.skillsTimeoutMs ?? 15000;

	const baseDescription =
		"Execute a skill within the main conversation. " +
		"When users ask you to perform tasks, check if any available skills match. " +
		"When users reference a slash command, invoke it with this tool. " +
		'Input: `skill` (required) and optional `args`. Example: `skill: "pdf"`, `skill: "commit", args: "-m \\"Fix bug\\""`, `skill: "review-pr", args: "123"`, `skill: "ms-office-suite:pdf"`. ' +
		"When a skill matches the user's request, invoking this tool is a blocking requirement before any other response. " +
		"Never mention a skill without invoking this tool.";

	const tool = createTool<SkillsInput, string>({
		name: "skills",
		description: baseDescription,
		inputSchema: zodToJsonSchema(SkillsInputSchema),
		timeoutMs,
		retryable: false,
		maxRetries: 0,
		execute: async (input, context) => {
			const validatedInput = validateWithZod(SkillsInputSchema, input);
			return withTimeout(
				executor(
					validatedInput.skill,
					validatedInput.args || undefined,
					context,
				),
				timeoutMs,
				`Skills operation timed out after ${timeoutMs}ms`,
			);
		},
	});

	Object.defineProperty(tool, "description", {
		get() {
			const skills = executor.configuredSkills
				?.filter((s) => !s.disabled)
				.map((s) => s.name);
			if (skills && skills.length > 0) {
				return `${baseDescription} Available skills: ${skills.join(", ")}.`;
			}
			return baseDescription;
		},
		enumerable: true,
		configurable: true,
	});

	return tool;
}

/**
 * Create the ask_question tool
 *
 * Asks the user a single clarifying question with 2-5 selectable options.
 */
export function createAskQuestionTool(
	executor: AskQuestionExecutor,
): AgentTool<AskQuestionInput, string> {
	return {
		name: "ask_question",
		description:
			"Ask user a question for clarifying or gathering information needed to complete the task. " +
			"For example, ask the user clarifying questions about a key implementation decision. " +
			"You should only ask one question. " +
			"Provide an array of 2-5 options for the user to choose from. " +
			"Never include an option to toggle to Act mode.",
		inputSchema: zodToJsonSchema(AskQuestionInputSchema),
		retryable: false,
		maxRetries: 0,
		execute: async (input, context) => {
			const validatedInput = validateWithZod(AskQuestionInputSchema, input);
			return executor(validatedInput.question, validatedInput.options, context);
		},
	};
}

export function createSubmitAndExitTool(
	executor: VerifySubmitExecutor,
	config: Pick<DefaultToolsConfig, "submitTimeoutMs"> = {},
): AgentTool<SubmitInput, string> {
	const timeoutMs = config.submitTimeoutMs ?? 15000;

	return createTool<SubmitInput, string>({
		name: "submit_and_exit",
		description:
			"Submit the final answer and exit the conversation. " +
			"For example, submit a summary of the investigation and confirm the issue is resolved. " +
			"You should only submit once all necessary steps are completed. " +
			"Make sure to verify your output matches the expected format, data types, and file locations specified. " +
			"Provide a summary of the investigation and confirm the issue is resolved.",
		inputSchema: zodToJsonSchema(SubmitInputSchema),
		lifecycle: {
			completesRun: true,
		},
		timeoutMs,
		retryable: false,
		maxRetries: 0,
		execute: async (input, context) => {
			const validatedInput = validateWithZod(SubmitInputSchema, input);
			return withTimeout(
				executor(validatedInput.summary, validatedInput.verified, context),
				timeoutMs,
				`submit_and_exit timed out after ${timeoutMs}ms`,
			);
		},
	});
}

// =============================================================================
// Default Tools Factory
// =============================================================================

/**
 * Create a set of default tools for an agent
 *
 * This function creates the default tools based on the provided configuration
 * and executors. Only tools that are enabled AND have an executor provided
 * will be included in the returned array.
 *
 * @example
 * ```typescript
 * import { Agent, createDefaultTools } from "@cline/core"
 * import * as fs from "fs/promises"
 * import { exec } from "child_process"
 *
 * const tools = createDefaultTools({
 *   executors: {
 *     readFile: async ({ path }) => fs.readFile(path, "utf-8"),
 *     bash: async (cmd, cwd) => {
 *       return new Promise((resolve, reject) => {
 *         exec(cmd, { cwd }, (err, stdout, stderr) => {
 *           if (err) reject(new Error(stderr || err.message))
 *           else resolve(stdout)
 *         })
 *       })
 *     },
 *   },
 *   enableReadFiles: true,
 *   enableBash: true,
 *   enableSearch: false, // Disabled
 *   enableWebFetch: false, // Disabled
 *   cwd: "/path/to/project",
 * })
 *
 * const agent = new Agent({
 *   // ... provider config
 *   tools,
 * })
 * ```
 */
export function createDefaultTools(
	options: CreateDefaultToolsOptions,
): AgentTool[] {
	const {
		executors,
		enableReadFiles = true,
		enableSearch = true,
		enableBash = true,
		enableWebFetch = true,
		enableApplyPatch = false,
		enableEditor = true,
		enableSkills = true,
		enableAskQuestion = true,
		enableSubmitAndExit = false,
		...config
	} = options;

	const tools: AgentTool<never, unknown>[] = [];

	// Add read_files tool if enabled and executor provided
	if (enableReadFiles && executors.readFile) {
		tools.push(createReadFilesTool(executors.readFile, config));
	}

	// Add search_codebase tool if enabled and executor provided
	if (enableSearch && executors.search) {
		tools.push(createSearchTool(executors.search, config));
	}

	// Add run_commands tool if enabled and executor provided
	if (enableBash && executors.bash) {
		tools.push(createShellTool(executors.bash, config));
	}

	// Add fetch_web_content tool if enabled and executor provided
	if (enableWebFetch && executors.webFetch) {
		tools.push(createWebFetchTool(executors.webFetch, config));
	}

	// Add editor tool if enabled and executor provided,
	// else check if apply_patch tool is enabled and executor provided
	// NOTE: Do not enable two similar tools at the same time.
	if (enableEditor && executors.editor) {
		tools.push(createEditorTool(executors.editor, config));
	} else if (enableApplyPatch && executors.applyPatch) {
		tools.push(createApplyPatchTool(executors.applyPatch, config));
	}

	// Add skills tool if enabled and executor provided
	if (enableSkills && executors.skills) {
		tools.push(createSkillsTool(executors.skills, config));
	}

	const submitExecutor = enableSubmitAndExit ? executors.submit : undefined;

	// Add ask_question tool if enabled and executor provided
	if (enableAskQuestion && executors.askQuestion && !submitExecutor) {
		tools.push(createAskQuestionTool(executors.askQuestion));
	}

	// Add submit_and_exit tool if enabled and executor provided
	if (submitExecutor) {
		tools.push(createSubmitAndExitTool(submitExecutor, config));
	}

	return tools as unknown as AgentTool[];
}
