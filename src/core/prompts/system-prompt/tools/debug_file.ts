import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import type { ClineToolSpec } from "../spec"

const generic: ClineToolSpec = {
	variant: ModelFamily.GENERIC,
	id: ClineDefaultTool.DEBUG_FILE,
	name: "debug_file",
	description: `Start a debugging session for a specific file. This tool allows you to debug code by setting up a debug session with VS Code's debugger. You can specify debug configurations, environment variables, and program arguments. Use this when you need to debug code execution, examine variable values, or step through code logic. The debug session must be started before you can set breakpoints or evaluate expressions.`,
	contextRequirements: (context) => context.ide === "VSCode",
	parameters: [
		{
			name: "file_path",
			required: true,
			instruction:
				"The relative path to the file you want to debug. This should be a valid source code file that can be debugged (e.g., .js, .ts, .py, .java, etc.).",
			usage: "src/main.ts",
		},
		{
			name: "debug_config_name",
			required: false,
			instruction:
				"Optional name of a debug configuration from launch.json to use. If not provided, a default configuration will be used or created.",
			usage: "Launch Program",
		},
		{
			name: "environment_variables",
			required: false,
			instruction: "Optional JSON object containing environment variables to set for the debug session. Use JSON format.",
			usage: '{"NODE_ENV": "development", "DEBUG": "true"}',
		},
		{
			name: "program_arguments",
			required: false,
			instruction: "Optional JSON array of command-line arguments to pass to the program being debugged. Use JSON format.",
			usage: '["--verbose", "--config=debug.json"]',
		},
	],
}

const gpt: ClineToolSpec = {
	variant: ModelFamily.GPT,
	id: ClineDefaultTool.DEBUG_FILE,
	name: "debug_file",
	description:
		"Start debugging a specific file using VS Code's debugger. Allows setting debug configurations and environment variables.",
	parameters: [
		{
			name: "file_path",
			required: true,
			instruction: "Path to the file to debug",
			usage: "src/main.ts",
		},
		{
			name: "debug_config_name",
			required: false,
			instruction: "Optional debug configuration name from launch.json",
			usage: "Launch Program",
		},
		{
			name: "environment_variables",
			required: false,
			instruction: "JSON object of environment variables",
			usage: '{"NODE_ENV": "development"}',
		},
		{
			name: "program_arguments",
			required: false,
			instruction: "JSON array of program arguments",
			usage: '["--verbose"]',
		},
	],
}

const nextGen = { ...generic, variant: ModelFamily.NEXT_GEN }

export const debug_file_variants = [generic, nextGen]
