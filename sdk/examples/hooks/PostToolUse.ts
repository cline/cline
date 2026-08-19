#!/usr/bin/env bun
/**
 * Cline Hook: PostToolUse (TypeScript)
 * Logs tool results with structured output.
 * Copy to ~/.cline/hooks/PostToolUse.ts and chmod +x
 */

interface ToolResult {
	id: string;
	name: string;
	input: Record<string, unknown>;
	output: unknown;
	error: unknown;
	durationMs: number;
}

interface HookEvent {
	hookName: string;
	tool_result: ToolResult;
	postToolUse: {
		toolName: string;
		parameters: Record<string, unknown>;
		result: string;
		success: boolean;
		executionTimeMs: number;
	};
}

interface HookControl {
	context?: string;
	errorMessage?: string;
}

async function getGitBranch(): Promise<string | null> {
	try {
		const proc = Bun.spawn(["git", "branch", "--show-current"]);
		const output = await new Response(proc.stdout).text();
		return output.trim() || null;
	} catch {
		return null;
	}
}

async function main(): Promise<void> {
	let event: HookEvent;

	try {
		const input = await Bun.stdin.text();
		event = JSON.parse(input) as HookEvent;
	} catch (error) {
		const message =
			error instanceof Error ? error.message : "Unknown parse error";
		console.log(
			JSON.stringify({ errorMessage: `Failed to parse: ${message}` }),
		);
		return;
	}

	const toolName = event.tool_result.name;
	const success = event.postToolUse.success;
	const durationMs = event.postToolUse.executionTimeMs;

	// Log result
	const status = success ? "✅" : "❌";
	console.error(`${status} Tool: ${toolName} (${durationMs}ms)`);

	// For run_commands, inject environment context
	if (toolName === "run_commands") {
		const branch = await getGitBranch();
		if (branch) {
			const control: HookControl = {
				context: `Environment: git branch: ${branch}`,
			};
			console.log(JSON.stringify(control));
			return;
		}
	}

	// Return empty control
	console.log(JSON.stringify({}));
}

main().catch((error) => {
	console.error("Hook error:", error);
	process.exit(1);
});
