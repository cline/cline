/**
 * Zod Schemas for Default Tool Inputs
 *
 * These schemas define the input structure for each default tool
 * and are used for both validation and JSON Schema generation.
 */

import { z } from "zod";

export const INPUT_ARG_CHAR_LIMIT = 6000;

/**
 * Schema for read tool input
 */
const AbsolutePath = z
	.string()
	.describe("The absolute file path of a text file to read content from");

export const ReadFileLineRangeSchema = z
	.object({
		start_line: z
			.number()
			.int()
			.positive()
			.nullable()
			.optional()
			.describe(
				"Optional one-based starting line number to read from; use null or omit for the start of the file",
			),
		end_line: z
			.number()
			.int()
			.positive()
			.nullable()
			.optional()
			.describe(
				"Optional one-based ending line number to read through; use null or omit to read to the end of the file or the read cap, whichever comes first",
			),
	})
	.describe("Optional inclusive one-based file line range");

export const ReadFileRequestSchema = z
	.object({
		path: AbsolutePath,
		start_line: ReadFileLineRangeSchema.shape.start_line,
		end_line: ReadFileLineRangeSchema.shape.end_line,
	})
	.describe(
		"A file read request with optional inclusive one-based line bounds",
	);

/**
 * Schema for read_files tool input
 */
export const ReadFilesInputSchema = z.object({
	files: z
		.array(ReadFileRequestSchema)
		.describe(
			"Array of file read requests. Omit start_line/end_line or set them to null to read from the start; provide integers to return only that inclusive one-based line range. Reads are capped, so page through long files with start_line/end_line. Prefer this tool over running terminal command to get file content for better performance and reliability.",
		),
});

/**
 * Union schema for read_files tool input, allowing either a single string, an array of strings, or the full object schema
 */
export const ReadFilesInputUnionSchema = z.union([
	ReadFilesInputSchema,
	ReadFileRequestSchema,
	z.array(ReadFileRequestSchema),
	z.array(z.string()),
	z.string(),
	z.object({ files: z.array(z.union([AbsolutePath, ReadFileRequestSchema])) }),
	z.object({ files: ReadFileRequestSchema }),
	z.object({ files: AbsolutePath }),
	z.object({ file_paths: z.array(AbsolutePath) }),
	z.object({ file_paths: z.string() }),
	z.object({ paths: z.array(z.union([AbsolutePath, ReadFileRequestSchema])) }),
	z.object({ paths: ReadFileRequestSchema }),
	z.object({ paths: z.string() }),
]);

/**
 * Schema for search_codebase tool input
 */
export const SearchCodebaseInputSchema = z.object({
	queries: z
		.array(z.string())
		.describe("Array of regex search queries to execute"),
});

/**
 * Union schema for search_codebase tool input, allowing either a single string, an array of strings, or the full object schema
 */
export const SearchCodebaseUnionInputSchema = z.union([
	SearchCodebaseInputSchema,
	z.array(z.string()),
	z.string(),
	z.object({ queries: z.string() }),
]);

const CommandInputSchema = z
	.string()
	.describe(
		`The non-interactive shell command to execute - MUST keep input short and concise (within ${INPUT_ARG_CHAR_LIMIT * 2} characters) to avoid timeouts.`,
	);

/**
 * Schema for run_commands tool input
 */
export const RunCommandsInputSchema = z.object({
	commands: z
		.array(CommandInputSchema)
		.describe("Array of shell commands to execute"),
});

/**
 * Union schema for run_commands tool input. More flexible.
 */
export const RunCommandsInputUnionSchema = z.union([
	RunCommandsInputSchema,
	z.object({ commands: CommandInputSchema }),
	z.object({ command: CommandInputSchema }),
	z.object({ cmd: CommandInputSchema }),
	z.array(z.string()),
	z.string(),
]);

export const StructuredCommandInputSchema = z.object({
	command: z
		.string()
		.min(1)
		.describe("The executable to run directly without shell parsing."),
	args: z
		.array(z.string())
		.optional()
		.describe("Optional argv list passed directly to the executable."),
});

export const StructuredCommandEntrySchema = z.union([
	CommandInputSchema,
	StructuredCommandInputSchema,
]);
/**
 * Schema for run_commands tool input
 */
export const StructuredCommandsInputSchema = z.object({
	commands: z
		.array(StructuredCommandEntrySchema)
		.describe(
			"Array of commands to execute. Prefer structured { command, args } entries for portability; plain strings are still supported and are interpreted by the active shell.",
		),
});

/**
 * Union schema for run_commands tool input. More flexible.
 */
export const StructuredCommandsInputUnionSchema = z.union([
	RunCommandsInputSchema,
	StructuredCommandsInputSchema,
	z.object({ commands: StructuredCommandEntrySchema }),
	z.array(StructuredCommandInputSchema),
	StructuredCommandInputSchema,
	z.object({ command: CommandInputSchema }),
	z.object({ cmd: CommandInputSchema }),
	z.array(z.string()),
	z.string(),
]);

/**
 * Schema for a single web fetch request
 */
export const WebFetchRequestSchema = z.object({
	url: z.string().describe("The URL to fetch"),
	prompt: z.string().min(2).describe("Analysis prompt for the fetched content"),
});

/**
 * Schema for fetch_web_content tool input
 */
export const FetchWebContentInputSchema = z.object({
	requests: z
		.array(WebFetchRequestSchema)
		.describe("Array of the URLs for the web fetch requests"),
});

/**
 * Schema for editor tool input
 */
export const EditFileInputSchema = z
	.object({
		path: z
			.string()
			.min(1)
			.describe("The absolute file path for the action to be performed on"),
		old_text: z
			.string()
			.nullable()
			.optional()
			.describe(
				`Exact text to replace (must match exactly once). Omit this when creating a missing file or inserting via insert_line. Keep this at or below ${INPUT_ARG_CHAR_LIMIT} characters when possible; larger payloads should be split across multiple tool calls to avoid timeouts.`,
			),
		new_text: z
			.string()
			.describe(
				`The new content to write when creating a missing file, the replacement text for edits, or the inserted text when insert_line is provided. Keep this at or below ${INPUT_ARG_CHAR_LIMIT} characters when possible; for large edits, use multiple calls with small chunks of old_text and new_text to iteratively edit the file.`,
			),
		insert_line: z
			.number()
			.int()
			.nullable()
			.optional()
			.describe(
				"Optional positive one-based boundary line. When provided, the tool inserts new_text before that line instead of performing a replacement edit; use line_count + 1 to append at EOF.",
			),
	})
	.describe(
		"Edit a text file by replacing old_text with new_text, create the file with new_text if it does not exist, or insert new_text at insert_line when insert_line is provided. Prefer using this tool for file edits over shell commands. IMPORTANT: large edits can time out, so use small chunks and multiple calls when possible.",
	);

/**
 * Schema for apply_patch tool input
 */
export const ApplyPatchInputSchema = z
	.object({
		input: z
			.string()
			.min(1)
			.describe(
				"The freeform apply_patch payload in the canonical patch grammar (e.g *** Begin Patch, *** Update File:, @@, and *** End Patch).",
			),
	})
	.describe(
		"Modify or create a text file by applying patches using the canonical apply_patch diff grammar. Prefer sending the patch body directly rather than wrapping it in shell syntax. IMPORTANT: large patches can time out, so use small chunks and multiple calls when possible.",
	);
export const ApplyPatchInputUnionSchema = z.union([
	ApplyPatchInputSchema,
	z.string(),
]);

/**
 * Schema for skills tool input
 */
export const SkillsInputSchema = z.object({
	skill: z.string().min(1).describe("Name of the skill to execute."),
	args: z
		.string()
		.nullable()
		.optional()
		.describe("Arguments for the skill; use null when omitted"),
});

/**
 * Schema for ask_followup_question tool input
 */
export const AskQuestionInputSchema = z.object({
	question: z
		.string()
		.min(1)
		.describe(
			'The single question to ask the user. E.g. "How can I help you?"',
		),
	options: z
		.array(z.string().min(1))
		.min(2)
		.max(5)
		.describe(
			"Array of 2-5 user-selectable answer options for the single question",
		),
});

/**
 * Schema for a single ask_question option supplied as an object.
 *
 * Some models emit structured option entries such as
 * `{ key, label, description }` instead of plain strings. Accept the common
 * key variants and normalize them to a display string at execution time.
 */
export const AskQuestionOptionObjectSchema = z
	.object({
		label: z.string().min(1).optional(),
		value: z.string().min(1).optional(),
		title: z.string().min(1).optional(),
		name: z.string().min(1).optional(),
		key: z.string().min(1).optional(),
		description: z.string().optional(),
	})
	.refine(
		(option) =>
			Boolean(
				option.label ??
					option.value ??
					option.title ??
					option.name ??
					option.key,
			),
		{
			message:
				"Option object must include a non-empty label, value, title, name, or key",
		},
	);

/**
 * Union schema for ask_question tool input. Accepts options as plain strings or
 * as structured objects, mirroring the read_files union-schema flexibility.
 */
export const AskQuestionInputUnionSchema = z.object({
	question: z
		.string()
		.min(1)
		.describe(
			'The single question to ask the user. E.g. "How can I help you?"',
		),
	options: z
		.array(z.union([z.string().min(1), AskQuestionOptionObjectSchema]))
		.min(2)
		.max(5)
		.describe(
			"Array of 2-5 user-selectable answer options for the single question",
		),
});

/**
 * Normalize ask_question options to display strings, collapsing any structured
 * option objects down to their most descriptive label.
 */
export function normalizeAskQuestionOptions(
	options: z.infer<typeof AskQuestionInputUnionSchema>["options"],
): string[] {
	return options.map((option) =>
		typeof option === "string"
			? option
			: (option.label ??
				option.value ??
				option.title ??
				option.name ??
				option.key ??
				""),
	);
}

export const SubmitInputSchema = z.object({
	summary: z
		.string()
		.min(10)
		.describe(
			"Summarization of the investigation, steps taken, and resolution status to submit at the end of the session. Before submitting, read the problem again along with any provided test's assertions carefully and confirm your fix produces the expected output.",
		),
	verified: z
		.boolean()
		.describe(
			`Have you verified that the issue is resolved to the best of your knowledge, including updating and creating all the requested files and items? 'True' if you have completed the investigation and taken all necessary steps to resolve the issue.\n'False' if you have done all you can but cannot resolve the issue or if you are stuck and cannot proceed further. =\nIMPORTANT: You must run the specific failing test(s) mentioned in the issue or test patch and include the test output in your reasoning. If the test still fails after your fix, you must revise. Do NOT submit with 'true' unless the test output shows the test passing.`,
		),
});

// =============================================================================
// Type Definitions (derived from Zod schemas)
// =============================================================================

/**
 * Input for a single file read request
 */
export type ReadFileRequest = z.infer<typeof ReadFileRequestSchema>;

/**
 * Input for the read_files tool
 */
export type ReadFilesInput = z.infer<typeof ReadFilesInputSchema>;

/**
 * Input for the search_codebase tool
 */
export type SearchCodebaseInput = z.infer<typeof SearchCodebaseInputSchema>;

/**
 * Input for the run_commands tool
 */
export type RunCommandsInput = z.infer<typeof RunCommandsInputSchema>;
export type StructuredCommandInput = z.infer<
	typeof StructuredCommandInputSchema
>;

/**
 * Web fetch request parameters
 */
export type WebFetchRequest = z.infer<typeof WebFetchRequestSchema>;

/**
 * Input for the fetch_web_content tool
 */
export type FetchWebContentInput = z.infer<typeof FetchWebContentInputSchema>;

/**
 * Input for the editor tool
 */
export type EditFileInput = z.infer<typeof EditFileInputSchema>;

/**
 * Input for the apply_patch tool
 */
export type ApplyPatchInput = z.infer<typeof ApplyPatchInputSchema>;

/**
 * Input for the skills tool
 */
export type SkillsInput = z.infer<typeof SkillsInputSchema>;

/**
 * Input for the ask_followup_question tool
 */
export type AskQuestionInput = z.infer<typeof AskQuestionInputSchema>;

/**
 * Input for the submit and exit tool
 */
export type SubmitInput = z.infer<typeof SubmitInputSchema>;
