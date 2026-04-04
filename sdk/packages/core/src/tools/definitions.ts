/**
 * Default Tool Definitions
 *
 * Factory functions for creating the default tools.
 */

import { createTool, type Tool } from "@clinebot/agents";
import { validateWithZod, zodToJsonSchema } from "@clinebot/shared";
import {
	formatError,
	formatReadFileQuery,
	formatRunCommandQuery,
	getEditorSizeError,
	normalizeReadFileRequests,
	normalizeRunCommandsInput,
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
	type ReadFilesInput,
	ReadFilesInputSchema,
	type RunCommandsInput,
	RunCommandsInputSchema,
	RunCommandsInputUnionSchema,
	type SearchCodebaseInput,
	SearchCodebaseInputSchema,
	SearchCodebaseUnionInputSchema,
	type SkillsInput,
	SkillsInputSchema,
	type StructuredCommandInput,
	StructuredCommandsInputUnionSchema,
	type SubmitInput,
	SubmitInputSchema,
} from "./schemas";
import type {
	ApplyPatchExecutor,
	AskQuestionExecutor,
	BashExecutor,
	CreateDefaultToolsOptions,
	DefaultToolsConfig,
	EditorExecutor,
	FileReadExecutor,
	SearchExecutor,
	SkillsExecutorWithMetadata,
	ToolOperationResult,
	VerifySubmitExecutor,
	WebFetchExecutor,
} from "./types";

// =============================================================================
// Helper Functions
// =============================================================================

// =============================================================================
// Tool Factory Functions
// =============================================================================

/**
 * Create the read_files tool
 *
 * Reads the content of one or more files from the filesystem.
 */
export function createReadFilesTool(
	executor: FileReadExecutor,
	config: Pick<DefaultToolsConfig, "fileReadTimeoutMs"> = {},
): Tool<ReadFilesInput, ToolOperationResult[]> {
	const timeoutMs = config.fileReadTimeoutMs ?? 10000;

	return createTool<ReadFilesInput, ToolOperationResult[]>({
		name: "read_files",
		description:
			"Read the full content of text files at the provided absolute paths, or return only an inclusive one-based line range when start_line/end_line are provided. " +
			"Returns file contents or error messages for each path.",
		inputSchema: zodToJsonSchema(ReadFilesInputSchema),
		timeoutMs: timeoutMs * 2, // Account for multiple files
		retryable: true,
		maxRetries: 1,
		execute: async (input, context) => {
			const requests = normalizeReadFileRequests(input);

			return Promise.all(
				requests.map(async (request): Promise<ToolOperationResult> => {
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
): Tool<SearchCodebaseInput, ToolOperationResult[]> {
	const timeoutMs = config.searchTimeoutMs ?? 30000;
	const cwd = config.cwd ?? process.cwd();

	return createTool<SearchCodebaseInput, ToolOperationResult[]>({
		name: "search_codebase",
		description:
			"Perform regex pattern searches across the codebase. " +
			"Supports multiple parallel searches. " +
			"Use for finding code patterns, function definitions, class names, imports, etc.",
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
						// Check if results contain matches
						const hasResults =
							results.length > 0 && !results.includes("No results found");
						return {
							query,
							result: results,
							success: hasResults,
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
 * Create the run_commands tool
 *
 * Executes shell commands in the project directory.
 */
export function createBashTool(
	executor: BashExecutor,
	config: Pick<DefaultToolsConfig, "cwd" | "bashTimeoutMs"> = {},
): Tool<RunCommandsInput, ToolOperationResult[]> {
	const timeoutMs = config.bashTimeoutMs ?? 30000;
	const cwd = config.cwd ?? process.cwd();

	return createTool<RunCommandsInput, ToolOperationResult[]>({
		name: "run_commands",
		description:
			"Run shell commands from the root of the workspace. " +
			"Use for listing files, checking git status, running builds, executing tests, etc. " +
			"Commands should be properly shell-escaped.",
		inputSchema: zodToJsonSchema(RunCommandsInputSchema),
		timeoutMs: timeoutMs * 2,
		retryable: false, // Shell commands often have side effects
		maxRetries: 0,
		execute: async (input, context) => {
			const validate = validateWithZod(RunCommandsInputUnionSchema, input);
			const commands = Array.isArray(validate)
				? validate
				: typeof validate === "object"
					? Array.isArray(validate.commands)
						? validate.commands
						: [validate.commands]
					: [validate];

			return Promise.all(
				commands.map(async (command): Promise<ToolOperationResult> => {
					try {
						const output = await withTimeout(
							executor(command, cwd, context),
							timeoutMs,
							`Command timed out after ${timeoutMs}ms`,
						);
						return {
							query: command,
							result: output,
							success: true,
						};
					} catch (error) {
						const msg = formatError(error);
						return {
							query: command,
							result: "",
							error: `Command failed: ${msg}`,
							success: false,
						};
					}
				}),
			);
		},
	});
}

/**
 * Create the run_commands tool
 *
 * Executes shell commands in the project directory.
 */
export function createWindowsShellTool(
	executor: BashExecutor,
	config: Pick<DefaultToolsConfig, "cwd" | "bashTimeoutMs"> = {},
): Tool<StructuredCommandInput, ToolOperationResult[]> {
	const timeoutMs = config.bashTimeoutMs ?? 30000;
	const cwd = config.cwd ?? process.cwd();

	return createTool<StructuredCommandInput, ToolOperationResult[]>({
		name: "run_commands",
		description:
			"Run shell commands from the root of the workspacein Windows environment. " +
			"Use for listing files, checking git status, running builds, executing tests, etc. " +
			"Prefer structured { command, args } entries for portability; plain string commands should be properly shell-escaped.",
		inputSchema: zodToJsonSchema(StructuredCommandsInputUnionSchema),
		timeoutMs: timeoutMs * 2,
		retryable: false, // Shell commands often have side effects
		maxRetries: 0,
		execute: async (input, context) => {
			const commands = normalizeRunCommandsInput(input);

			return Promise.all(
				commands.map(async (command): Promise<ToolOperationResult> => {
					try {
						const output = await withTimeout(
							executor(command, cwd, context),
							timeoutMs,
							`Command timed out after ${timeoutMs}ms`,
						);
						return {
							query: formatRunCommandQuery(command),
							result: output,
							success: true,
						};
					} catch (error) {
						const msg = formatError(error);
						return {
							query: formatRunCommandQuery(command),
							result: "",
							error: `Command failed: ${msg}`,
							success: false,
						};
					}
				}),
			);
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
): Tool<FetchWebContentInput, ToolOperationResult[]> {
	const timeoutMs = config.webFetchTimeoutMs ?? 30000;

	return createTool<FetchWebContentInput, ToolOperationResult[]>({
		name: "fetch_web_content",
		description:
			"Fetch content from URLs and analyze them using the provided prompts. " +
			"Use for retrieving documentation, API references, or any web content. " +
			"Each request includes a URL and a prompt describing what information to extract.",
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

const APPLY_PATCH_TOOL_DESC = `This is a custom utility that makes it more convenient to add, remove, move, or edit code in a single file. \`apply_patch\` effectively allows you to execute a diff/patch against a file, but the format of the diff specification is unique to this task, so pay careful attention to these instructions. To use the \`apply_patch\` command, you should pass a message of the following structure as "input":

%%bash
apply_patch <<"EOF"
*** Begin Patch
[YOUR_PATCH]
*** End Patch
EOF

Where [YOUR_PATCH] is the actual content of your patch, specified in the following V4A diff format.

*** [ACTION] File: [path/to/file] -> ACTION can be one of Add, Update, or Delete. 

In a Add File section, every line of the new file (including blank/empty lines) MUST start with a \`+\` prefix. Do not include any unprefixed lines inside an Add section
In a Update/Delete section, repeat the following for each snippet of code that needs to be changed:
[context_before] -> See below for further instructions on context.
- [old_code] -> Precede the old code with a minus sign.
+ [new_code] -> Precede the new, replacement code with a plus sign.
[context_after] -> See below for further instructions on context.

For instructions on [context_before] and [context_after]:
- By default, show 3 lines of code immediately above and 3 lines immediately below each change. If a change is within 3 lines of a previous change, do NOT duplicate the first change’s [context_after] lines in the second change’s [context_before] lines.
- If 3 lines of context is insufficient to uniquely identify the snippet of code within the file, use the @@ operator to indicate the class or function to which the snippet belongs. For instance, we might have:
@@ class BaseClass
[3 lines of pre-context]
- [old_code]
+ [new_code]
[3 lines of post-context]

- If a code block is repeated so many times in a class or function such that even a single @@ statement and 3 lines of context cannot uniquely identify the snippet of code, you can use multiple \`@@\` statements to jump to the right context. For instance:

@@ class BaseClass
@@ 	def method():
[3 lines of pre-context]
- [old_code]
+ [new_code]
[3 lines of post-context]

Note, then, that we do not use line numbers in this diff format, as the context is enough to uniquely identify code. An example of a message that you might pass as "input" to this function, in order to apply a patch, is shown below.

%%bash
apply_patch <<"EOF"
*** Begin Patch
*** Update File: pygorithm/searching/binary_search.py
@@ class BaseClass
@@     def search():
-          pass
+          raise NotImplementedError()

@@ class Subclass
@@     def search():
-          pass
+          raise NotImplementedError()

*** End Patch
EOF`;

/**
 * Create the apply_patch tool
 *
 * Applies the legacy Cline patch format to one or more files.
 */
export function createApplyPatchTool(
	executor: ApplyPatchExecutor,
	config: Pick<DefaultToolsConfig, "cwd" | "applyPatchTimeoutMs"> = {},
): Tool<ApplyPatchInput, ToolOperationResult> {
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
): Tool<EditFileInput, ToolOperationResult> {
	const timeoutMs = config.editorTimeoutMs ?? 30000;
	const cwd = config.cwd ?? process.cwd();

	return createTool<EditFileInput, ToolOperationResult>({
		name: "editor",
		description:
			"An editor for controlled filesystem edits on the text file at the provided path. " +
			"Provide `insert_line` to insert `new_text` at a specific line number. " +
			"Otherwise, the tool replaces `old_text` with `new_text`, or creates the file with `new_text` if file does not exist. " +
			"Use this tools for making small, precise edits to existing files or creating new files over shell commands.",

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
): Tool<SkillsInput, string> {
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
	config: Pick<DefaultToolsConfig, "askQuestionTimeoutMs"> = {},
): Tool<AskQuestionInput, string> {
	const timeoutMs = config.askQuestionTimeoutMs ?? 15000;

	return createTool<AskQuestionInput, string>({
		name: "ask_question",
		description:
			"Ask user a question for clarifying or gathering information needed to complete the task. " +
			"For example, ask the user clarifying questions about a key implementation decision. " +
			"You should only ask one question. " +
			"Provide an array of 2-5 options for the user to choose from. " +
			"Never include an option to toggle to Act mode.",
		inputSchema: zodToJsonSchema(AskQuestionInputSchema),
		timeoutMs,
		retryable: false,
		maxRetries: 0,
		execute: async (input, context) => {
			const validatedInput = validateWithZod(AskQuestionInputSchema, input);
			return withTimeout(
				executor(validatedInput.question, validatedInput.options, context),
				timeoutMs,
				`ask_question timed out after ${timeoutMs}ms`,
			);
		},
	});
}

export function createSubmitAndExitTool(
	executor: VerifySubmitExecutor,
	config: Pick<DefaultToolsConfig, "submitTimeoutMs"> = {},
): Tool<SubmitInput, string> {
	const timeoutMs = config.submitTimeoutMs ?? 15000;

	return createTool<SubmitInput, string>({
		name: "submit_and_exit",
		description:
			"Submit the final answer and exit the conversation. " +
			"For example, submit a summary of the investigation and confirm the issue is resolved. " +
			"You should only submit once all necessary steps are completed. " +
			"Provide a summary of the investigation and confirm the issue is resolved.",
		inputSchema: zodToJsonSchema(SubmitInputSchema),
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
 * import { Agent } from "@clinebot/agents"
 * import { createDefaultTools } from "@clinebot/core"
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
export function createDefaultTools(options: CreateDefaultToolsOptions): Tool[] {
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

	const tools: Tool<any>[] = [];

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
		if (process.platform === "win32") {
			tools.push(createWindowsShellTool(executors.bash, config));
		} else {
			tools.push(createBashTool(executors.bash, config));
		}
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

	// Add ask_question tool if enabled and executor provided
	if (enableAskQuestion && executors.askQuestion) {
		tools.push(createAskQuestionTool(executors.askQuestion, config));
	} else if (enableSubmitAndExit && executors.submit) {
		// Add submit_and_exit tool if enabled and executor provided
		tools.push(createSubmitAndExitTool(executors.submit, config));
	}

	return tools;
}
