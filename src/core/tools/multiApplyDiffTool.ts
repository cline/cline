import path from "path"
import fs from "fs/promises"

import { TelemetryService } from "@roo-code/telemetry"

import { ClineSayTool } from "../../shared/ExtensionMessage"
import { getReadablePath } from "../../utils/path"
import { Task } from "../task/Task"
import { ToolUse, RemoveClosingTag, AskApproval, HandleError, PushToolResult } from "../../shared/tools"
import { formatResponse } from "../prompts/responses"
import { fileExistsAtPath } from "../../utils/fs"
import { RecordSource } from "../context-tracking/FileContextTrackerTypes"
import { unescapeHtmlEntities } from "../../utils/text-normalization"
import { parseXml } from "../../utils/xml"
import { EXPERIMENT_IDS, experiments } from "../../shared/experiments"
import { applyDiffToolLegacy } from "./applyDiffTool"

interface DiffOperation {
	path: string
	diff: Array<{
		content: string
		startLine?: number
	}>
}

// Track operation status
interface OperationResult {
	path: string
	status: "pending" | "approved" | "denied" | "blocked" | "error"
	error?: string
	result?: string
	diffItems?: Array<{ content: string; startLine?: number }>
	absolutePath?: string
	fileExists?: boolean
}

// Add proper type definitions
interface ParsedFile {
	path: string
	diff: ParsedDiff | ParsedDiff[]
}

interface ParsedDiff {
	content: string
	start_line?: string
}

interface ParsedXmlResult {
	file: ParsedFile | ParsedFile[]
}

export async function applyDiffTool(
	cline: Task,
	block: ToolUse,
	askApproval: AskApproval,
	handleError: HandleError,
	pushToolResult: PushToolResult,
	removeClosingTag: RemoveClosingTag,
) {
	// Check if MULTI_FILE_APPLY_DIFF experiment is enabled
	const provider = cline.providerRef.deref()
	if (provider) {
		const state = await provider.getState()
		const isMultiFileApplyDiffEnabled = experiments.isEnabled(
			state.experiments ?? {},
			EXPERIMENT_IDS.MULTI_FILE_APPLY_DIFF,
		)

		// If experiment is disabled, use legacy tool
		if (!isMultiFileApplyDiffEnabled) {
			return applyDiffToolLegacy(cline, block, askApproval, handleError, pushToolResult, removeClosingTag)
		}
	}

	// Otherwise, continue with new multi-file implementation
	const argsXmlTag: string | undefined = block.params.args
	const legacyPath: string | undefined = block.params.path
	const legacyDiffContent: string | undefined = block.params.diff
	const legacyStartLineStr: string | undefined = block.params.start_line

	let operationsMap: Record<string, DiffOperation> = {}
	let usingLegacyParams = false
	let filteredOperationErrors: string[] = []

	// Handle partial message first
	if (block.partial) {
		let filePath = ""
		if (argsXmlTag) {
			const match = argsXmlTag.match(/<file>.*?<path>([^<]+)<\/path>/s)
			if (match) {
				filePath = match[1]
			}
		} else if (legacyPath) {
			// Use legacy path if argsXmlTag is not present for partial messages
			filePath = legacyPath
		}

		const sharedMessageProps: ClineSayTool = {
			tool: "appliedDiff",
			path: getReadablePath(cline.cwd, filePath),
		}
		const partialMessage = JSON.stringify(sharedMessageProps)
		await cline.ask("tool", partialMessage, block.partial).catch(() => {})
		return
	}

	if (argsXmlTag) {
		// Parse file entries from XML (new way)
		try {
			const parsed = parseXml(argsXmlTag, ["file.diff.content"]) as ParsedXmlResult
			const files = Array.isArray(parsed.file) ? parsed.file : [parsed.file].filter(Boolean)

			for (const file of files) {
				if (!file.path || !file.diff) continue

				const filePath = file.path

				// Initialize the operation in the map if it doesn't exist
				if (!operationsMap[filePath]) {
					operationsMap[filePath] = {
						path: filePath,
						diff: [],
					}
				}

				// Handle diff as either array or single element
				const diffs = Array.isArray(file.diff) ? file.diff : [file.diff]

				for (let i = 0; i < diffs.length; i++) {
					const diff = diffs[i]
					let diffContent: string
					let startLine: number | undefined

					diffContent = diff.content
					startLine = diff.start_line ? parseInt(diff.start_line) : undefined

					operationsMap[filePath].diff.push({
						content: diffContent,
						startLine,
					})
				}
			}
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			const detailedError = `Failed to parse apply_diff XML. This usually means:
1. The XML structure is malformed or incomplete
2. Missing required <file>, <path>, or <diff> tags
3. Invalid characters or encoding in the XML

Expected structure:
<args>
  <file>
    <path>relative/path/to/file.ext</path>
    <diff>
      <content>diff content here</content>
      <start_line>line number</start_line>
    </diff>
  </file>
</args>

Original error: ${errorMessage}`
			throw new Error(detailedError)
		}
	} else if (legacyPath && typeof legacyDiffContent === "string") {
		// Handle legacy parameters (old way)
		usingLegacyParams = true
		operationsMap[legacyPath] = {
			path: legacyPath,
			diff: [
				{
					content: legacyDiffContent, // Unescaping will be handled later like new diffs
					startLine: legacyStartLineStr ? parseInt(legacyStartLineStr) : undefined,
				},
			],
		}
	} else {
		// Neither new XML args nor old path/diff params are sufficient
		cline.consecutiveMistakeCount++
		cline.recordToolError("apply_diff")
		const errorMsg = await cline.sayAndCreateMissingParamError(
			"apply_diff",
			"args (or legacy 'path' and 'diff' parameters)",
		)
		pushToolResult(errorMsg)
		return
	}

	// If no operations were extracted, bail out
	if (Object.keys(operationsMap).length === 0) {
		cline.consecutiveMistakeCount++
		cline.recordToolError("apply_diff")
		pushToolResult(
			await cline.sayAndCreateMissingParamError(
				"apply_diff",
				usingLegacyParams
					? "legacy 'path' and 'diff' (must be valid and non-empty)"
					: "args (must contain at least one valid file element)",
			),
		)
		return
	}

	// Convert map to array of operations for processing
	const operations = Object.values(operationsMap)

	const operationResults: OperationResult[] = operations.map((op) => ({
		path: op.path,
		status: "pending",
		diffItems: op.diff,
	}))

	// Function to update operation result
	const updateOperationResult = (path: string, updates: Partial<OperationResult>) => {
		const index = operationResults.findIndex((result) => result.path === path)
		if (index !== -1) {
			operationResults[index] = { ...operationResults[index], ...updates }
		}
	}

	try {
		// First validate all files and prepare for batch approval
		const operationsToApprove: OperationResult[] = []
		const allDiffErrors: string[] = [] // Collect all diff errors

		for (const operation of operations) {
			const { path: relPath, diff: diffItems } = operation

			// Verify file access is allowed
			const accessAllowed = cline.rooIgnoreController?.validateAccess(relPath)
			if (!accessAllowed) {
				await cline.say("rooignore_error", relPath)
				updateOperationResult(relPath, {
					status: "blocked",
					error: formatResponse.rooIgnoreError(relPath),
				})
				continue
			}

			// Check if file is write-protected
			const isWriteProtected = cline.rooProtectedController?.isWriteProtected(relPath) || false

			// Verify file exists
			const absolutePath = path.resolve(cline.cwd, relPath)
			const fileExists = await fileExistsAtPath(absolutePath)
			if (!fileExists) {
				updateOperationResult(relPath, {
					status: "blocked",
					error: `File does not exist at path: ${absolutePath}`,
				})
				continue
			}

			// Add to operations that need approval
			const opResult = operationResults.find((r) => r.path === relPath)
			if (opResult) {
				opResult.absolutePath = absolutePath
				opResult.fileExists = fileExists
				operationsToApprove.push(opResult)
			}
		}

		// Handle batch approval if there are multiple files
		if (operationsToApprove.length > 1) {
			// Check if any files are write-protected
			const hasProtectedFiles = operationsToApprove.some(
				(opResult) => cline.rooProtectedController?.isWriteProtected(opResult.path) || false,
			)

			// Prepare batch diff data
			const batchDiffs = operationsToApprove.map((opResult) => {
				const readablePath = getReadablePath(cline.cwd, opResult.path)
				const changeCount = opResult.diffItems?.length || 0
				const changeText = changeCount === 1 ? "1 change" : `${changeCount} changes`

				return {
					path: readablePath,
					changeCount,
					key: `${readablePath} (${changeText})`,
					content: opResult.path, // Full relative path
					diffs: opResult.diffItems?.map((item) => ({
						content: item.content,
						startLine: item.startLine,
					})),
				}
			})

			const completeMessage = JSON.stringify({
				tool: "appliedDiff",
				batchDiffs,
				isProtected: hasProtectedFiles,
			} satisfies ClineSayTool)

			const { response, text, images } = await cline.ask("tool", completeMessage, hasProtectedFiles)

			// Process batch response
			if (response === "yesButtonClicked") {
				// Approve all files
				if (text) {
					await cline.say("user_feedback", text, images)
				}
				operationsToApprove.forEach((opResult) => {
					updateOperationResult(opResult.path, { status: "approved" })
				})
			} else if (response === "noButtonClicked") {
				// Deny all files
				if (text) {
					await cline.say("user_feedback", text, images)
				}
				cline.didRejectTool = true
				operationsToApprove.forEach((opResult) => {
					updateOperationResult(opResult.path, {
						status: "denied",
						result: `Changes to ${opResult.path} were not approved by user`,
					})
				})
			} else {
				// Handle individual permissions from objectResponse
				try {
					const parsedResponse = JSON.parse(text || "{}")
					// Check if this is our batch diff approval response
					if (parsedResponse.action === "applyDiff" && parsedResponse.approvedFiles) {
						const approvedFiles = parsedResponse.approvedFiles
						let hasAnyDenial = false

						operationsToApprove.forEach((opResult) => {
							const approved = approvedFiles[opResult.path] === true

							if (approved) {
								updateOperationResult(opResult.path, { status: "approved" })
							} else {
								hasAnyDenial = true
								updateOperationResult(opResult.path, {
									status: "denied",
									result: `Changes to ${opResult.path} were not approved by user`,
								})
							}
						})

						if (hasAnyDenial) {
							cline.didRejectTool = true
						}
					} else {
						// Legacy individual permissions format
						const individualPermissions = parsedResponse
						let hasAnyDenial = false

						batchDiffs.forEach((batchDiff, index) => {
							const opResult = operationsToApprove[index]
							const approved = individualPermissions[batchDiff.key] === true

							if (approved) {
								updateOperationResult(opResult.path, { status: "approved" })
							} else {
								hasAnyDenial = true
								updateOperationResult(opResult.path, {
									status: "denied",
									result: `Changes to ${opResult.path} were not approved by user`,
								})
							}
						})

						if (hasAnyDenial) {
							cline.didRejectTool = true
						}
					}
				} catch (error) {
					// Fallback: if JSON parsing fails, deny all files
					console.error("Failed to parse individual permissions:", error)
					cline.didRejectTool = true
					operationsToApprove.forEach((opResult) => {
						updateOperationResult(opResult.path, {
							status: "denied",
							result: `Changes to ${opResult.path} were not approved by user`,
						})
					})
				}
			}
		} else if (operationsToApprove.length === 1) {
			// Single file approval - process immediately
			const opResult = operationsToApprove[0]
			updateOperationResult(opResult.path, { status: "approved" })
		}

		// Process approved operations
		const results: string[] = []

		for (const opResult of operationResults) {
			// Skip operations that weren't approved or were blocked
			if (opResult.status !== "approved") {
				if (opResult.result) {
					results.push(opResult.result)
				} else if (opResult.error) {
					results.push(opResult.error)
				}
				continue
			}

			const relPath = opResult.path
			const diffItems = opResult.diffItems || []
			const absolutePath = opResult.absolutePath!
			const fileExists = opResult.fileExists!

			try {
				let originalContent: string | null = await fs.readFile(absolutePath, "utf-8")
				let successCount = 0
				let formattedError = ""

				// Pre-process all diff items for HTML entity unescaping if needed
				const processedDiffItems = !cline.api.getModel().id.includes("claude")
					? diffItems.map((item) => ({
							...item,
							content: item.content ? unescapeHtmlEntities(item.content) : item.content,
						}))
					: diffItems

				// Apply all diffs at once with the array-based method
				const diffResult = (await cline.diffStrategy?.applyDiff(originalContent, processedDiffItems)) ?? {
					success: false,
					error: "No diff strategy available - please ensure a valid diff strategy is configured",
				}

				// Release the original content from memory as it's no longer needed
				originalContent = null

				if (!diffResult.success) {
					cline.consecutiveMistakeCount++
					const currentCount = (cline.consecutiveMistakeCountForApplyDiff.get(relPath) || 0) + 1
					cline.consecutiveMistakeCountForApplyDiff.set(relPath, currentCount)

					TelemetryService.instance.captureDiffApplicationError(cline.taskId, currentCount)

					if (diffResult.failParts && diffResult.failParts.length > 0) {
						for (let i = 0; i < diffResult.failParts.length; i++) {
							const failPart = diffResult.failParts[i]
							if (failPart.success) {
								continue
							}

							// Collect error for later reporting
							allDiffErrors.push(`${relPath} - Diff ${i + 1}: ${failPart.error}`)

							const errorDetails = failPart.details ? JSON.stringify(failPart.details, null, 2) : ""
							formattedError += `<error_details>
Diff ${i + 1} failed for file: ${relPath}
Error: ${failPart.error}

Suggested fixes:
1. Verify the search content exactly matches the file content (including whitespace)
2. Check for correct indentation and line endings
3. Use <read_file> to see the current file content
4. Consider breaking complex changes into smaller diffs
5. Ensure start_line parameter matches the actual content location
${errorDetails ? `\nDetailed error information:\n${errorDetails}\n` : ""}
</error_details>\n\n`
						}
					} else {
						const errorDetails = diffResult.details ? JSON.stringify(diffResult.details, null, 2) : ""
						formattedError += `<error_details>
Unable to apply diffs to file: ${absolutePath}
Error: ${diffResult.error}

Recovery suggestions:
1. Use <read_file> to examine the current file content
2. Verify the diff format matches the expected search/replace pattern
3. Check that the search content exactly matches what's in the file
4. Consider using line numbers with start_line parameter
5. Break large changes into smaller, more specific diffs
${errorDetails ? `\nTechnical details:\n${errorDetails}\n` : ""}
</error_details>\n\n`
					}
				} else {
					// Get the content from the result and update success count
					originalContent = diffResult.content || originalContent
					successCount = diffItems.length - (diffResult.failParts?.length || 0)
				}

				// If no diffs were successfully applied, continue to next file
				if (successCount === 0) {
					if (formattedError) {
						const currentCount = cline.consecutiveMistakeCountForApplyDiff.get(relPath) || 0
						if (currentCount >= 2) {
							await cline.say("diff_error", formattedError)
						}
						cline.recordToolError("apply_diff", formattedError)
						results.push(formattedError)

						// For single file operations, we need to send a complete message to stop the spinner
						if (operationsToApprove.length === 1) {
							const sharedMessageProps: ClineSayTool = {
								tool: "appliedDiff",
								path: getReadablePath(cline.cwd, relPath),
								diff: diffItems.map((item) => item.content).join("\n\n"),
							}
							// Send a complete message (partial: false) to update the UI and stop the spinner
							await cline.ask("tool", JSON.stringify(sharedMessageProps), false).catch(() => {})
						}
					}
					continue
				}

				cline.consecutiveMistakeCount = 0
				cline.consecutiveMistakeCountForApplyDiff.delete(relPath)

				// Show diff view before asking for approval (only for single file or after batch approval)
				cline.diffViewProvider.editType = "modify"
				await cline.diffViewProvider.open(relPath)
				await cline.diffViewProvider.update(originalContent!, true)
				await cline.diffViewProvider.scrollToFirstDiff()

				// For batch operations, we've already gotten approval
				const isWriteProtected = cline.rooProtectedController?.isWriteProtected(relPath) || false
				const sharedMessageProps: ClineSayTool = {
					tool: "appliedDiff",
					path: getReadablePath(cline.cwd, relPath),
					isProtected: isWriteProtected,
				}

				// If single file, ask for approval
				let didApprove = true
				if (operationsToApprove.length === 1) {
					const diffContents = diffItems.map((item) => item.content).join("\n\n")
					const operationMessage = JSON.stringify({
						...sharedMessageProps,
						diff: diffContents,
					} satisfies ClineSayTool)

					let toolProgressStatus

					if (cline.diffStrategy && cline.diffStrategy.getProgressStatus) {
						toolProgressStatus = cline.diffStrategy.getProgressStatus(
							{
								...block,
								params: { ...block.params, diff: diffContents },
							},
							{ success: true },
						)
					}

					// Check if file is write-protected
					const isWriteProtected = cline.rooProtectedController?.isWriteProtected(relPath) || false
					didApprove = await askApproval("tool", operationMessage, toolProgressStatus, isWriteProtected)
				}

				if (!didApprove) {
					await cline.diffViewProvider.revertChanges()
					results.push(`Changes to ${relPath} were not approved by user`)
					continue
				}

				// Call saveChanges to update the DiffViewProvider properties
				await cline.diffViewProvider.saveChanges()

				// Track file edit operation
				await cline.fileContextTracker.trackFileContext(relPath, "roo_edited" as RecordSource)

				// Used to determine if we should wait for busy terminal to update before sending api request
				cline.didEditFile = true
				let partFailHint = ""

				if (successCount < diffItems.length) {
					partFailHint = `Unable to apply all diff parts to file: ${absolutePath}`
				}

				// Get the formatted response message
				const message = await cline.diffViewProvider.pushToolWriteResult(cline, cline.cwd, !fileExists)

				if (partFailHint) {
					results.push(partFailHint + "\n" + message)
				} else {
					results.push(message)
				}

				await cline.diffViewProvider.reset()
			} catch (error) {
				const errorMsg = error instanceof Error ? error.message : String(error)
				updateOperationResult(relPath, {
					status: "error",
					error: `Error processing ${relPath}: ${errorMsg}`,
				})
				results.push(`Error processing ${relPath}: ${errorMsg}`)
			}
		}

		// Add filtered operation errors to results
		if (filteredOperationErrors.length > 0) {
			results.push(...filteredOperationErrors)
		}

		// Report all diff errors at once if any
		if (allDiffErrors.length > 0) {
			await cline.say("diff_error", allDiffErrors.join("\n"))
		}

		// Push the final result combining all operation results
		pushToolResult(results.join("\n\n"))
		return
	} catch (error) {
		await handleError("applying diff", error)
		await cline.diffViewProvider.reset()
		return
	}
}
