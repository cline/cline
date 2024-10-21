import { Anthropic } from "@anthropic-ai/sdk"
import delay from "delay"
import * as path from "path"
import { DiffViewProvider } from "../../integrations/editor/DiffViewProvider"
import { extractTextFromFile } from "../../integrations/misc/extract-text"
import { listFiles } from "../../services/glob/list-files"
import { regexSearchFiles } from "../../services/ripgrep"
import { parseSourceCodeForDefinitionsTopLevel } from "../../services/tree-sitter"
import {
	ClineAsk,
	ClineMessage,
	ClineSay,
	ClineSayTool,
} from "../../shared/ExtensionMessage"
import { ClineAskResponse } from "../../shared/WebviewMessage"
import { fileExistsAtPath } from "../../utils/fs"
import { getReadablePath } from "../../utils/path"
import { AssistantMessageContent, ToolParamName, ToolUseName } from "../assistant-message"
import { formatResponse } from "../prompts/responses"
import { showOmissionWarning } from "../../integrations/editor/detect-omission"
import { ToolResponse } from "./clineTypes"

export interface PresentAssistantMessageParams {
	block: AssistantMessageContent;
	didRejectTool: boolean;
	alwaysAllowReadOnly: boolean;
	cwd: string;
	ask: (type: ClineAsk, text?: string, partial?: boolean ) => Promise<{ response: ClineAskResponse; text?: string; images?: string[] }>;
	say: (type: ClineSay, text?: string, images?: string[], partial?: boolean) => Promise<undefined>;
	sayAndCreateMissingParamError: (toolName: ToolUseName, paramName: string, relPath?: string) => Promise<ToolResponse>;
	diffViewProvider: DiffViewProvider;
	executeCommandTool: (command: string) => Promise<[boolean, ToolResponse]>;
	urlContentFetcher: { launchBrowser: () => Promise<void>; urlToScreenshotAndLogs: (url: string) => Promise<{ screenshot: string; logs: string }>; closeBrowser: () => Promise<void> };
	userMessageContent: (Anthropic.TextBlockParam | Anthropic.ImageBlockParam)[];
	clineMessages: ClineMessage[];
}

export async function presentAssistantMessageContent(params: PresentAssistantMessageParams) {
	const {
		block,
		didRejectTool,
		alwaysAllowReadOnly,
		cwd,
		ask,
		say,
		sayAndCreateMissingParamError,
		diffViewProvider,
		executeCommandTool,
		urlContentFetcher,
		userMessageContent,
		clineMessages,
	} = params
	switch (block.type) {
		case "text": {
			if (didRejectTool) {
				break
			}
			let content = block.content
			if (content) {
				content = content.replace(/<thinking>\s?/g, "")
				content = content.replace(/\s?<\/thinking>/g, "")
				const lastOpenBracketIndex = content.lastIndexOf("<")
				if (lastOpenBracketIndex !== -1) {
					const possibleTag = content.slice(lastOpenBracketIndex)
					const hasCloseBracket = possibleTag.includes(">")
					if (!hasCloseBracket) {
						let tagContent: string
						if (possibleTag.startsWith("</")) {
							tagContent = possibleTag.slice(2).trim()
						} else {
							tagContent = possibleTag.slice(1).trim()
						}
						const isLikelyTagName = /^[a-zA-Z_]+$/.test(tagContent)
						const isOpeningOrClosing = possibleTag === "<" || possibleTag === "</"
						if (isOpeningOrClosing || isLikelyTagName) {
							content = content.slice(0, lastOpenBracketIndex).trim()
						}
					}
				}
			}
			await say("text", content, undefined, block.partial)
			break
		}
		case "tool_use":
			const toolDescription = () => {
				switch (block.name) {
					case "execute_command":
						return `[${block.name} for '${block.params.command}']`
					case "read_file":
						return `[${block.name} for '${block.params.path}']`
					case "write_to_file":
						return `[${block.name} for '${block.params.path}']`
					case "search_files":
						return `[${block.name} for '${block.params.regex}'${
							block.params.file_pattern ? ` in '${block.params.file_pattern}'` : ""
						}]`
					case "list_files":
						return `[${block.name} for '${block.params.path}']`
					case "list_code_definition_names":
						return `[${block.name} for '${block.params.path}']`
					case "inspect_site":
						return `[${block.name} for '${block.params.url}']`
					case "ask_followup_question":
						return `[${block.name} for '${block.params.question}']`
					case "attempt_completion":
						return `[${block.name}]`
				}
			}

			if (didRejectTool) {
				if (!block.partial) {
					userMessageContent.push({
						type: "text",
						text: `Skipping tool ${toolDescription()} due to user rejecting a previous tool.`,
					})
				} else {
					userMessageContent.push({
						type: "text",
						text: `Tool ${toolDescription()} was interrupted and not executed due to user rejecting a previous tool.`,
					})
				}
				break
			}

			const pushToolResult = (content: ToolResponse) => {
				userMessageContent.push({
					type: "text",
					text: `${toolDescription()} Result:`,
				})
				if (typeof content === "string") {
					userMessageContent.push({
						type: "text",
						text: content || "(tool did not return anything)",
					})
				} else {
					userMessageContent.push(...content)
				}
			}

			const askApproval = async (type: ClineAsk, partialMessage?: string) => {
				const { response, text, images } = await ask(type, partialMessage, false)
				if (response !== "yesButtonClicked") {
					if (response === "messageResponse") {
						await say("user_feedback", text, images)
						pushToolResult(
							formatResponse.toolResult(formatResponse.toolDeniedWithFeedback(text), images)
						)
						return false
					}
					pushToolResult(formatResponse.toolDenied())
					return false
				}
				return true
			}

			const handleError = async (action: string, error: Error) => {
				const errorString = `Error ${action}: ${JSON.stringify(error)}`
				await say(
					"error",
					`Error ${action}:\n${error.message ?? JSON.stringify(error, null, 2)}`
				)
				pushToolResult(formatResponse.toolError(errorString))
			}

			const removeClosingTag = (tag: ToolParamName, text?: string) => {
				if (!block.partial) {
					return text || ""
				}
				if (!text) {
					return ""
				}
				const tagRegex = new RegExp(
					`\\s?<\/?${tag
						.split("")
						.map((char) => `(?:${char})?`)
						.join("")}$`,
					"g"
				)
				return text.replace(tagRegex, "")
			}

			switch (block.name) {
				case "write_to_file": {
					const relPath: string | undefined = block.params.path
					let newContent: string | undefined = block.params.content
					if (!relPath || !newContent) {
						break
					}
					
					let fileExists: boolean
					if (diffViewProvider.editType !== undefined) {
						fileExists = diffViewProvider.editType === "modify"
					} else {
						fileExists = await fileExistsAtPath(path.resolve(cwd, relPath))
						diffViewProvider.editType = fileExists ? "modify" : "create"
					}

					if (newContent.startsWith("```")) {
						newContent = newContent.split("\n").slice(1).join("\n").trim()
					}
					if (newContent.endsWith("```")) {
						newContent = newContent.split("\n").slice(0, -1).join("\n").trim()
					}

					if (
						newContent.includes("&gt;") ||
						newContent.includes("&lt;") ||
						newContent.includes("&quot;")
					) {
						newContent = newContent
							.replace(/&gt;/g, ">")
							.replace(/&lt;/g, "<")
							.replace(/&quot;/g, '"')
					}

					const sharedMessageProps: ClineSayTool = {
						tool: fileExists ? "editedExistingFile" : "newFileCreated",
						path: getReadablePath(cwd, removeClosingTag("path", relPath)),
					}
					try {
						if (block.partial) {
							const partialMessage = JSON.stringify(sharedMessageProps)
							await ask("tool", partialMessage, block.partial).catch(() => {})
							if (!diffViewProvider.isEditing) {
								await diffViewProvider.open(relPath)
							}
							await diffViewProvider.update(newContent, false)
							break
						} else {
							if (!relPath) {
								pushToolResult(await sayAndCreateMissingParamError("write_to_file", "path"))
								await diffViewProvider.reset()
								break
							}
							if (!newContent) {
								pushToolResult(await sayAndCreateMissingParamError("write_to_file", "content"))
								await diffViewProvider.reset()
								break
							}

							if (!diffViewProvider.isEditing) {
								const partialMessage = JSON.stringify(sharedMessageProps)
								await ask("tool", partialMessage, true).catch(() => {}) 
								await diffViewProvider.open(relPath)
							}
							await diffViewProvider.update(newContent, true)
							await delay(300) 
							diffViewProvider.scrollToFirstDiff()
							showOmissionWarning(diffViewProvider.originalContent || "", newContent)

							const completeMessage = JSON.stringify({
								...sharedMessageProps,
								content: fileExists ? undefined : newContent,
								diff: fileExists
									? formatResponse.createPrettyPatch(
											relPath,
											diffViewProvider.originalContent,
											newContent
									  )
									: undefined,
							} satisfies ClineSayTool)
							const didApprove = await askApproval("tool", completeMessage)
							if (!didApprove) {
								await diffViewProvider.revertChanges()
								break
							}
							const { newProblemsMessage, userEdits, finalContent } =
								await diffViewProvider.saveChanges()
							if (userEdits) {
								await say(
									"user_feedback_diff",
									JSON.stringify({
										tool: fileExists ? "editedExistingFile" : "newFileCreated",
										path: getReadablePath(cwd, relPath),
										diff: userEdits,
									} satisfies ClineSayTool)
								)
								pushToolResult(
									`The user made the following updates to your content:\n\n${userEdits}\n\n` +
										`The updated content, which includes both your original modifications and the user's edits, has been successfully saved to ${relPath.toPosix()}. Here is the full, updated content of the file:\n\n` +
										`<final_file_content path="${relPath.toPosix()}">\n${finalContent}\n</final_file_content>\n\n` +
										`Please note:\n` +
										`1. You do not need to re-write the file with these changes, as they have already been applied.\n` +
										`2. Proceed with the task using this updated file content as the new baseline.\n` +
										`3. If the user's edits have addressed part of the task or changed the requirements, adjust your approach accordingly.` +
										`${newProblemsMessage}`
								)
							} else {
								pushToolResult(
									`The content was successfully saved to ${relPath.toPosix()}.${newProblemsMessage}`
								)
							}
							await diffViewProvider.reset()
							break
						}
					} catch (error) {
						await handleError("writing file", error as Error)
						await diffViewProvider.reset()
						break
					}
				}
				case "read_file": {
					const relPath: string | undefined = block.params.path
					const sharedMessageProps: ClineSayTool = {
						tool: "readFile",
						path: getReadablePath(cwd, removeClosingTag("path", relPath)),
					}
					try {
						if (block.partial) {
							const partialMessage = JSON.stringify({
								...sharedMessageProps,
								content: undefined,
							} satisfies ClineSayTool)
							if (alwaysAllowReadOnly) {
								await say("tool", partialMessage, undefined, block.partial)
							} else {
								await ask("tool", partialMessage, block.partial).catch(() => {})
							}
							break
						} else {
							if (!relPath) {
								pushToolResult(await sayAndCreateMissingParamError("read_file", "path"))
								break
							}
							const absolutePath = path.resolve(cwd, relPath)
							const completeMessage = JSON.stringify({
								...sharedMessageProps,
								content: absolutePath,
							} satisfies ClineSayTool)
							if (alwaysAllowReadOnly) {
								await say("tool", completeMessage, undefined, false) 
							} else {
								const didApprove = await askApproval("tool", completeMessage)
								if (!didApprove) {
									break
								}
							}
							const content = await extractTextFromFile(absolutePath)
							pushToolResult(content)
							break
						}
					} catch (error) {
						await handleError("reading file", error as Error)
						break
					}
				}
				case "list_files": {
					const relDirPath: string | undefined = block.params.path
					const recursiveRaw: string | undefined = block.params.recursive
					const recursive = recursiveRaw?.toLowerCase() === "true"
					const sharedMessageProps: ClineSayTool = {
						tool: !recursive ? "listFilesTopLevel" : "listFilesRecursive",
						path: getReadablePath(cwd, removeClosingTag("path", relDirPath)),
					}
					try {
						if (block.partial) {
							const partialMessage = JSON.stringify({
								...sharedMessageProps,
								content: "",
							} satisfies ClineSayTool)
							if (alwaysAllowReadOnly) {
								await say("tool", partialMessage, undefined, block.partial)
							} else {
								await ask("tool", partialMessage, block.partial).catch(() => {})
							}
							break
						} else {
							if (!relDirPath) {
								pushToolResult(await sayAndCreateMissingParamError("list_files", "path"))
								break
							}
							const absolutePath = path.resolve(cwd, relDirPath)
							const [files, didHitLimit] = await listFiles(absolutePath, recursive, 200)
							const result = formatResponse.formatFilesList(absolutePath, files, didHitLimit)
							const completeMessage = JSON.stringify({
								...sharedMessageProps,
								content: result,
							} satisfies ClineSayTool)
							if (alwaysAllowReadOnly) {
								await say("tool", completeMessage, undefined, false)
							} else {
								const didApprove = await askApproval("tool", completeMessage)
								if (!didApprove) {
									break
								}
							}
							pushToolResult(result)
							break
						}
					} catch (error) {
						await handleError("listing files", error as Error)
						break
					}
				}
				case "list_code_definition_names": {
					const relDirPath: string | undefined = block.params.path
					const sharedMessageProps: ClineSayTool = {
						tool: "listCodeDefinitionNames",
						path: getReadablePath(cwd, removeClosingTag("path", relDirPath)),
					}
					try {
						if (block.partial) {
							const partialMessage = JSON.stringify({
								...sharedMessageProps,
								content: "",
							} satisfies ClineSayTool)
							if (alwaysAllowReadOnly) {
								await say("tool", partialMessage, undefined, block.partial)
							} else {
								await ask("tool", partialMessage, block.partial).catch(() => {})
							}
							break
						} else {
							if (!relDirPath) {
								pushToolResult(
									await sayAndCreateMissingParamError("list_code_definition_names", "path")
								)
								break
							}
							const absolutePath = path.resolve(cwd, relDirPath)
							const result = await parseSourceCodeForDefinitionsTopLevel(absolutePath)
							const completeMessage = JSON.stringify({
								...sharedMessageProps,
								content: result,
							} satisfies ClineSayTool)
							if (alwaysAllowReadOnly) {
								await say("tool", completeMessage, undefined, false)
							} else {
								const didApprove = await askApproval("tool", completeMessage)
								if (!didApprove) {
									break
								}
							}
							pushToolResult(result)
							break
						}
					} catch (error) {
						await handleError("parsing source code definitions", error as Error)
						break
					}
				}
				case "search_files": {
					const relDirPath: string | undefined = block.params.path
					const regex: string | undefined = block.params.regex
					const filePattern: string | undefined = block.params.file_pattern
					const sharedMessageProps: ClineSayTool = {
						tool: "searchFiles",
						path: getReadablePath(cwd, removeClosingTag("path", relDirPath)),
						regex: removeClosingTag("regex", regex),
						filePattern: removeClosingTag("file_pattern", filePattern),
					}
					try {
						if (block.partial) {
							const partialMessage = JSON.stringify({
								...sharedMessageProps,
								content: "",
							} satisfies ClineSayTool)
							if (alwaysAllowReadOnly) {
								await say("tool", partialMessage, undefined, block.partial)
							} else {
								await ask("tool", partialMessage, block.partial).catch(() => {})
							}
							break
						} else {
							if (!relDirPath) {
								pushToolResult(await sayAndCreateMissingParamError("search_files", "path"))
								break
							}
							if (!regex) {
								pushToolResult(await sayAndCreateMissingParamError("search_files", "regex"))
								break
							}
							const absolutePath = path.resolve(cwd, relDirPath)
							const results = await regexSearchFiles(cwd, absolutePath, regex, filePattern)
							const completeMessage = JSON.stringify({
								...sharedMessageProps,
								content: results,
							} satisfies ClineSayTool)
							if (alwaysAllowReadOnly) {
								await say("tool", completeMessage, undefined, false)
							} else {
								const didApprove = await askApproval("tool", completeMessage)
								if (!didApprove) {
									break
								}
							}
							pushToolResult(results)
							break
						}
					} catch (error) {
						await handleError("searching files", error as Error)
						break
					}
				}
				case "inspect_site": {
					const url: string | undefined = block.params.url
					const sharedMessageProps: ClineSayTool = {
						tool: "inspectSite",
						path: removeClosingTag("url", url),
					}
					try {
						if (block.partial) {
							const partialMessage = JSON.stringify(sharedMessageProps)
							if (alwaysAllowReadOnly) {
								await say("tool", partialMessage, undefined, block.partial)
							} else {
								await ask("tool", partialMessage, block.partial).catch(() => {})
							}
							break
						} else {
							if (!url) {
								pushToolResult(await sayAndCreateMissingParamError("inspect_site", "url"))
								break
							}
							const completeMessage = JSON.stringify(sharedMessageProps)
							if (alwaysAllowReadOnly) {
								await say("tool", completeMessage, undefined, false)
							} else {
								const didApprove = await askApproval("tool", completeMessage)
								if (!didApprove) {
									break
								}
							}
							await say("inspect_site_result", "") 
							await urlContentFetcher.launchBrowser()
							let result: {
								screenshot: string
								logs: string
							}
							try {
								result = await urlContentFetcher.urlToScreenshotAndLogs(url)
							} finally {
								await urlContentFetcher.closeBrowser()
							}
							const { screenshot, logs } = result
							await say("inspect_site_result", logs, [screenshot])

							pushToolResult(
								formatResponse.toolResult(
									`The site has been visited, with console logs captured and a screenshot taken for your analysis.\n\nConsole logs:\n${
										logs || "(No logs)"
									}`,
									[screenshot]
								)
							)
							break
						}
					} catch (error) {
						await handleError("inspecting site", error as Error)
						break
					}
				}
				case "execute_command": {
					const command: string | undefined = block.params.command
					try {
						if (block.partial) {
							await ask("command", removeClosingTag("command", command), block.partial).catch(
								() => {}
							)
							break
						} else {
							if (!command) {
								pushToolResult(
									await sayAndCreateMissingParamError("execute_command", "command")
								)
								break
							}
							const didApprove = await askApproval("command", command)
							if (!didApprove) {
								break
							}
							const [userRejected, result] = await executeCommandTool(command)
							if (userRejected) {
								//this.didRejectTool = true
								return 
							}
							pushToolResult(result)
							break
						}
					} catch (error) {
						await handleError("executing command", error as Error)
						break
					}
				}

				case "ask_followup_question": {
					const question: string | undefined = block.params.question
					try {
						if (block.partial) {
							await ask("followup", removeClosingTag("question", question), block.partial).catch(
								() => {}
							)
							break
						} else {
							if (!question) {
								pushToolResult(
									await sayAndCreateMissingParamError("ask_followup_question", "question")
								)
								break
							}
							const { text, images } = await ask("followup", question, false)
							await say("user_feedback", text ?? "", images)
							pushToolResult(formatResponse.toolResult(`<answer>\n${text}\n</answer>`, images))
							break
						}
					} catch (error) {
						await handleError("asking question", error as Error)
						break
					}
				}
				case "attempt_completion": {
					const result: string | undefined = block.params.result
					const command: string | undefined = block.params.command
					try {
						const lastMessage = clineMessages.at(-1)
						if (block.partial) {
							if (command) {
								if (lastMessage && lastMessage.ask === "command") {
									await ask(
										"command",
										removeClosingTag("command", command),
										block.partial
									).catch(() => {})
								} else {
									await say(
										"completion_result",
										removeClosingTag("result", result),
										undefined,
										false
									)
									await ask(
										"command",
										removeClosingTag("command", command),
										block.partial
									).catch(() => {})
								}
							} else {
								await say(
									"completion_result",
									removeClosingTag("result", result),
									undefined,
									block.partial
								)
							}
							break
						} else {
							if (!result) {
								pushToolResult(
									await sayAndCreateMissingParamError("attempt_completion", "result")
								)
								break
							}
							let commandResult: ToolResponse | undefined
							if (command) {
								if (lastMessage && lastMessage.ask !== "command") {
									await say("completion_result", result, undefined, false)
								}
								const didApprove = await askApproval("command", command)
								if (!didApprove) {
									break
								}
								const [userRejected, execCommandResult] = await executeCommandTool(command!)
								if (userRejected) {
									//this.didRejectTool = true
									pushToolResult(execCommandResult)
									break
								}
								commandResult = execCommandResult
							} else {
								await say("completion_result", result, undefined, false)
							}

							const { response, text, images } = await ask("completion_result", "", false)
							if (response === "yesButtonClicked") {
								pushToolResult("") 
								break
							}
							await say("user_feedback", text ?? "", images)

							const toolResults: (Anthropic.TextBlockParam | Anthropic.ImageBlockParam)[] = []
							if (commandResult) {
								if (typeof commandResult === "string") {
									toolResults.push({ type: "text", text: commandResult })
								} else if (Array.isArray(commandResult)) {
									toolResults.push(...commandResult)
								}
							}
							toolResults.push({
								type: "text",
								text: `The user has provided feedback on the results. Consider their input to continue the task, and then attempt completion again.\n<feedback>\n${text}\n</feedback>`,
							})
							toolResults.push(...formatResponse.imageBlocks(images))
							userMessageContent.push({
								type: "text",
								text: `${toolDescription()} Result:`,
							})
							userMessageContent.push(...toolResults)

							break
						}
					} catch (error) {
						await handleError("attempting completion", error as Error)
						break
					}
				}
			}
			break
	}
}