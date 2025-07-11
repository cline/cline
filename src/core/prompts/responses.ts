import { Anthropic } from "@anthropic-ai/sdk"
import * as diff from "diff"
import * as path from "path"
import { ClineIgnoreController, LOCK_TEXT_SYMBOL } from "../ignore/ClineIgnoreController"

export const formatResponse = {
	duplicateFileReadNotice: () =>
		`[[注意] 为节省上下文空间，此文件的读取已被移除。请参考最新的文件读取，以获取该文件的最新版本。]`,

	contextTruncationNotice: () =>
		`[注意] 为保持最佳上下文窗口长度，部分用户的历史对话已被移除。已保留初始用户任务和最近的交流以保持连贯，其余中间记录已被删减。请在继续协助用户时注意此点。`,

	condense: () =>
		`用户已接受您生成的精简对话摘要。该摘要涵盖了已截断的历史对话中的重要细节。
<explicit_instructions type="condense_response">请务必仅询问用户下一步该做什么。不要主动提出任何操作或假设要继续执行任务。比如，不要建议修改文件或尝试读取任何文件。
在询问用户下一步时，可以引用刚生成的摘要信息，但不要引用摘要之外的内容。请保持响应简洁。</explicit_instructions>`,

	toolDenied: () => `用户已拒绝此操作。`,

	toolError: (error?: string) =>
		`工具执行失败，错误信息如下：
<error>
${error}
</error>`,

	clineIgnoreError: (path: string) =>
		`由于 .clineignore 配置，无法访问 ${path}。您必须在不使用此文件的情况下继续任务，或请用户更新 .clineignore。`,

	noToolsUsed: () =>
		`[错误] 您在上一条响应中未使用任何工具！请在响应中使用工具。

# 下一步

- 如果已完成用户任务，请使用 attempt_completion 工具。
- 如果需要更多信息，请使用 ask_followup_question 工具。
- 否则，继续执行任务的下一步。`,

	tooManyMistakes: (feedback?: string) =>
		`您似乎在执行任务时遇到了困难。用户提供了以下反馈以帮助您：
<feedback>
${feedback}
</feedback>`,

	autoApprovalMaxReached: (feedback?: string) =>
		`自动批准次数已达上限。用户提供了以下反馈以帮助您：
<feedback>
${feedback}
</feedback>`,

	missingToolParameterError: (paramName: string) =>
		`缺少必需参数 '${paramName}' 的值。请提供完整信息。

# 工具使用指南提醒`,

	invalidMcpToolArgumentError: (serverName: string, toolName: string) =>
		`对 ${serverName} 的 ${toolName} 工具调用中使用了无效的 JSON 参数。请使用正确格式重试。`,

	toolResult: (
		text: string,
		images?: string[],
		fileString?: string,
	): string | Array<Anthropic.TextBlockParam | Anthropic.ImageBlockParam> => {
		let toolResultOutput: Array<Anthropic.TextBlockParam | Anthropic.ImageBlockParam> = []

		if (!(images && images.length > 0) && !fileString) {
			return text
		}

		const textBlock: Anthropic.TextBlockParam = { type: "text", text }
		toolResultOutput.push(textBlock)

		if (images && images.length > 0) {
			const imageBlocks: Anthropic.ImageBlockParam[] = formatImagesIntoBlocks(images)
			toolResultOutput.push(...imageBlocks)
		}

		if (fileString) {
			const fileBlock: Anthropic.TextBlockParam = { type: "text", text: fileString }
			toolResultOutput.push(fileBlock)
		}

		return toolResultOutput
	},

	imageBlocks: (images?: string[]): Anthropic.ImageBlockParam[] => {
		return formatImagesIntoBlocks(images)
	},

	formatFilesList: (
		absolutePath: string,
		files: string[],
		didHitLimit: boolean,
		clineIgnoreController?: ClineIgnoreController,
	): string => {
		const sorted = files
			.map((file) => {
				const relativePath = path.relative(absolutePath, file).toPosix()
				return file.endsWith("/") ? relativePath + "/" : relativePath
			})
			.sort((a, b) => {
				const aParts = a.split("/")
				const bParts = b.split("/")
				for (let i = 0; i < Math.min(aParts.length, bParts.length); i++) {
					if (aParts[i] !== bParts[i]) {
						if (i + 1 === aParts.length && i + 1 < bParts.length) {
							return -1
						}
						if (i + 1 === bParts.length && i + 1 < aParts.length) {
							return 1
						}
						return aParts[i].localeCompare(bParts[i], undefined, {
							numeric: true,
							sensitivity: "base",
						})
					}
				}
				return aParts.length - bParts.length
			})

		const clineIgnoreParsed = clineIgnoreController
			? sorted.map((filePath) => {
					const absoluteFilePath = path.resolve(absolutePath, filePath)
					const isIgnored = !clineIgnoreController.validateAccess(absoluteFilePath)
					return isIgnored ? LOCK_TEXT_SYMBOL + " " + filePath : filePath
				})
			: sorted

		if (didHitLimit) {
			return `${clineIgnoreParsed.join("\n")}

（文件列表已截断。如需进一步探索，请对特定子目录使用 list_files。）`
		} else if (clineIgnoreParsed.length === 0 || (clineIgnoreParsed.length === 1 && clineIgnoreParsed[0] === "")) {
			return "未找到文件。"
		} else {
			return clineIgnoreParsed.join("\n")
		}
	},

	createPrettyPatch: (filename = "file", oldStr?: string, newStr?: string) => {
		const patch = diff.createPatch(filename.toPosix(), oldStr || "", newStr || "")
		const lines = patch.split("\n")
		return lines.slice(4).join("\n")
	},

	taskResumption: (
		mode: "plan" | "act",
		agoText: string,
		cwd: string,
		wasRecent?: boolean | 0,
		responseText?: string,
		hasPendingFileContextWarnings?: boolean,
	): [string, string] => {
		const taskResumptionMessage =
			mode === "plan"
				? `[任务恢复] 此任务在${agoText}被中断。对话可能不完整，请注意项目状态已变化。当前工作目录：'${cwd.toPosix()}'。

注意：如果上次工具未获结果，请假设失败，并使用计划模式工具响应。`
				: `[任务恢复] 此任务在${agoText}被中断，可能未完成，请重新评估上下文。当前工作目录：'${cwd.toPosix()}'。如未完成，请重试上一步并继续。

注意：若上次 replace_in_file 或 write_to_file 中断，文件已恢复，无需重新读取。`

		const userResponseMessage = responseText
			? `${
					mode === "plan"
						? "请输入新消息，并用 plan_mode_respond 工具响应（在 <response> 参数中填写）。"
						: "新的指令，用于继续任务"
				}：
<user_message>
${responseText}
</user_message>`
			: mode === "plan"
				? "（用户未提供新消息。请询问他们如何继续或建议切换到 Act 模式。）"
				: ""

		return [taskResumptionMessage, userResponseMessage]
	},

	planModeInstructions: () =>
		`在此模式下，专注于信息收集、提问和方案设计。获取所需信息后，使用 plan_mode_respond 工具与用户互动。完成前请勿使用该工具。`,

	fileEditWithUserChanges: (
		relPath: string,
		userEdits: string,
		autoFormattingEdits?: string,
		finalContent?: string,
		newProblemsMessage?: string,
	) =>
		`用户对内容进行了以下更新：\n\n${userEdits}\n\n` +
		(autoFormattingEdits ? `自动格式化：\n\n${autoFormattingEdits}\n\n` : "") +
		`更新已保存到 ${relPath.toPosix()}。以下为保存的完整内容：
<final_file_content path="${relPath.toPosix()}">
${finalContent}
</final_file_content>

请注意：
1. 无需重新写入文件，修改已应用。
2. 后续操作请以此内容为基准。
3. 如需调整，请参考 final_file_content 的最新版本。
${newProblemsMessage}`,

	fileEditWithoutUserChanges: (
		relPath: string,
		autoFormattingEdits?: string,
		finalContent?: string,
		newProblemsMessage?: string,
	) =>
		`内容已成功保存到 ${relPath.toPosix()}。

` +
		(autoFormattingEdits ? `自动格式化：\n\n${autoFormattingEdits}\n\n` : "") +
		`以下为保存的完整文件内容：
<final_file_content path="${relPath.toPosix()}">
${finalContent}
</final_file_content>

重要：
后续更改请始终参考上述 final_file_content。
${newProblemsMessage}`,

	diffError: (relPath: string, originalContent?: string) =>
		`这通常是由于 SEARCH 块内容与文件不完全匹配或顺序有误导致。请确保格式正确，且仅替换目标内容，否则会引起工具失败。

文件已恢复至原始状态：
<file_content path="${relPath.toPosix()}">
${originalContent}
</file_content>

请重新尝试，减少 SEARCH/REPLACE 块数量 (<5)，并确保与文件内容匹配。如连续失败三次，可使用 write_to_file 工具。`,

	toolAlreadyUsed: (toolName: string) =>
		`工具 [${toolName}] 未执行，因为当前消息已使用其他工具。每条消息仅可使用一次工具，请先处理该工具结果，谢谢。`,

	clineIgnoreInstructions: (content: string) =>
		`# .clineignore

以下来自根目录 .clineignore 文件，用户指定了不应访问的文件和目录。当使用 list_files 时，被阻止的文件前会有 ${LOCK_TEXT_SYMBOL} 标记。尝试访问时会失败。

${content}
.clineignore`,

	clineRulesGlobalDirectoryInstructions: (globalClineRulesFilePath: string, content: string) =>
		`# .clinerules/

以下来自全局 .clinerules/ 目录 (${globalClineRulesFilePath.toPosix()})，用户在此指定了各项工作目录的说明：

${content}`,

	clineRulesLocalDirectoryInstructions: (cwd: string, content: string) =>
		`# .clinerules/

以下来自根目录 .clinerules/ 目录（当前工作目录 ${cwd.toPosix()}）的本地说明：

${content}`,

	clineRulesLocalFileInstructions: (cwd: string, content: string) =>
		`# .clinerules

以下来自根目录 .clinerules 文件（当前工作目录 ${cwd.toPosix()}）的本地说明：

${content}`,

	windsurfRulesLocalFileInstructions: (cwd: string, content: string) =>
		`# .windsurfrules

以下来自根目录 .windsurfrules 文件（当前工作目录 ${cwd.toPosix()}）的本地说明：

${content}`,

	cursorRulesLocalFileInstructions: (cwd: string, content: string) =>
		`# .cursorrules

以下来自根目录 .cursorrules 文件（当前工作目录 ${cwd.toPosix()}）的本地说明：

${content}`,

	cursorRulesLocalDirectoryInstructions: (cwd: string, content: string) =>
		`# .cursor/rules

以下来自根目录 .cursor/rules 目录（当前工作目录 ${cwd.toPosix()}）的本地说明：

${content}`,

	fileContextWarning: (editedFiles: string[]): string => {
		const fileCount = editedFiles.length
		const fileVerb = fileCount === 1 ? "个文件已" : "些文件已"
		const fileDemonstrativePronoun = fileCount === 1 ? "该文件" : "这些文件"
		const filePersonalPronoun = fileCount === 1 ? "它" : "它们"

		return (
			`
<explicit_instructions>
重要文件状态警告：${fileCount} ${fileVerb}在上次交互后被外部修改。您对${fileDemonstrativePronoun}的缓存已过时且不可靠。修改前，必须先执行 read_file 以获取最新状态，因为${filePersonalPronoun}可能已完全不同：
` +
			editedFiles.map((file) => `  ${path.resolve(file).toPosix()}`).join("\n") +
			`
如果跳过重新读取，将导致 replace_in_file 编辑失败并浪费 Token。如不再提示，无需再次读取。
</explicit_instructions>`
		)
	},
}

// 为避免循环依赖
const formatImagesIntoBlocks = (images?: string[]): Anthropic.ImageBlockParam[] => {
	return images
		? images.map((dataUrl) => {
				const [rest, base64] = dataUrl.split(",")
				const mimeType = rest.split(":")[1].split(";")[0]
				return {
					type: "image",
					source: {
						type: "base64",
						media_type: mimeType,
						data: base64,
					},
				} as Anthropic.ImageBlockParam
			})
		: []
}

const toolUseInstructionsReminder = `# 提示：工具使用指南

工具使用采用 XML 风格标签，工具名和参数用开始/结束标签包裹，结构如下：

<tool_name>
<parameter_name>值</parameter_name>
...
</tool_name>

例如：
<attempt_completion>
<result>
任务完成说明...
</result>
</attempt_completion>

请始终遵循此格式，以确保正确解析和执行。`
