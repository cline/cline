import { ResponseInput, ResponseInputMessageContentList, ResponseReasoningItem } from "openai/resources/responses/responses"
import { ClineStorageMessage } from "@/shared/messages/content"

/**
 * Converts an array of ClineStorageMessage objects (extension of Anthropic format) to a ResponseInput array to use with OpenAI's Responses API.
 *
 * ## Key Differences from Chat Completions API
 *
 * The Responses API has stricter requirements than the Chat Completions API:
 *
 * ### Chat Completions API:
 * - Messages are simple role/content pairs
 * - System prompts are separate messages with role="system"
 * - No explicit reasoning item structure
 * - More forgiving about message ordering
 *
 * ### Responses API:
 * - Uses an "input" array of heterogeneous items (messages, reasoning, function_calls, etc.)
 * - System prompts go in an "instructions" field, not as messages
 * - Reasoning items MUST be immediately followed by a message or function_call
 * - Strict ordering requirements match training data distribution
 *
 * ## The Reasoning Item Constraint
 *
 * **THE CRITICAL ERROR:** "Item 'rs_...' of type 'reasoning' was provided without its required following item"
 *
 * This error occurs when reasoning items are orphaned or separated from their corresponding output.
 *
 * ### What Causes This Error:
 * ```
 * ❌ WRONG - Reasoning orphaned between turns:
 * [
 *   { role: "user", content: [...] },
 *   { type: "reasoning", id: "rs_abc", summary: [...] },  // ← ORPHANED!
 *   { type: "message", role: "assistant", content: [...] },
 *   { role: "user", content: [...] }
 * ]
 * ```
 *
 * ### The Fix - Keep Complete Assistant Turns Together:
 * ```
 * ✅ CORRECT - Reasoning paired with its message:
 * [
 *   { role: "user", content: [...] },
 *   { type: "reasoning", id: "rs_abc", summary: [...] },
 *   { type: "message", role: "assistant", content: [...] },  // ← Immediately follows reasoning
 *   { role: "user", content: [...] }
 * ]
 * ```
 *
 * **Per OpenAI Engineering Guidance:**
 * - ❌ WRONG: `content += filter(lambda x: x.type == "reasoning", resp.output)`
 * - ✅ CORRECT: `content += resp.output`
 *
 * Never extract only reasoning items - always include the complete output sequence
 * (reasoning + message/function_call) as provided by the API.
 *
 * ## Implementation Strategy
 *
 * 1. **Separate processing for assistant vs user messages** - Assistant turns need special
 *    handling to maintain reasoning-message pairing
 * 2. **Collect all assistant items together** - Gather reasoning, messages, and function_calls
 *    for the entire assistant turn before validating
 * 3. **Validate pairing within each turn** - Ensure each reasoning item is immediately followed
 *    by a message or function_call, inserting placeholders if needed
 * 4. **Flush complete turns atomically** - Add all items from an assistant turn together to
 *    maintain proper sequencing
 *
 * @link https://community.openai.com/t/openai-api-error-function-call-was-provided-without-its-required-reasoning-item-the-real-issue/1355347
 *
 * @param messages - Array of ClineStorageMessage objects to be converted
 * @returns ResponseInput array containing the transformed messages with proper reasoning pairing
 */
export function convertToOpenAIResponsesInput(messages: ClineStorageMessage[]): ResponseInput {
	const allItems: any[] = []
	const toolUseIdToCallId = new Map<string, string>()

	for (const m of messages) {
		if (typeof m.content === "string") {
			allItems.push({ role: m.role, content: [{ type: "input_text", text: m.content }] })
			continue
		}

		if (m.role === "assistant") {
			// For assistant messages, we must ensure reasoning items are IMMEDIATELY followed
			// by their corresponding message or function_call. Process the entire assistant
			// turn and ensure proper pairing.
			const assistantItems: any[] = []

			for (const part of m.content) {
				switch (part.type) {
					case "thinking":
						// Include reasoning item if it has a call_id, even if thinking is empty
						// This is required because the API expects reasoning items to be paired with
						// their corresponding function_calls, and will error if a function_call
						// references a reasoning item that wasn't sent
						if (part.call_id && part.call_id.length > 0) {
							assistantItems.push({
								id: part.call_id,
								type: "reasoning",
								summary: part.thinking
									? [
											{
												type: "summary_text",
												text: part.thinking,
											},
										]
									: [],
							} as ResponseReasoningItem)
						}
						break
					case "redacted_thinking":
						// Include reasoning item with encrypted content if it has a call_id
						// Even if data is missing, we need to maintain the reasoning-function_call pairing
						if (part.call_id && part.call_id.length > 0) {
							const reasoningItem: any = {
								id: part.call_id,
								type: "reasoning",
								summary: [],
							}
							// Only include encrypted_content if data exists
							if (part.data) {
								reasoningItem.encrypted_content = part.data
							}
							assistantItems.push(reasoningItem as ResponseReasoningItem)
						}
						break
					case "text":
						assistantItems.push({
							type: "message",
							role: "assistant",
							content: [{ type: "output_text", text: part.text }],
						})
						break
					case "image":
						assistantItems.push({
							type: "message",
							role: "assistant",
							content: [{ type: "output_text", text: `[image:${part.source.media_type}]` }],
						})
						break
					case "tool_use": {
						const call_id = part.call_id || part.id
						if (part.call_id) {
							toolUseIdToCallId.set(part.id, part.call_id)
						}
						assistantItems.push({
							type: "function_call",
							call_id,
							id: part.id,
							name: part.name,
							arguments: JSON.stringify(part.input ?? {}),
						})
						break
					}
				}
			}

			// Ensure every reasoning item is followed by a message or function_call
			for (let i = 0; i < assistantItems.length; i++) {
				const item = assistantItems[i]
				if (item.type === "reasoning") {
					const nextItem = assistantItems[i + 1]
					if (!nextItem || (nextItem.type !== "message" && nextItem.type !== "function_call")) {
						// Insert a placeholder message immediately after this reasoning item
						assistantItems.splice(i + 1, 0, {
							type: "message",
							role: "assistant",
							content: [{ type: "output_text", text: "" }],
						})
					}
				}
			}

			allItems.push(...assistantItems)
		} else {
			// User messages - collect all content
			const messageContent: ResponseInputMessageContentList = []

			for (const part of m.content) {
				switch (part.type) {
					case "text":
						messageContent.push({ type: "input_text", text: part.text })
						break
					case "image":
						messageContent.push({
							type: "input_image",
							detail: "auto",
							image_url: `data:${part.source.media_type};base64,${part.source.data}`,
						})
						break
					case "tool_result": {
						// Flush any pending message content before adding tool result
						if (messageContent.length > 0) {
							allItems.push({ role: m.role, content: [...messageContent] })
							messageContent.length = 0
						}
						const call_id = part.call_id || toolUseIdToCallId.get(part.tool_use_id) || part.tool_use_id
						allItems.push({
							type: "function_call_output",
							call_id,
							output: typeof part.content === "string" ? part.content : JSON.stringify(part.content),
						})
						break
					}
				}
			}

			// Flush any remaining user message content
			if (messageContent.length > 0) {
				allItems.push({ role: m.role, content: [...messageContent] })
			}
		}
	}

	return allItems
}
