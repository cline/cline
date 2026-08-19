#!/usr/bin/env bun
/**
 * Cline Hook: PreToolUse (TypeScript)
 * Logs and filters tool calls with type safety.
 * Copy to ~/.cline/hooks/PreToolUse.ts and chmod +x
 */

interface ToolCall {
	id: string;
	name: string;
	input: Record<string, unknown>;
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
	cancel?: boolean;
	review?: boolean;
	context?: string;
	errorMessage?: string;
	overrideInput?: unknown;
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

	const toolName = event.tool_call.name;
	const parameters = event.preToolUse.parameters;

	// Log to stderr
	console.error(`🔧 Tool: ${toolName}`);
	if (Object.keys(parameters).length > 0) {
		const paramStr = Object.entries(parameters)
			.map(([k, v]) => `${k}=${v}`)
			.join(", ");
		console.error(`   Args: ${paramStr}`);
	}

	// Return empty control (allow execution)
	const control: HookControl = {};
	console.log(JSON.stringify(control));
}

main().catch((error) => {
	console.error("Hook error:", error);
	process.exit(1);
});
