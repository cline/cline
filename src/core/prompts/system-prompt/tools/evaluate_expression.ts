import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import type { ClineToolSpec } from "../spec"

const generic: ClineToolSpec = {
	variant: ModelFamily.GENERIC,
	id: ClineDefaultTool.EVALUATE_EXPRESSION,
	name: "evaluate_expression",
	description: `Evaluate an expression in the current debug context while debugging is paused. This tool can only be used when the debugger is actively paused at a breakpoint or in a stopped state. It allows you to examine variable values, execute code snippets, and inspect the program state. The expression will be evaluated in the context of the current debug frame, giving you access to local variables, parameters, and the current scope. 

IMPORTANT: This tool requires the debug session to be paused (stopped at a breakpoint). If debugging has just started but hasn't hit a breakpoint yet, expressions cannot be evaluated. Ensure the program execution has stopped at a breakpoint before using this tool.`,
	contextRequirements: (context) => context.ide === "VSCode",
	parameters: [
		{
			name: "expression",
			required: true,
			instruction:
				"The expression to evaluate in the debug context. This should be valid code in the language being debugged. You can access local variables, call functions, or perform calculations. Note: The debugger must be paused at a breakpoint for this to work.",
			usage: "user.name + ' - ' + user.email",
		},
		{
			name: "frame_id",
			required: false,
			instruction:
				"Optional frame ID to specify which stack frame to evaluate the expression in. If not provided, the expression will be evaluated in the current (top) frame.",
			usage: "1",
		},
		{
			name: "context",
			required: false,
			instruction:
				"Optional context for the evaluation. Common values: 'watch' (for watch expressions), 'repl' (for debug console), 'hover' (for hover evaluations). Default is 'repl'.",
			usage: "repl",
		},
	],
}

const gpt: ClineToolSpec = {
	variant: ModelFamily.GPT,
	id: ClineDefaultTool.EVALUATE_EXPRESSION,
	name: "evaluate_expression",
	description:
		"Evaluate an expression in the current debug context to examine variables and program state. Requires debugger to be paused at a breakpoint.",
	parameters: [
		{
			name: "expression",
			required: true,
			instruction: "Expression to evaluate in debug context (requires paused debugger)",
			usage: "user.name",
		},
		{
			name: "frame_id",
			required: false,
			instruction: "Optional frame ID for evaluation context",
			usage: "1",
		},
		{
			name: "context",
			required: false,
			instruction: "Evaluation context (watch, repl, hover)",
			usage: "repl",
		},
	],
}

const nextGen = { ...generic, variant: ModelFamily.NEXT_GEN }

export const evaluate_expression_variants = [generic, nextGen]
