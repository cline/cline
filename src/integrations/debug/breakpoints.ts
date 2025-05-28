import * as path from "node:path"
import * as vscode from "vscode"
import { z } from "zod"

/**
 * Set a breakpoint at a specific line in a file.
 *
 * @param params - Object containing filePath and line number for the breakpoint.
 */
export const setBreakpoint = async (params: { filePath: string; line: number }) => {
	const { filePath, line } = params

	try {
		// Create a URI from the file path
		const fileUri = vscode.Uri.file(filePath)

		// Check if the file exists
		try {
			await vscode.workspace.fs.stat(fileUri)
		} catch (error) {
			return {
				content: [
					{
						type: "text",
						text: `File not found: ${filePath}`,
					},
				],
				isError: true,
			}
		}

		// Create a new breakpoint
		const breakpoint = new vscode.SourceBreakpoint(new vscode.Location(fileUri, new vscode.Position(line - 1, 0)))

		// Add the breakpoint - note that addBreakpoints returns void, not an array
		vscode.debug.addBreakpoints([breakpoint])

		// Check if the breakpoint was successfully added by verifying it exists in VS Code's breakpoints
		const breakpoints = vscode.debug.breakpoints
		const breakpointAdded = breakpoints.some((bp) => {
			if (bp instanceof vscode.SourceBreakpoint) {
				const loc = bp.location
				return loc.uri.fsPath === fileUri.fsPath && loc.range.start.line === line - 1
			}
			return false
		})

		if (!breakpointAdded) {
			return {
				content: [
					{
						type: "text",
						text: `Failed to set breakpoint at line ${line} in ${path.basename(filePath)}`,
					},
				],
				isError: true,
			}
		}

		return {
			content: [
				{
					type: "text",
					text: `Breakpoint set at line ${line} in ${path.basename(filePath)}`,
				},
			],
			isError: false,
		}
	} catch (error) {
		return {
			content: [
				{
					type: "text",
					text: `Error setting breakpoint: ${error instanceof Error ? error.message : String(error)}`,
				},
			],
			isError: true,
		}
	}
}

// Zod schema for validating set_breakpoint parameters.
export const setBreakpointSchema = z.object({
	filePath: z.string().describe("The absolute path to the file where the breakpoint should be set."),
	line: z.number().int().min(1).describe("The line number where the breakpoint should be set (1-based)."),
})

/**
 * Get a list of all currently set breakpoints in the workspace.
 *
 * @param params - Optional object containing a file path filter.
 */
export const listBreakpoints = (params: { filePath?: string } = {}) => {
	const { filePath } = params

	// Get all breakpoints
	const allBreakpoints = vscode.debug.breakpoints

	// Filter breakpoints by file path if provided
	const filteredBreakpoints = filePath
		? allBreakpoints.filter((bp) => {
				if (bp instanceof vscode.SourceBreakpoint) {
					return bp.location.uri.fsPath === filePath
				}
				return false
			})
		: allBreakpoints

	// Transform breakpoints into a more readable format
	const breakpointData = filteredBreakpoints.map((bp) => {
		if (bp instanceof vscode.SourceBreakpoint) {
			const location = bp.location
			return {
				id: bp.id,
				enabled: bp.enabled,
				condition: bp.condition,
				hitCondition: bp.hitCondition,
				logMessage: bp.logMessage,
				file: {
					path: location.uri.fsPath,
					name: path.basename(location.uri.fsPath),
				},
				location: {
					line: location.range.start.line + 1, // Convert to 1-based for user display
					column: location.range.start.character + 1,
				},
			}
		} else if (bp instanceof vscode.FunctionBreakpoint) {
			return {
				id: bp.id,
				enabled: bp.enabled,
				functionName: bp.functionName,
				condition: bp.condition,
				hitCondition: bp.hitCondition,
				logMessage: bp.logMessage,
			}
		} else {
			return {
				id: bp.id,
				enabled: bp.enabled,
				type: "unknown",
			}
		}
	})

	return {
		content: [
			{
				type: "json",
				json: {
					breakpoints: breakpointData,
					count: breakpointData.length,
					filter: filePath ? { filePath } : undefined,
				},
			},
		],
		isError: false,
	}
}

// Zod schema for validating list_breakpoints parameters.
export const listBreakpointsSchema = z.object({
	filePath: z.string().optional().describe("Optional file path to filter breakpoints by file."),
})
