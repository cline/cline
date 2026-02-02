import { execSync } from "child_process"
import * as fs from "fs"
import * as path from "path"
import type { ConversationMessage } from "./providers/base"
import type { Controller } from "../../core/controller"
import { getProviderAdapter } from "./providers/factory"


let controller: Controller | null = null

export function setController(ctrl: Controller) {
    controller = ctrl
    console.log("[cline-execution] Controller set successfully")
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

export async function executeThroughCline(
    task: string,
    systemPrompt: string,
    maxIterations: number = 10,
    existingMessages?: ConversationMessage[],
): Promise<ConversationMessage[]> {
    console.log("[cline-execution] 🚀 START executeThroughCline")

    try {
        const controller = getController()
        if (!controller || !controller.task) {
            throw new Error("No active Cline task")
        }

        const api = controller.task.api
        if (!api) {
            throw new Error("No LLM API available")
        }

        // 🎯 Get provider adapter for this API
        const adapter = getProviderAdapter(api)
        console.log(`[cline-execution] Using ${adapter.name} provider adapter`)

        const messages: ConversationMessage[] = existingMessages || [{ role: "user", content: [{ type: "text", text: task }] }]

        console.log(`[cline-execution] Tool-enabled execution (${maxIterations} iterations max)`)

        for (let i = 0; i < maxIterations; i++) {
            console.log(`[cline-execution] Iteration ${i + 1}/${maxIterations}`)

            // 🎯 Prepare messages using provider adapter
            const preparedMessages = adapter.prepareMessages(messages)

            const stream = api.createMessage(systemPrompt, preparedMessages, TOOL_DEFINITIONS)

            // 🎯 Consume stream using provider adapter
            const streamResult = await adapter.consumeStream(stream, {
                onText: () => {
                    // Optional: log text chunks
                },
                onToolCall: (_id, name) => {
                    console.log("[cline-execution] Tool:", name)
                },
                onThinking: () => {
                    // Optional: log thinking
                },
                onComplete: () => {
                    // Stream complete
                },
            })

            // 🎯 Validate tool calls using provider adapter (e.g., filter malformed JSON)
            const validToolCalls = adapter.validateToolCalls
                ? adapter.validateToolCalls(streamResult.toolCalls)
                : streamResult.toolCalls

            console.log(`[cline-execution] Valid tool calls: ${validToolCalls.length}/${streamResult.toolCalls.length}`)

            // Execute tools and collect results (ONLY valid tools)
            const toolExecutions: Array<{
                id: string
                name: string
                input: any
                result: string
            }> = []

            for (const toolCall of validToolCalls) {
                try {
                    const toolInput = JSON.parse(toolCall.arguments)
                    const toolResult = await executeTool(toolCall.name, toolInput)

                    toolExecutions.push({
                        id: toolCall.id,
                        name: toolCall.name,
                        input: toolInput,
                        result: toolResult,
                    })
                } catch (error) {
                    console.error("[cline-execution] Tool execution failed:", error)
                    toolExecutions.push({
                        id: toolCall.id,
                        name: toolCall.name,
                        input: {},
                        result: `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
                    })
                }
            }

            // 🎯 Build assistant message using provider adapter (SAME valid tools)
            const assistantMessage = adapter.buildAssistantMessage(
                streamResult.text,
                validToolCalls,
                streamResult.thinking,
                streamResult.thinkingSignature,
            )

            messages.push(assistantMessage)

            // 🎯 Add tool results using provider adapter
            if (toolExecutions.length > 0) {
                const toolResultMessage = adapter.buildToolResultMessage(toolExecutions)
                messages.push(toolResultMessage)
            }

            // Add iteration tracking after tool results
            if (streamResult.toolCalls.length > 0 && i < maxIterations - 1) {
                const iterationMsg =
                    i >= maxIterations - 2
                        ? `[System: Iteration ${i + 1} of ${maxIterations}. ⚠️ FINAL ITERATION - complete your task now!]`
                        : `[System: Iteration ${i + 1} of ${maxIterations}]`

                messages.push({
                    role: "user",
                    content: [{ type: "text", text: iterationMsg }],
                })
            }

            if (validToolCalls.length === 0) {
                console.log("[cline-execution] No more valid tools requested, stopping")
                break
            }
        }

        console.log("[cline-execution] ✅ Execution complete")
        return messages
    } catch (error) {
        console.error("[cline-execution] Error:", error)
        throw error
    }
}

export async function runFinalVerdict(
	messages: Array<any>,
	schemaPrompt: string,
	systemPrompt: string
): Promise<string> {
	console.log("[cline-execution] PHASE 2: Running final verdict (tools optional)")

    const controller = getController()
    if (!controller || !controller.task) {
        throw new Error("No active Cline task")
    }

    const api = controller.task.api
    if (!api) {
        throw new Error("No LLM API available")
    }

    // 🎯 Get provider adapter for this API
    const adapter = getProviderAdapter(api)

	// Append schema prompt as user message
	messages.push({
		role: "user",
		content: [{ type: "text", text: schemaPrompt }],
	})

	// Prepare messages for final verdict using provider adapter
	const finalPreparedMessages = adapter.prepareMessages(messages)

	// Create verdict stream
	const verdictStream = api.createMessage(systemPrompt, finalPreparedMessages, TOOL_DEFINITIONS)

	// Consume verdict stream
	const verdictResult = await adapter.consumeStream(verdictStream, {
		onText: () => {},
		onToolCall: () => {},
		onThinking: () => {},
		onComplete: () => {},
	})

	console.log("[cline-execution] Verdict received")
	return verdictResult.text
}


export async function loadChatHistory(chatId: string): Promise<string> {
    console.log("[cline-execution] Loading chat history for:", chatId)

    try {
        const controller = getController()
        if (!controller || !controller.task) {
            return "No active task found"
        }

        const apiHistory = controller.task.messageStateHandler.getApiConversationHistory()

        if (!apiHistory || apiHistory.length === 0) {
            return "No conversation history available"
        }

        const KEEP_LAST_N = 50 // Keep last 50 messages (~40K tokens, safe for 200K limit)

        // Take last N messages to stay under token limit
        const recentMessages = apiHistory.slice(-KEEP_LAST_N)
        const startIndex = apiHistory.length - recentMessages.length

        let formatted = "=== CHAT HISTORY ===\n\n"

        if (apiHistory.length > KEEP_LAST_N) {
            formatted += `(Showing last ${KEEP_LAST_N} of ${apiHistory.length} total messages)\n\n`
        }

        for (let i = 0; i < recentMessages.length; i++) {
            const msg = recentMessages[i]
            const msgNum = startIndex + i + 1
            formatted += `--- Message ${msgNum} (${msg.role.toUpperCase()}) ---\n`

            if (typeof msg.content === "string") {
                formatted += msg.content + "\n\n"
            } else if (Array.isArray(msg.content)) {
                for (const block of msg.content) {
                    if ("type" in block) {
                        if (block.type === "text" && "text" in block) {
                            formatted += block.text + "\n"
                        } else if (block.type === "tool_use" && "name" in block) {
                            formatted += `[Tool: ${block.name}]\n`
                        } else if (block.type === "tool_result") {
                            formatted += `[Tool Result]\n`
                        }
                    }
                }
                formatted += "\n"
            }
        }

        return formatted
    } catch (error) {
        console.error("[cline-execution] Error loading chat history:", error)
        return `Error loading chat history: ${error instanceof Error ? error.message : "Unknown error"}`
    }
}

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