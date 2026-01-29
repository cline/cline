import { execSync } from "child_process"
import * as fs from "fs"
import * as path from "path"
import type { Controller } from "../../core/controller"
import { cacheExecution, executeAndVerify, generateRequestId, getCachedExecution } from "./execution-engine"
import { EnforcementRequest, EnforcementResponse, ExecuteTaskResponse } from "./types"
import { runSubstepVerification, runVerification } from "./verification-engine"

let controller: Controller | null = null

export function setController(ctrl: Controller) {
	controller = ctrl
	console.log("[DELEGATES] Controller set successfully")
}

export function getController(): Controller | null {
	return controller
}

export function getWorkspaceDirectory(): string {
	if (!controller || !controller.task) {
		return process.cwd()
	}
	// Access the private cwd property using bracket notation
	return (controller.task as any).cwd || process.cwd()
}

export async function verifyStep(request: EnforcementRequest): Promise<EnforcementResponse> {
	console.log("[DELEGATE] verifyStep called for step:", request.step_id)
	return runVerification(request)
}

export async function verifySubstep(request: EnforcementRequest): Promise<EnforcementResponse> {
	console.log("[DELEGATE] verifySubstep called for substep:", request.substep_id)

	// Find the specific substep
	const substep = request.node?.substeps?.find((s) => s.id === request.substep_id)
	if (!substep) {
		console.error("[DELEGATE] Substep not found:", request.substep_id)
		return {
			verdict: "unclear",
			overview: `## Substep Not Found\n- Requested: ${request.substep_id}\n- Available: ${request.node?.substeps?.map((s) => s.id).join(", ") || "none"}`,
			rules_analysis: [],
			files_summary: [],
			code_blocks: [],
		}
	}

	console.log("[DELEGATE] Verifying substep:", substep.id, "-", substep.text)

	try {
		// Verify this substep - now returns same rich EnforcementResponse as steps
		const verification = await runSubstepVerification(
			request.chat_id,
			request.node?.description || "",
			substep.text,
			substep.id,
			request.node?.rules || [],
		)

		console.log("[DELEGATE] Substep verification complete:", substep.id)

		// Return the rich verification response directly
		return verification
	} catch (error) {
		console.error("[DELEGATE] Substep verification error:", error)
		return {
			verdict: "unclear",
			overview: `## Verification Failed\n- Error: ${error instanceof Error ? error.message : "Unknown error"}`,
			rules_analysis: [],
			files_summary: [],
			code_blocks: [],
		}
	}
}

export async function verifyRule(request: EnforcementRequest): Promise<EnforcementResponse> {
	console.log("[DELEGATE] verifyRule called for rule:", request.rule_id)
	return runVerification(request)
}

export async function executeTask(task: string, context?: Record<string, any>): Promise<ExecuteTaskResponse> {
	console.log("[DELEGATE] executeTask called:", { task, context })

	const requestId = generateRequestId({ task, context })

	const cached = getCachedExecution(requestId)
	if (cached) {
		console.log("[DELEGATE] Returning cached execution result")
		return cached
	}

	const taskId = `task-${Date.now()}`
	const result: ExecuteTaskResponse = {
		task_id: taskId,
		status: "submitted",
	}

	cacheExecution(requestId, result)

	// Build EnforcementRequest for new signature
	const request: EnforcementRequest = {
		chat_id: context?.chatId || "unknown",
		step_id: context?.nodeId,
		substep_id: context?.targetId,
		node: context?.node,
	}

	executeAndVerify(request)
		.then((verificationResult) => {
			console.log("[DELEGATE] Task executed and verified:", verificationResult.verdict)
		})
		.catch((error) => {
			console.error("[DELEGATE] Task execution error:", error)
		})

	return result
}

// ============================================================================
// SHARED TOOL DEFINITIONS & EXECUTION
// ============================================================================

interface ToolDefinition {
	name: string
	description: string
	input_schema: {
		type: string
		properties: Record<string, any>
		required?: string[]
	}
}

export const TOOL_DEFINITIONS: ToolDefinition[] = [
	{
		name: "read_file",
		description: "Read the complete contents of a file in the workspace",
		input_schema: {
			type: "object",
			properties: {
				path: { type: "string", description: "Relative path from workspace root" },
			},
			required: ["path"],
		},
	},
	{
		name: "search_files",
		description: "Search for a pattern across all files in the workspace using grep",
		input_schema: {
			type: "object",
			properties: {
				pattern: { type: "string", description: "Pattern to search for" },
				file_pattern: { type: "string", description: 'Optional file glob pattern (e.g., "*.ts")' },
			},
			required: ["pattern"],
		},
	},
	{
		name: "execute_command",
		description: "Execute a shell command (git log, git blame, git show, grep, find, etc.)",
		input_schema: {
			type: "object",
			properties: {
				command: { type: "string", description: "Shell command to execute" },
			},
			required: ["command"],
		},
	},
	{
		name: "write_to_file",
		description: "Write content to a file in the workspace (creates directories as needed)",
		input_schema: {
			type: "object",
			properties: {
				path: { type: "string", description: "Relative path from workspace root" },
				content: { type: "string", description: "Content to write to the file" },
			},
			required: ["path", "content"],
		},
	},
	{
		name: "replace_in_file",
		description: "Replace content in a file using search and replace",
		input_schema: {
			type: "object",
			properties: {
				path: { type: "string", description: "Relative path from workspace root" },
				search: { type: "string", description: "Content to search for" },
				replace: { type: "string", description: "Content to replace with" },
			},
			required: ["path", "search", "replace"],
		},
	},
]

export async function executeTool(toolName: string, toolInput: any): Promise<string> {
	const cwd = getWorkspaceDirectory()

	try {
		switch (toolName) {
			case "read_file": {
				const filePath = path.join(cwd, toolInput.path)
				if (!fs.existsSync(filePath)) {
					return `Error: File not found: ${toolInput.path}`
				}
				const content = fs.readFileSync(filePath, "utf-8")
				return `File: ${toolInput.path}\n\n${content}`
			}

			case "search_files": {
				const pattern = toolInput.pattern
				const filePattern = toolInput.file_pattern || "*"
				const cmd = `find . -maxdepth 5 -type f -name "${filePattern}" -exec grep -l "${pattern}" {} \\; 2>/dev/null | head -20 || true`
				const output = execSync(cmd, {
					cwd,
					encoding: "utf-8",
					maxBuffer: 5 * 1024 * 1024,
					timeout: 10000,
				})
				return output || `No matches found for pattern: ${pattern}`
			}

			case "execute_command": {
				const output = execSync(toolInput.command, {
					cwd,
					encoding: "utf-8",
					maxBuffer: 5 * 1024 * 1024,
					timeout: 10000,
				})
				return output || "(No output)"
			}

			case "write_to_file": {
				console.log("[executeTool] write_to_file called with path:", toolInput.path)
				const filePath = path.join(cwd, toolInput.path)
				console.log("[executeTool] Absolute file path:", filePath)
				console.log("[executeTool] Working directory (cwd):", cwd)
				const dir = path.dirname(filePath)

				// Create directory if it doesn't exist
				if (!fs.existsSync(dir)) {
					fs.mkdirSync(dir, { recursive: true })
				}

				fs.writeFileSync(filePath, toolInput.content, "utf-8")
				console.log("[executeTool] Successfully wrote file to:", filePath)
				return `Successfully wrote to ${toolInput.path}`
			}

			case "replace_in_file": {
				const filePath = path.join(cwd, toolInput.path)
				if (!fs.existsSync(filePath)) {
					return `Error: File not found: ${toolInput.path}`
				}

				let content = fs.readFileSync(filePath, "utf-8")
				const originalContent = content

				// Perform replacement
				content = content.replace(toolInput.search, toolInput.replace)

				if (content === originalContent) {
					return `Warning: No matches found for search pattern in ${toolInput.path}`
				}

				fs.writeFileSync(filePath, content, "utf-8")
				return `Successfully replaced content in ${toolInput.path}`
			}

			default:
				return `Error: Unknown tool: ${toolName}`
		}
	} catch (error) {
		return `Error executing ${toolName}: ${error instanceof Error ? error.message : "Unknown error"}`
	}
}
