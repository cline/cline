package bot.cline.jetbrains.session

import bot.cline.jetbrains.hub.HubEvent
import bot.cline.jetbrains.hub.arrayOrNull
import bot.cline.jetbrains.hub.booleanOrNull
import bot.cline.jetbrains.hub.doubleOrNull
import bot.cline.jetbrains.hub.longOrNull
import bot.cline.jetbrains.hub.objectOrNull
import bot.cline.jetbrains.hub.stringOrNull
import com.google.gson.JsonArray
import com.google.gson.JsonElement
import com.google.gson.JsonObject
import java.util.concurrent.atomic.AtomicLong

enum class ToolStatus { RUNNING, SUCCEEDED, FAILED }

enum class ApprovalStatus { PENDING, APPROVED, REJECTED }

enum class NoticeLevel { INFO, WARNING, ERROR }

/** One rendered block in the chat transcript. Items are mutated in place while streaming. */
sealed class TranscriptItem {
	abstract val id: String

	class UserMessage(override val id: String, var text: String) : TranscriptItem()

	class AssistantMessage(override val id: String) : TranscriptItem() {
		val text = StringBuilder()
		val reasoning = StringBuilder()
		var reasoningRedacted = false
		var streaming = true
	}

	class ToolCall(
		override val id: String,
		val toolCallId: String,
		var toolName: String,
		var input: JsonElement?,
	) : TranscriptItem() {
		var status = ToolStatus.RUNNING
		var output: JsonElement? = null
		var error: String? = null
		/** Incremental `tool.updated` chunks (stdout/stderr of shell commands, etc.). */
		val stream = StringBuilder()
	}

	class Approval(
		override val id: String,
		val approvalId: String,
		val toolCallId: String?,
		val toolName: String,
		val input: JsonElement?,
		val policy: String?,
	) : TranscriptItem() {
		var status = ApprovalStatus.PENDING
		var reason: String? = null
	}

	class Notice(override val id: String, val text: String, val level: NoticeLevel) : TranscriptItem()
}

data class UsageTotals(
	val inputTokens: Long = 0,
	val outputTokens: Long = 0,
	val cacheReadTokens: Long = 0,
	val cacheWriteTokens: Long = 0,
	val totalCost: Double = 0.0,
) {
	companion object {
		fun from(json: JsonObject?): UsageTotals? {
			json ?: return null
			return UsageTotals(
				inputTokens = json.longOrNull("inputTokens") ?: 0,
				outputTokens = json.longOrNull("outputTokens") ?: 0,
				cacheReadTokens = json.longOrNull("cacheReadTokens") ?: 0,
				cacheWriteTokens = json.longOrNull("cacheWriteTokens") ?: 0,
				totalCost = json.doubleOrNull("totalCost") ?: 0.0,
			)
		}
	}
}

/**
 * Pure reducer that folds hub session events into a renderable transcript.
 * It has no IDE dependencies so it can be unit tested in isolation.
 *
 * Streaming rules mirror the CLI/desktop UIs: `assistant.delta` and
 * `reasoning.delta` grow the open assistant bubble, a tool call closes it
 * (so the next text starts a new bubble), and `assistant.finished` replaces
 * the streamed text with the canonical final text.
 */
class Transcript {
	private val counter = AtomicLong()
	private val _items = mutableListOf<TranscriptItem>()
	val items: List<TranscriptItem> get() = _items

	/** Bumped on every mutation so renderers can cheaply detect staleness. */
	var version: Long = 0
		private set

	var running: Boolean = false
		private set

	var usage: UsageTotals? = null
		private set

	/** Last seen `sessionId` on applied events; informational only. */
	var sessionId: String? = null
		private set

	val pendingApprovals: List<TranscriptItem.Approval>
		get() = _items.filterIsInstance<TranscriptItem.Approval>().filter { it.status == ApprovalStatus.PENDING }

	private fun nextId(prefix: String) = "$prefix-${counter.incrementAndGet()}"

	private fun touch() {
		version++
	}

	fun clear() {
		_items.clear()
		running = false
		usage = null
		touch()
	}

	fun addUserMessage(text: String): TranscriptItem.UserMessage {
		closeOpenAssistant()
		val item = TranscriptItem.UserMessage(nextId("user"), text)
		_items.add(item)
		touch()
		return item
	}

	fun addNotice(text: String, level: NoticeLevel = NoticeLevel.INFO) {
		_items.add(TranscriptItem.Notice(nextId("notice"), text, level))
		touch()
	}

	fun markRunning(value: Boolean) {
		if (running != value) {
			running = value
			if (!value) closeOpenAssistant()
			touch()
		}
	}

	/** Marks a locally-answered approval so the banner disappears before the hub echoes `approval.resolved`. */
	fun resolveApprovalLocally(approvalId: String, approved: Boolean) {
		val approval = _items.filterIsInstance<TranscriptItem.Approval>().lastOrNull { it.approvalId == approvalId } ?: return
		if (approval.status == ApprovalStatus.PENDING) {
			approval.status = if (approved) ApprovalStatus.APPROVED else ApprovalStatus.REJECTED
			touch()
		}
	}

	/** Applies one hub event. Returns `true` when the transcript changed. */
	fun apply(event: HubEvent): Boolean {
		val before = version
		event.sessionId?.let { sessionId = it }
		val p = event.payload
		when (event.event) {
			"run.started" -> {
				running = true
				touch()
			}
			"run.completed" -> {
				usage = UsageTotals.from(p.objectOrNull("result")?.objectOrNull("usage")) ?: usage
				finishTurn()
			}
			"run.failed" -> {
				val message = p.stringOrNull("error") ?: p.stringOrNull("text") ?: "The run failed."
				finishTurn()
				_items.add(TranscriptItem.Notice(nextId("notice"), message, NoticeLevel.ERROR))
				touch()
			}
			"run.aborted" -> {
				finishTurn()
				_items.add(TranscriptItem.Notice(nextId("notice"), "Run cancelled.", NoticeLevel.WARNING))
				touch()
			}
			"agent.done" -> {
				p.objectOrNull("usage")?.let { usage = UsageTotals.from(it) }
				closeOpenAssistant()
			}
			"assistant.delta" -> {
				val text = p.stringOrNull("text") ?: return false
				if (text.isEmpty()) return false
				openAssistant().text.append(text)
				touch()
			}
			"assistant.finished" -> {
				val text = p.stringOrNull("text")
				val assistant = openAssistantOrNull() ?: if (!text.isNullOrEmpty()) openAssistant() else return false
				if (!text.isNullOrEmpty()) {
					assistant.text.setLength(0)
					assistant.text.append(text)
				}
				assistant.streaming = false
				touch()
			}
			"reasoning.delta" -> {
				val assistant = openAssistant()
				if (p.booleanOrNull("redacted") == true) assistant.reasoningRedacted = true
				p.stringOrNull("text")?.let { assistant.reasoning.append(it) }
				touch()
			}
			"reasoning.finished" -> {
				val reasoning = p.stringOrNull("reasoning")
				val assistant = openAssistantOrNull() ?: if (!reasoning.isNullOrEmpty()) openAssistant() else return false
				if (!reasoning.isNullOrEmpty()) {
					assistant.reasoning.setLength(0)
					assistant.reasoning.append(reasoning)
				}
				touch()
			}
			"tool.started" -> {
				closeOpenAssistant()
				val toolCallId = p.stringOrNull("toolCallId") ?: nextId("call")
				val toolName = p.stringOrNull("toolName") ?: "tool"
				val existing = findTool(toolCallId)
				if (existing == null) {
					_items.add(TranscriptItem.ToolCall(nextId("tool"), toolCallId, toolName, p.get("input")))
				} else {
					existing.toolName = toolName
					if (p.has("input")) existing.input = p.get("input")
				}
				touch()
			}
			"tool.updated" -> {
				val tool = findTool(p.stringOrNull("toolCallId") ?: return false) ?: return false
				val update = p.objectOrNull("update")
				val chunk = update?.stringOrNull("chunk")
				if (!chunk.isNullOrEmpty()) {
					tool.stream.append(chunk)
					touch()
				}
			}
			"tool.finished" -> {
				val toolCallId = p.stringOrNull("toolCallId") ?: return false
				val tool = findTool(toolCallId) ?: TranscriptItem.ToolCall(nextId("tool"), toolCallId, p.stringOrNull("toolName") ?: "tool", null).also { _items.add(it) }
				tool.output = p.get("output")?.takeUnless { it.isJsonNull }
				tool.error = p.get("error")?.let { if (it.isJsonPrimitive) it.asString else it.toString() }?.takeIf { it.isNotBlank() }
				tool.status = if (tool.error != null) ToolStatus.FAILED else ToolStatus.SUCCEEDED
				touch()
			}
			"approval.requested" -> {
				closeOpenAssistant()
				val approvalId = p.stringOrNull("approvalId") ?: return false
				if (_items.filterIsInstance<TranscriptItem.Approval>().any { it.approvalId == approvalId }) return false
				_items.add(
					TranscriptItem.Approval(
						id = nextId("approval"),
						approvalId = approvalId,
						toolCallId = p.stringOrNull("toolCallId"),
						toolName = p.stringOrNull("toolName") ?: "tool",
						input = p.get("inputJson") ?: p.get("input"),
						policy = p.stringOrNull("policy"),
					),
				)
				touch()
			}
			"approval.resolved" -> {
				val approvalId = p.stringOrNull("approvalId") ?: return false
				val approval = _items.filterIsInstance<TranscriptItem.Approval>().lastOrNull { it.approvalId == approvalId } ?: return false
				approval.status = if (p.booleanOrNull("approved") == true) ApprovalStatus.APPROVED else ApprovalStatus.REJECTED
				approval.reason = p.stringOrNull("reason")
				touch()
			}
			"usage.updated" -> {
				UsageTotals.from(p.objectOrNull("totals"))?.let {
					usage = it
					touch()
				}
			}
			"session.notice" -> {
				val message = p.stringOrNull("message") ?: return false
				val level = when (p.stringOrNull("noticeType")) {
					"error" -> NoticeLevel.ERROR
					"warning", "warn" -> NoticeLevel.WARNING
					else -> NoticeLevel.INFO
				}
				_items.add(TranscriptItem.Notice(nextId("notice"), message, level))
				touch()
			}
			else -> return false
		}
		return version != before
	}

	/** Replaces the transcript with persisted history from `session.messages`. */
	fun loadHistory(messages: JsonArray?) {
		_items.clear()
		running = false
		val toolNames = mutableMapOf<String, String>()
		messages?.forEach { element ->
			val message = element.takeIf { it.isJsonObject }?.asJsonObject ?: return@forEach
			val role = message.stringOrNull("role")
			val content = message.arrayOrNull("content") ?: JsonArray()
			when (role) {
				"user" -> {
					val text = content.mapNotNull { part -> part.asObjectOrNull()?.takeIf { it.stringOrNull("type") == "text" }?.stringOrNull("text") }
						.joinToString("\n")
						.let(::stripUserInputWrapper)
					if (text.isNotBlank()) _items.add(TranscriptItem.UserMessage(nextId("user"), text))
				}
				"assistant" -> {
					var current: TranscriptItem.AssistantMessage? = null
					for (part in content) {
						val obj = part.asObjectOrNull() ?: continue
						when (obj.stringOrNull("type")) {
							"text" -> {
								val text = obj.stringOrNull("text") ?: continue
								val target = current ?: TranscriptItem.AssistantMessage(nextId("assistant")).also { _items.add(it); current = it }
								target.text.append(text)
							}
							"thinking", "reasoning" -> {
								val thinking = obj.stringOrNull("thinking") ?: obj.stringOrNull("reasoning") ?: obj.stringOrNull("text") ?: continue
								val target = current ?: TranscriptItem.AssistantMessage(nextId("assistant")).also { _items.add(it); current = it }
								target.reasoning.append(thinking)
							}
							"tool-call", "tool_call" -> {
								current?.streaming = false
								current = null
								val toolCallId = obj.stringOrNull("toolCallId") ?: obj.stringOrNull("id") ?: nextId("call")
								val toolName = obj.stringOrNull("toolName") ?: obj.stringOrNull("name") ?: "tool"
								toolNames[toolCallId] = toolName
								_items.add(TranscriptItem.ToolCall(nextId("tool"), toolCallId, toolName, obj.get("input") ?: obj.get("args")))
							}
						}
					}
					current?.streaming = false
				}
				"tool" -> {
					for (part in content) {
						val obj = part.asObjectOrNull() ?: continue
						if (obj.stringOrNull("type") != "tool-result" && obj.stringOrNull("type") != "tool_result") continue
						val toolCallId = obj.stringOrNull("toolCallId") ?: obj.stringOrNull("id") ?: continue
						val tool = findTool(toolCallId)
							?: TranscriptItem.ToolCall(nextId("tool"), toolCallId, toolNames[toolCallId] ?: obj.stringOrNull("toolName") ?: "tool", null).also { _items.add(it) }
						tool.output = obj.get("output") ?: obj.get("result")
						val isError = obj.booleanOrNull("isError") == true
						tool.error = if (isError) (obj.stringOrNull("error") ?: "Tool failed") else null
						tool.status = if (isError) ToolStatus.FAILED else ToolStatus.SUCCEEDED
					}
				}
			}
		}
		// Anything still RUNNING after loading history is a tool whose result was never persisted.
		_items.filterIsInstance<TranscriptItem.ToolCall>().filter { it.status == ToolStatus.RUNNING }.forEach { it.status = ToolStatus.SUCCEEDED }
		touch()
	}

	private fun finishTurn() {
		running = false
		closeOpenAssistant()
		touch()
	}

	private fun findTool(toolCallId: String): TranscriptItem.ToolCall? =
		_items.asReversed().firstOrNull { it is TranscriptItem.ToolCall && it.toolCallId == toolCallId } as TranscriptItem.ToolCall?

	private fun openAssistantOrNull(): TranscriptItem.AssistantMessage? =
		(_items.lastOrNull() as? TranscriptItem.AssistantMessage)?.takeIf { it.streaming }

	private fun openAssistant(): TranscriptItem.AssistantMessage =
		openAssistantOrNull() ?: TranscriptItem.AssistantMessage(nextId("assistant")).also { _items.add(it) }

	private fun closeOpenAssistant() {
		val open = openAssistantOrNull() ?: return
		open.streaming = false
		// Drop bubbles that never received any content (e.g. reasoning-only redacted stubs).
		if (open.text.isEmpty() && open.reasoning.isEmpty() && !open.reasoningRedacted) _items.remove(open)
		touch()
	}

	companion object {
		private val USER_INPUT_WRAPPER = Regex("""^\s*<user_input(?:\s[^>]*)?>([\s\S]*?)</user_input>\s*$""")

		/** The core wraps prompts as `<user_input mode="act">…</user_input>`; show only the inner text. */
		fun stripUserInputWrapper(text: String): String =
			USER_INPUT_WRAPPER.matchEntire(text)?.groupValues?.get(1)?.trim() ?: text.trim()
	}
}

private fun JsonElement.asObjectOrNull(): JsonObject? = takeIf { it.isJsonObject }?.asJsonObject
