import type { AgentTool } from "@cline/shared";
import { createTwoFilesPatch } from "diff";
import { sanitizeLogMessage } from "@/lib/api";
import { getServerEnv } from "@/lib/env";
import { checkCommand, shellQuote } from "@/lib/sandbox/guard";
import { normalizeWorkspacePath } from "@/lib/sandbox/path";
import type { SandboxProvider } from "@/lib/sandbox/types";
import { getServiceClient } from "@/lib/supabase/service";
import type { ApprovalMode } from "@/lib/types";
import { truncate } from "@/lib/utils";

const IGNORED_DIRS = new Set([
	".git",
	".next",
	"node_modules",
	"dist",
	"build",
	"target",
	"coverage",
	".venv",
	"venv",
	"__pycache__",
	".turbo",
	".cache",
]);

export type AgentRunState = {
	finished: boolean;
	approvalPending: boolean;
	summary?: string;
	testsRun: string[];
	remainingIssues: string[];
};

export type ToolRuntime = {
	taskId: string;
	projectId: string;
	ownerId: string;
	workspaceId: string;
	sandboxId: string;
	rootPath: string;
	language: string;
	approvalMode: ApprovalMode;
	provider: SandboxProvider;
	state: AgentRunState;
	emit: (type: string, message: string, payload?: Record<string, unknown>) => Promise<void>;
};

function maxOutputChars(): number {
	return getServerEnv().SANDBOX_MAX_OUTPUT_CHARS;
}

function capOutput(output: string): string {
	const limit = maxOutputChars();
	if (output.length <= limit) return output;
	const head = Math.floor(limit * 0.7);
	const tail = Math.floor(limit * 0.25);
	return `${output.slice(0, head)}\n\n… [21 Agent truncated ${output.length - head - tail} characters] …\n\n${output.slice(-tail)}`;
}

function assertWritable(runtime: ToolRuntime): void {
	if (runtime.approvalMode === "read_only") {
		throw new Error("This project is in read-only mode; write and execution tools are disabled.");
	}
}

async function readTextIfExists(
	runtime: ToolRuntime,
	relativePath: string,
): Promise<string | null> {
	try {
		const buffer = await runtime.provider.readFile(
			runtime.sandboxId,
			runtime.rootPath,
			relativePath,
		);
		return buffer.toString("utf8");
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const detail =
			error && typeof error === "object" && "detail" in error
				? String((error as { detail?: unknown }).detail ?? "")
				: "";
		if (/not found|no such file|enoent|404|could not find/i.test(`${message} ${detail}`)) {
			return null;
		}
		throw error;
	}
}

async function recordChange(input: {
	runtime: ToolRuntime;
	path: string;
	before: string | null;
	after: string | null;
	changeType: "create" | "update" | "delete" | "revert";
	toolCallId?: string;
}): Promise<void> {
	const { runtime } = input;
	let diff = "";
	try {
		diff = createTwoFilesPatch(
			input.path,
			input.path,
			input.before ?? "",
			input.after ?? "",
			input.before === null ? "/dev/null" : "before",
			input.after === null ? "/dev/null" : "after",
			{ context: 3 },
		);
	} catch {
		diff = "";
	}
	const { error } = await getServiceClient()
		.from("a21_file_changes")
		.insert({
			project_id: runtime.projectId,
			task_id: runtime.taskId,
			owner_id: runtime.ownerId,
			path: input.path,
			change_type: input.changeType,
			before_content: input.before === null ? null : input.before.slice(0, 400_000),
			after_content: input.after === null ? null : input.after.slice(0, 400_000),
			diff: diff.slice(0, 250_000),
			status: "applied",
			tool_call_id: input.toolCallId ?? null,
		});
	if (error) {
		throw new Error(`Could not record the file change: ${error.message}`);
	}
}

async function recordDeletedChange(
	runtime: ToolRuntime,
	relativePath: string,
	before: string | null,
	toolCallId?: string,
): Promise<void> {
	await recordChange({
		runtime,
		path: relativePath,
		before,
		after: null,
		changeType: "delete",
		toolCallId,
	});
}

export function buildAgentTools(runtime: ToolRuntime): AgentTool<any, any>[] {
	const tools: AgentTool<any, any>[] = [
		{
			name: "list_files",
			description:
				"List files and directories inside the project workspace. Use depth 2-4. Ignored build/dependency directories are hidden by default.",
			inputSchema: {
				type: "object",
				properties: {
					path: { type: "string", description: "Workspace-relative directory (default '.')" },
					depth: { type: "integer", minimum: 1, maximum: 4, description: "Recursion depth" },
					include_ignored: {
						type: "boolean",
						description: "Include node_modules, .git, dist, etc.",
					},
				},
				additionalProperties: false,
			},
			async execute(input: { path?: string; depth?: number; include_ignored?: boolean }) {
				const relativePath = normalizeWorkspacePath(input.path ?? ".", { allowRoot: true });
				const files = await runtime.provider.listFiles(
					runtime.sandboxId,
					runtime.rootPath,
					relativePath,
					input.depth ?? 2,
				);
				const filtered = input.include_ignored
					? files
					: files.filter((file) => {
							const parts = file.path.split("/");
							return !parts.some((part) => IGNORED_DIRS.has(part));
						});
				const limited = filtered.slice(0, 500);
				const lines = limited.map((file) => `${file.type === "dir" ? "📁" : "📄"} ${file.path}`);
				return {
					path: relativePath,
					entries: limited,
					tree: lines.join("\n") || "(empty directory)",
					truncated: filtered.length > limited.length,
					total: filtered.length,
				};
			},
		},
		{
			name: "read_file",
			description:
				"Read a UTF-8 file from the workspace. Returns line-numbered content. Line numbers are for reference only; edit_file matches raw text.",
			inputSchema: {
				type: "object",
				properties: {
					path: { type: "string", description: "Workspace-relative file path" },
					start_line: { type: "integer", minimum: 1, description: "First line (1-based)" },
					end_line: { type: "integer", minimum: 1, description: "Last line inclusive" },
				},
				required: ["path"],
				additionalProperties: false,
			},
			async execute(input: { path: string; start_line?: number; end_line?: number }) {
				const relativePath = normalizeWorkspacePath(input.path);
				const buffer = await runtime.provider.readFile(
					runtime.sandboxId,
					runtime.rootPath,
					relativePath,
				);
				const text = buffer.toString("utf8");
				if (text.includes("\u0000")) {
					throw new Error("That file appears to be binary and cannot be read as text.");
				}
				const lines = text.split("\n");
				const start = Math.max(1, input.start_line ?? 1);
				const end = Math.min(lines.length, input.end_line ?? start + 1999);
				if (start > lines.length) {
					return {
						path: relativePath,
						content: "",
						note: `File has ${lines.length} lines; start_line ${start} is past the end.`,
					};
				}
				const selected = lines.slice(start - 1, end);
				const numbered = selected.map((line, i) => `${start + i}\t${line}`).join("\n");
				return {
					path: relativePath,
					startLine: start,
					endLine: end,
					totalLines: lines.length,
					content: truncate(numbered, maxOutputChars()),
					truncated: numbered.length > maxOutputChars(),
				};
			},
		},
		{
			name: "search_files",
			description:
				"Search workspace text files with grep. Returns file:line matches. Use this to locate symbols, routes, tests and config.",
			inputSchema: {
				type: "object",
				properties: {
					query: { type: "string", description: "Literal text to search for (not a regex)" },
					path: { type: "string", description: "Workspace-relative directory (default '.')" },
				},
				required: ["query"],
				additionalProperties: false,
			},
			async execute(input: { query: string; path?: string }) {
				if (!input.query || input.query.length > 500) {
					throw new Error("Search query must be between 1 and 500 characters.");
				}
				const relativePath = normalizeWorkspacePath(input.path ?? ".", { allowRoot: true });
				const command = [
					"grep -RIn -I -F",
					"--exclude-dir=.git --exclude-dir=node_modules --exclude-dir=.next",
					"--exclude-dir=dist --exclude-dir=build --exclude-dir=target --exclude-dir=coverage",
					`-- ${shellQuote(input.query)} ${shellQuote(relativePath)} | head -120`,
				].join(" ");
				const result = await runtime.provider.execute(
					runtime.sandboxId,
					runtime.rootPath,
					command,
					{ timeoutSeconds: 30 },
				);
				if (result.exitCode === 1 && result.output.trim() === "") {
					return { matches: "", count: 0, note: "No matches found." };
				}
				return {
					matches: capOutput(result.output),
					exitCode: result.exitCode,
					truncated: result.output.length > maxOutputChars(),
				};
			},
		},
		{
			name: "git_status",
			description:
				"Inspect git status and diff statistics for the workspace. Read-only; does not modify the repository.",
			inputSchema: {
				type: "object",
				properties: {},
				additionalProperties: false,
			},
			async execute() {
				const result = await runtime.provider.execute(
					runtime.sandboxId,
					runtime.rootPath,
					"git status --short --branch 2>&1; echo '---DIFF---'; git diff --stat 2>&1",
					{ timeoutSeconds: 30 },
				);
				return { output: capOutput(result.output), exitCode: result.exitCode };
			},
		},
	];

	if (runtime.approvalMode !== "read_only") {
		tools.push(
			{
				name: "write_file",
				description:
					"Create or fully replace a UTF-8 text file in the workspace. Prefer edit_file for small changes. Parent directories are created automatically.",
				inputSchema: {
					type: "object",
					properties: {
						path: { type: "string", description: "Workspace-relative file path" },
						content: { type: "string", description: "Complete new file content" },
					},
					required: ["path", "content"],
					additionalProperties: false,
				},
				async execute(input: { path: string; content: string }, context: { toolCallId?: string }) {
					assertWritable(runtime);
					const relativePath = normalizeWorkspacePath(input.path);
					if (input.content.length > 500_000) {
						throw new Error("File content exceeds the 500,000 character limit.");
					}
					const before = await readTextIfExists(runtime, relativePath);
					await runtime.provider.writeFile(
						runtime.sandboxId,
						runtime.rootPath,
						relativePath,
						input.content,
					);
					await recordChange({
						runtime,
						path: relativePath,
						before,
						after: input.content,
						changeType: before === null ? "create" : "update",
						toolCallId: context?.toolCallId,
					});
					return {
						path: relativePath,
						action: before === null ? "created" : "updated",
						bytes: Buffer.byteLength(input.content, "utf8"),
					};
				},
			},
			{
				name: "edit_file",
				description:
					"Replace an exact snippet in an existing file. Fails if old_text is missing or appears more than once unless replace_all is true.",
				inputSchema: {
					type: "object",
					properties: {
						path: { type: "string" },
						old_text: { type: "string", description: "Exact text to replace" },
						new_text: { type: "string", description: "Replacement text" },
						replace_all: { type: "boolean", description: "Replace every occurrence" },
					},
					required: ["path", "old_text", "new_text"],
					additionalProperties: false,
				},
				async execute(
					input: {
						path: string;
						old_text: string;
						new_text: string;
						replace_all?: boolean;
					},
					context: { toolCallId?: string },
				) {
					assertWritable(runtime);
					const relativePath = normalizeWorkspacePath(input.path);
					const before = await readTextIfExists(runtime, relativePath);
					if (before === null) {
						throw new Error(`File not found: ${relativePath}. Use write_file for new files.`);
					}
					const occurrences = before.split(input.old_text).length - 1;
					if (occurrences === 0) {
						throw new Error(
							"old_text was not found in the file. Read the file again and copy exact text.",
						);
					}
					if (occurrences > 1 && !input.replace_all) {
						throw new Error(
							`old_text appears ${occurrences} times. Provide a more specific snippet or set replace_all true.`,
						);
					}
					const after = input.replace_all
						? before.split(input.old_text).join(input.new_text)
						: before.replace(input.old_text, input.new_text);
					await runtime.provider.writeFile(
						runtime.sandboxId,
						runtime.rootPath,
						relativePath,
						after,
					);
					await recordChange({
						runtime,
						path: relativePath,
						before,
						after,
						changeType: "update",
						toolCallId: context?.toolCallId,
					});
					return {
						path: relativePath,
						replacements: input.replace_all ? occurrences : 1,
						bytes: Buffer.byteLength(after, "utf8"),
					};
				},
			},
			{
				name: "delete_file",
				description:
					"Delete a file from the workspace. Requires approval when the project enforces it.",
				inputSchema: {
					type: "object",
					properties: { path: { type: "string" } },
					required: ["path"],
					additionalProperties: false,
				},
				async execute(input: { path: string }, context: { toolCallId?: string }) {
					assertWritable(runtime);
					const relativePath = normalizeWorkspacePath(input.path);
					const before = await readTextIfExists(runtime, relativePath);
					await runtime.provider.deleteFile(runtime.sandboxId, runtime.rootPath, relativePath);
					await recordDeletedChange(runtime, relativePath, before, context?.toolCallId);
					return { path: relativePath, deleted: true };
				},
			},
			{
				name: "run_command",
				description:
					"Run a real non-interactive shell command in the sandbox. Returns stdout/stderr combined, the actual exit code and duration. Use for installs, builds, tests and scripts.",
				inputSchema: {
					type: "object",
					properties: {
						command: { type: "string", description: "Shell command" },
						cwd: { type: "string", description: "Workspace-relative directory" },
						timeout_seconds: {
							type: "integer",
							minimum: 1,
							maximum: 300,
							description: "Kill the command after this many seconds",
						},
					},
					required: ["command"],
					additionalProperties: false,
				},
				async execute(input: { command: string; cwd?: string; timeout_seconds?: number }) {
					assertWritable(runtime);
					const safety = checkCommand(input.command);
					if (!safety.ok) throw new Error(safety.reason);
					const result = await runtime.provider.execute(
						runtime.sandboxId,
						runtime.rootPath,
						input.command,
						{
							cwd: input.cwd,
							timeoutSeconds: Math.min(input.timeout_seconds ?? 90, 300),
						},
					);
					return {
						exitCode: result.exitCode,
						output: capOutput(result.output),
						durationMs: result.durationMs,
						timedOut: result.timedOut ?? false,
					};
				},
			},
			{
				name: "start_server",
				description:
					"Start a long-running development server in the sandbox and return a real preview URL. Bind to 0.0.0.0. The command must not block interaction.",
				inputSchema: {
					type: "object",
					properties: {
						command: { type: "string", description: "Server command, e.g. 'npm run dev'" },
						port: { type: "integer", minimum: 1024, maximum: 65535 },
					},
					required: ["command", "port"],
					additionalProperties: false,
				},
				async execute(input: { command: string; port: number }) {
					assertWritable(runtime);
					const safety = checkCommand(input.command);
					if (!safety.ok) throw new Error(safety.reason);
					const port = Math.floor(input.port);
					const started = await runtime.provider.startStreamingCommand(
						runtime.sandboxId,
						runtime.rootPath,
						input.command,
						{ timeoutSeconds: 120 },
					);
					const probe = await runtime.provider.execute(
						runtime.sandboxId,
						runtime.rootPath,
						`for i in $(seq 1 20); do if curl -fsS -o /dev/null "http://127.0.0.1:${port}/" 2>/dev/null; then echo READY; exit 0; fi; sleep 1; done; echo NOT_READY; exit 1`,
						{ timeoutSeconds: 35 },
					);
					let previewUrl: string | null = null;
					try {
						const link = await runtime.provider.getPreviewLink(runtime.sandboxId, port);
						previewUrl = link.url;
					} catch {
						previewUrl = null;
					}
					if (previewUrl) {
						await getServiceClient()
							.from("a21_workspaces")
							.update({
								preview_url: previewUrl,
								preview_port: port,
								last_active_at: new Date().toISOString(),
							})
							.eq("id", runtime.workspaceId);
						await runtime.emit("preview.ready", `Preview available on port ${port}`, {
							previewUrl,
							port,
							sessionId: started.sessionId,
							commandId: started.commandId,
						});
					}
					return {
						started: probe.exitCode === 0,
						previewUrl,
						port,
						probe: probe.output.trim(),
						note:
							probe.exitCode === 0
								? "Server responded on the sandbox loopback interface."
								: "The server did not respond within 20 seconds. It may still be compiling; use the preview URL once ready.",
					};
				},
			},
		);
	}

	tools.push({
		name: "finish_task",
		description:
			"Finish the task with an honest summary. This is the only way to complete the run. Include real tests run and remaining issues.",
		inputSchema: {
			type: "object",
			properties: {
				summary: { type: "string", description: "What was actually accomplished" },
				tests_run: {
					type: "array",
					items: { type: "string" },
					description: "Commands executed and their real outcomes",
				},
				remaining_issues: {
					type: "array",
					items: { type: "string" },
					description: "Unfinished or failing items; empty if none",
				},
			},
			required: ["summary"],
			additionalProperties: false,
		},
		lifecycle: { completesRun: true },
		async execute(input: { summary: string; tests_run?: string[]; remaining_issues?: string[] }) {
			const summary = input.summary.trim();
			if (!summary) throw new Error("Summary must not be empty.");
			runtime.state.finished = true;
			runtime.state.summary = summary.slice(0, 8000);
			runtime.state.testsRun = (input.tests_run ?? []).map((t) => t.slice(0, 500)).slice(0, 40);
			runtime.state.remainingIssues = (input.remaining_issues ?? [])
				.map((t) => t.slice(0, 1000))
				.slice(0, 40);
			await getServiceClient()
				.from("a21_tasks")
				.update({
					summary: runtime.state.summary,
					remaining_issues: runtime.state.remainingIssues,
					metadata: {
						finish: {
							testsRun: runtime.state.testsRun,
							finishedAt: new Date().toISOString(),
						},
					},
				})
				.eq("id", runtime.taskId)
				.eq("owner_id", runtime.ownerId);
			await runtime.emit("task.summary", sanitizeLogMessage(summary).slice(0, 2000), {
				testsRun: runtime.state.testsRun,
				remainingIssues: runtime.state.remainingIssues,
			});
			return {
				ok: true,
				summary: "Task marked complete. The final summary is shown to the user.",
			};
		},
	});

	return tools;
}
