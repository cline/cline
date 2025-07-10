import * as vscode from "vscode"
import { ApiConfiguration } from "../../shared/api"
import { buildApiHandler, ApiHandler } from "../../api"
import { getAllExtensionState } from "../storage/state"
import { Anthropic } from "@anthropic-ai/sdk"

interface CompletionContext {
	document: vscode.TextDocument
	position: vscode.Position
	textBeforeCursor: string
	textAfterCursor: string
	fileLanguage: string
	filePath: string
	surroundingCode: string
}

interface CompletionCache {
	position: vscode.Position
	documentVersion: number
	completion: string
	timestamp: number
}

export class InlineCompletionProvider implements vscode.InlineCompletionItemProvider {
	private debounceTimer: NodeJS.Timeout | null = null
	private cache: CompletionCache | null = null
	private lastRequest: Promise<vscode.InlineCompletionItem[] | null> | null = null
	private extensionContext: vscode.ExtensionContext
	private readonly CACHE_DURATION = 5000 // 5 seconds
	private readonly DEBOUNCE_DELAY = 300 // 300ms
	private outputChannel: vscode.OutputChannel

	constructor(context: vscode.ExtensionContext) {
		this.extensionContext = context
		this.outputChannel = vscode.window.createOutputChannel("Cline智能补全")
		this.outputChannel.appendLine("🚀 Cline 智能补全：初始化完成")
	}

	async provideInlineCompletionItems(
		document: vscode.TextDocument,
		position: vscode.Position,
		_context: vscode.InlineCompletionContext,
		token: vscode.CancellationToken,
	): Promise<vscode.InlineCompletionItem[] | null> {
		this.outputChannel.appendLine(
			`🔍 Cline 智能补全：触发补全请求 - 文件: ${document.fileName}, 位置: ${position.line}:${position.character}`,
		)

		// Check if we should provide completion
		if (!this.shouldProvideCompletion(document, position)) {
			this.outputChannel.appendLine("❌ Cline 智能补全：不满足补全条件，跳过")
			return null
		}

		// Check cache first
		const cachedResult = this.getCachedCompletion(document, position)
		if (cachedResult) {
			this.outputChannel.appendLine("⚡ Cline 智能补全：使用缓存结果")
			return [new vscode.InlineCompletionItem(cachedResult, new vscode.Range(position, position))]
		}

		// Cancel previous debounce timer
		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer)
		}

		// Return existing request if still pending
		if (this.lastRequest) {
			return this.lastRequest
		}

		// Create new debounced request
		this.lastRequest = new Promise((resolve) => {
			this.outputChannel.appendLine("⏱️ Cline 智能补全：开始防抖延迟")
			this.debounceTimer = setTimeout(async () => {
				this.outputChannel.appendLine("🚀 Cline 智能补全：防抖完成，开始获取补全")
				this.debounceTimer = null
				this.lastRequest = null

				if (token.isCancellationRequested) {
					this.outputChannel.appendLine("🚫 Cline 智能补全：请求已取消")
					resolve(null)
					return
				}

				try {
					const completion = await this.getCompletion(document, position, token)
					if (completion && !token.isCancellationRequested) {
						this.outputChannel.appendLine("✅ Cline 智能补全：成功获取补全，缓存结果")
						// Cache the result
						this.cache = {
							position,
							documentVersion: document.version,
							completion,
							timestamp: Date.now(),
						}
						resolve([new vscode.InlineCompletionItem(completion, new vscode.Range(position, position))])
					} else {
						this.outputChannel.appendLine("❌ Cline 智能补全：未获取到有效补全")
						resolve(null)
					}
				} catch (error) {
					this.outputChannel.appendLine("❌ Cline 智能补全：获取补全时发生错误: " + error)
					resolve(null)
				}
			}, this.DEBOUNCE_DELAY)
		})

		return this.lastRequest
	}

	private shouldProvideCompletion(document: vscode.TextDocument, position: vscode.Position): boolean {
		const currentLine = document.lineAt(position.line)
		const textBeforeCursor = currentLine.text.substring(0, position.character)
		const textAfterCursor = currentLine.text.substring(position.character)

		// Skip if there's non-whitespace text after cursor
		if (textAfterCursor.trim().length > 0) {
			this.outputChannel.appendLine("🔍 Cline 智能补全：光标后有非空白字符，跳过补全")
			return false
		}

		// Skip if line is empty or only whitespace
		if (textBeforeCursor.trim().length === 0) {
			this.outputChannel.appendLine("🔍 Cline 智能补全：光标前为空或仅有空白字符，跳过补全")
			return false
		}

		// Skip if cursor is at the beginning of a word (to avoid interfering with normal typing)
		const charBeforeCursor = textBeforeCursor.slice(-1)
		if (charBeforeCursor && /\w/.test(charBeforeCursor)) {
			const charAfterCursor = textAfterCursor.charAt(0)
			if (charAfterCursor && /\w/.test(charAfterCursor)) {
				this.outputChannel.appendLine("🔍 Cline 智能补全：光标在单词中间，跳过补全")
				return false
			}
		}

		this.outputChannel.appendLine("✅ Cline 智能补全：满足补全条件，继续处理")
		return true
	}

	private getCachedCompletion(document: vscode.TextDocument, position: vscode.Position): string | null {
		if (!this.cache) {
			return null
		}

		const now = Date.now()
		if (now - this.cache.timestamp > this.CACHE_DURATION) {
			this.cache = null
			return null
		}

		if (this.cache.position.isEqual(position) && this.cache.documentVersion === document.version) {
			return this.cache.completion
		}

		return null
	}

	private async getCompletion(
		document: vscode.TextDocument,
		position: vscode.Position,
		token: vscode.CancellationToken,
	): Promise<string | null> {
		try {
			// Get API configuration
			const { apiConfiguration } = await getAllExtensionState(this.extensionContext)
			if (!apiConfiguration) {
				this.outputChannel.appendLine("❌ Cline 智能补全：未找到 API 配置")
				return null
			}

			// Build API handler
			const apiHandler = buildApiHandler(apiConfiguration)
			if (!apiHandler) {
				this.outputChannel.appendLine("❌ Cline 智能补全：构建 API 处理器失败")
				return null
			}

			this.outputChannel.appendLine(`🔧 Cline 智能补全：使用 ${apiConfiguration.apiProvider} 模型进行补全`)

			// Collect context
			const context = this.collectContext(document, position)
			if (!context) {
				return null
			}

			// Build prompt
			const prompt = this.buildPrompt(context)
			this.outputChannel.appendLine("📝 Cline 智能补全：构建提示词完成")

			// Create messages for the LLM
			const messages: Anthropic.Messages.MessageParam[] = [
				{
					role: "user",
					content: prompt,
				},
			]

			// Call the LLM
			const systemPrompt = "你是一个有用的代码补全助手。提供简洁、准确的代码补全。"
			const stream = apiHandler.createMessage(systemPrompt, messages)
			this.outputChannel.appendLine("🌐 Cline 智能补全：开始请求 LLM 模型")

			if (token.isCancellationRequested) {
				this.outputChannel.appendLine("🚫 Cline 智能补全：LLM 请求前已取消")
				return null
			}

			// Collect the response
			let completion = ""
			for await (const chunk of stream) {
				if (token.isCancellationRequested) {
					return null
				}

				if (chunk.type === "text") {
					completion += chunk.text
				}
			}

			this.outputChannel.appendLine(`📥 Cline 智能补全：收到原始回复: "${completion.substring(0, 100)}..."`)

			// Process the completion
			const processedCompletion = this.processCompletion(completion)
			if (processedCompletion) {
				this.outputChannel.appendLine(`✨ Cline 智能补全：处理后的补全: "${processedCompletion.substring(0, 100)}..."`)
			} else {
				this.outputChannel.appendLine("❌ Cline 智能补全：处理后的补全为空")
			}
			return processedCompletion
		} catch (error) {
			this.outputChannel.appendLine("❌ Cline 智能补全：getCompletion 发生错误: " + error)
			return null
		}
	}

	private collectContext(document: vscode.TextDocument, position: vscode.Position): CompletionContext | null {
		try {
			const currentLine = document.lineAt(position.line)
			const textBeforeCursor = currentLine.text.substring(0, position.character)
			const textAfterCursor = currentLine.text.substring(position.character)

			// Get surrounding code context
			const surroundingCode = this.getSurroundingCode(document, position)

			return {
				document,
				position,
				textBeforeCursor,
				textAfterCursor,
				fileLanguage: document.languageId,
				filePath: document.fileName,
				surroundingCode,
			}
		} catch (error) {
			this.outputChannel.appendLine("❌ Cline 智能补全：收集上下文时发生错误: " + error)
			return null
		}
	}

	private getSurroundingCode(document: vscode.TextDocument, position: vscode.Position): string {
		const totalLines = document.lineCount
		const currentLine = position.line

		// Get context lines before and after cursor
		const contextLinesBefore = Math.min(20, currentLine)
		const contextLinesAfter = Math.min(20, totalLines - currentLine - 1)

		const startLine = Math.max(0, currentLine - contextLinesBefore)
		const endLine = Math.min(totalLines - 1, currentLine + contextLinesAfter)

		let code = ""
		for (let i = startLine; i <= endLine; i++) {
			const line = document.lineAt(i)
			if (i === currentLine) {
				// Insert markers at the cursor position
				const textBefore = line.text.substring(0, position.character)
				const textAfter = line.text.substring(position.character)
				code += textBefore + "<|user_cursor_is_here|>" + textAfter + "\n"
			} else {
				code += line.text + "\n"
			}
		}

		return code.trim()
	}

	private buildPrompt(context: CompletionContext): string {
		const { fileLanguage, filePath, surroundingCode } = context

		return `你是一个代码补全助手。请为光标位置（用 <|user_cursor_is_here|> 标记）的代码提供补全。

文件：${filePath}
语言：${fileLanguage}

<|editable_region_start|>
${surroundingCode}
<|editable_region_end|>

指令：
1. 分析光标位置周围的代码上下文
2. 提供简洁且相关的补全，让代码自然延续
3. 只返回应该在光标位置插入的补全文本
4. 不要包含任何解释、注释或额外文字
5. 不要重复光标前已有的代码
6. 确保补全在语法上正确，符合语言规范
7. 如果无法提供有意义的补全，返回空响应

补全：`
	}

	private processCompletion(rawCompletion: string): string | null {
		if (!rawCompletion || rawCompletion.trim().length === 0) {
			return null
		}

		// Clean up the completion
		let completion = rawCompletion.trim()

		// Remove any markdown code blocks
		completion = completion.replace(/```[\s\S]*?```/g, "")
		completion = completion.replace(/```.*$/gm, "")

		// Remove any remaining markers
		completion = completion.replace(/<\|[^|]*\|>/g, "")

		// Remove explanatory text that might have been included
		const lines = completion.split("\n")
		const codeLines = lines.filter((line) => {
			const trimmed = line.trim()
			// Skip lines that look like explanations
			if (
				trimmed.startsWith("//") &&
				(trimmed.includes("explanation") ||
					trimmed.includes("note") ||
					trimmed.includes("this") ||
					trimmed.includes("here"))
			) {
				return false
			}
			return true
		})

		completion = codeLines.join("\n").trim()

		// Ensure we have meaningful content
		if (completion.length === 0) {
			return null
		}

		// Limit completion length to prevent overwhelming suggestions
		if (completion.length > 500) {
			completion = completion.substring(0, 500)
			// Try to cut at a reasonable point (end of line)
			const lastNewlineIndex = completion.lastIndexOf("\n")
			if (lastNewlineIndex > 250) {
				completion = completion.substring(0, lastNewlineIndex)
			}
		}

		// Final validation - ensure completion doesn't start with whitespace only
		if (completion.trim().length === 0) {
			return null
		}

		return completion
	}

	public dispose() {
		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer)
		}
		this.lastRequest = null
		this.cache = null
		this.outputChannel.dispose()
	}
}
