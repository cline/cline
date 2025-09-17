import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import type { ClineToolSpec } from "../spec"

const generic: ClineToolSpec = {
	variant: ModelFamily.GENERIC,
	id: ClineDefaultTool.SET_BREAKPOINT,
	name: "set_breakpoint",
	description: `Set a breakpoint at a specific line in a file during a debug session. Breakpoints pause program execution at the specified line, allowing you to examine the program state, variable values, and step through code execution. You can set conditional breakpoints that only trigger when a condition is met, or logpoints that log messages without pausing execution. A debug session must be active before setting breakpoints.`,
	contextRequirements: (context) => context.ide === "VSCode",
	parameters: [
		{
			name: "file_path",
			required: true,
			instruction: "The relative path to the file where you want to set the breakpoint.",
			usage: "src/utils/helper.ts",
		},
		{
			name: "line_number",
			required: true,
			instruction: "The line number (1-based) where you want to set the breakpoint. Must be a positive integer.",
			usage: "42",
		},
		{
			name: "condition",
			required: false,
			instruction:
				"Optional condition for a conditional breakpoint. The breakpoint will only trigger when this expression evaluates to true. Use the syntax of the language being debugged.",
			usage: "x > 10 && y !== null",
		},
		{
			name: "log_message",
			required: false,
			instruction:
				"Optional log message for a logpoint. Instead of pausing execution, this will log the specified message. You can include variable values using curly braces {variable_name}.",
			usage: "Value of x is {x}, iteration: {i}",
		},
	],
}

const gpt: ClineToolSpec = {
	variant: ModelFamily.GPT,
	id: ClineDefaultTool.SET_BREAKPOINT,
	name: "set_breakpoint",
	description: "Set a breakpoint at a specific line in a file. Can be conditional or a logpoint.",
	parameters: [
		{
			name: "file_path",
			required: true,
			instruction: "Path to the file for the breakpoint",
			usage: "src/utils/helper.ts",
		},
		{
			name: "line_number",
			required: true,
			instruction: "Line number (1-based) for the breakpoint",
			usage: "42",
		},
		{
			name: "condition",
			required: false,
			instruction: "Optional condition for conditional breakpoint",
			usage: "x > 10",
		},
		{
			name: "log_message",
			required: false,
			instruction: "Optional message for logpoint",
			usage: "Value: {x}",
		},
	],
}

const nextGen = { ...generic, variant: ModelFamily.NEXT_GEN }

export const set_breakpoint_variants = [generic, nextGen]
