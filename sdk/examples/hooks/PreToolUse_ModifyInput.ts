#!/usr/bin/env bun
/**
 * Cline Hook: PreToolUse (Modify Input)
 * Demonstrates how to modify tool inputs before execution.
 * Useful for: normalizing paths, adding default options, sanitizing inputs.
 * Copy to ~/.cline/hooks/PreToolUse.ts and chmod +x
 */

interface ToolInput {
	[key: string]: unknown;
}

interface ToolCall {
	id: string;
	name: string;
	input: ToolInput;
}

interface HookEvent {
	hookName: string;
	tool_call: ToolCall;
	preToolUse: {
		toolName: string;
		parameters: Record<string, unknown>;
	};
}

interface HookControl {
	context?: string;
	overrideInput?: Record<string, unknown>;
}

function normalizeFilePath(path: string): string {
	// Convert backslashes to forward slashes (Windows paths)
	let normalized = path.replace(/\\/g, "/");

	// Resolve ~/ to home directory
	const home = process.env.HOME || process.env.USERPROFILE;
	if (normalized.startsWith("~/") && home) {
		normalized = normalized.replace(/^~/, home);
	}

	return normalized;
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

	const toolCall = event.tool_call;
	const toolName = toolCall.name;
	const toolInput = toolCall.input as Record<string, unknown>;

	// Modify read_files input: normalize paths
	if (toolName === "read_files" && typeof toolInput.filePath === "string") {
		const normalized = normalizeFilePath(toolInput.filePath);
		if (normalized !== toolInput.filePath) {
			const control: HookControl = {
				context: `Normalized file path from "${toolInput.filePath}" to "${normalized}"`,
				overrideInput: {
					...toolInput,
					filePath: normalized,
				},
			};
			console.log(JSON.stringify(control));
			return;
		}
	}

	// Modify editor input: add safety defaults
	if (toolName === "editor" && typeof toolInput.filePath === "string") {
		// For critical files, add a reminder
		const filePath = toolInput.filePath as string;
		if (
			filePath.includes("package.json") ||
			filePath.includes(".env") ||
			filePath.includes("tsconfig")
		) {
			const control: HookControl = {
				context:
					"WARNING: You are about to modify a critical configuration file. Verify changes carefully.",
			};
			console.log(JSON.stringify(control));
			return;
		}
	}

	// Modify run_commands input: add safety flags
	if (toolName === "run_commands" && typeof toolInput.command === "string") {
		const cmd = toolInput.command as string;

		// Add safety flags to npm/yarn installs
		if (cmd.includes("npm install") && !cmd.includes("--save")) {
			const newCmd = cmd.replace("npm install", "npm install --save-exact");
			const control: HookControl = {
				context: "Added --save-exact flag for reproducible installs",
				overrideInput: {
					...toolInput,
					command: newCmd,
				},
			};
			console.log(JSON.stringify(control));
			return;
		}
	}

	// No modifications needed
	console.log(JSON.stringify({}));
}

main().catch((error) => {
	console.error("Hook error:", error);
	process.exit(1);
});
