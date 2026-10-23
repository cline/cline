package bot.cline.jetbrains.ui

import bot.cline.jetbrains.hub.toDisplayString
import bot.cline.jetbrains.session.ApprovalStatus
import bot.cline.jetbrains.session.NoticeLevel
import bot.cline.jetbrains.session.ToolStatus
import bot.cline.jetbrains.session.Transcript
import bot.cline.jetbrains.session.TranscriptItem
import com.google.gson.JsonElement
import com.intellij.ui.ColorUtil
import com.intellij.ui.JBColor
import com.intellij.util.ui.UIUtil

/**
 * Turns a [Transcript] into the HTML shown by the chat panel's `JEditorPane`.
 * Swing's HTML support is CSS 1-ish, so the styling is deliberately simple.
 */
class TranscriptRenderer(private val showReasoning: () -> Boolean) {
	private data class Palette(
		val fg: String,
		val muted: String,
		val userBg: String,
		val toolBg: String,
		val border: String,
		val codeBg: String,
		val error: String,
		val warning: String,
		val success: String,
		val link: String,
	)

	private fun palette(): Palette {
		val dark = !JBColor.isBright()
		return Palette(
			fg = ColorUtil.toHtmlColor(UIUtil.getLabelForeground()),
			muted = ColorUtil.toHtmlColor(UIUtil.getLabelDisabledForeground()),
			userBg = if (dark) "#2B3B55" else "#E8F0FE",
			toolBg = if (dark) "#2B2D30" else "#F4F5F7",
			border = if (dark) "#43454A" else "#D3D5DB",
			codeBg = if (dark) "#1E1F22" else "#F1F2F4",
			error = if (dark) "#F2635E" else "#C7222A",
			warning = if (dark) "#E4B043" else "#9C6A00",
			success = if (dark) "#5FB865" else "#2E7D32",
			link = ColorUtil.toHtmlColor(JBColor.namedColor("Link.activeForeground", JBColor(0x2470B3, 0x589DF6))),
		)
	}

	fun render(transcript: Transcript, emptyMessage: String): String {
		val p = palette()
		val sb = StringBuilder()
		sb.append("<html><head><style>")
		sb.append("body { font-family: sans-serif; color: ${p.fg}; margin: 8px; }")
		sb.append("pre { background-color: ${p.codeBg}; border: 1px solid ${p.border}; padding: 6px; font-family: monospace; }")
		sb.append("code { font-family: monospace; background-color: ${p.codeBg}; }")
		sb.append(".user { background-color: ${p.userBg}; padding: 6px 8px; margin: 6px 0; }")
		sb.append(".assistant { padding: 4px 2px; margin: 6px 0; }")
		sb.append(".tool { background-color: ${p.toolBg}; border: 1px solid ${p.border}; padding: 6px 8px; margin: 6px 0; }")
		sb.append(".approval { border: 1px solid ${p.warning}; padding: 6px 8px; margin: 6px 0; }")
		sb.append(".notice { padding: 4px 8px; margin: 6px 0; }")
		sb.append(".muted { color: ${p.muted}; }")
		sb.append(".label { font-size: 90%; color: ${p.muted}; }")
		sb.append("a { color: ${p.link}; }")
		sb.append("</style></head><body>")
		if (transcript.items.isEmpty()) {
			sb.append("<p class=\"muted\">").append(escape(emptyMessage)).append("</p>")
		}
		for (item in transcript.items) {
			when (item) {
				is TranscriptItem.UserMessage -> {
					sb.append("<div class=\"user\"><div class=\"label\">You</div>")
					sb.append(markdownToHtml(item.text))
					sb.append("</div>")
				}
				is TranscriptItem.AssistantMessage -> {
					sb.append("<div class=\"assistant\"><div class=\"label\">Cline</div>")
					if (showReasoning() && (item.reasoning.isNotEmpty() || item.reasoningRedacted)) {
						val reasoning = if (item.reasoning.isEmpty()) "(reasoning redacted by the provider)" else item.reasoning.toString()
						sb.append("<div class=\"muted\"><i>")
						sb.append(escape(reasoning.trim()).replace("\n", "<br>"))
						sb.append("</i></div>")
					}
					if (item.text.isNotEmpty()) sb.append(markdownToHtml(item.text.toString()))
					if (item.streaming && item.text.isEmpty()) sb.append("<span class=\"muted\">&#8230;</span>")
					sb.append("</div>")
				}
				is TranscriptItem.ToolCall -> {
					val (icon, color) = when (item.status) {
						ToolStatus.RUNNING -> "&#9203;" to p.muted
						ToolStatus.SUCCEEDED -> "&#10003;" to p.success
						ToolStatus.FAILED -> "&#10007;" to p.error
					}
					sb.append("<div class=\"tool\">")
					sb.append("<span style=\"color: $color\">$icon</span> <b>").append(escape(item.toolName)).append("</b>")
					summarizeInput(item.toolName, item.input)?.let { sb.append(" <code>").append(escape(it)).append("</code>") }
					val streamed = item.stream.toString()
					if (streamed.isNotBlank()) {
						sb.append("<pre>").append(escape(truncate(streamed, 4000))).append("</pre>")
					} else if (item.status != ToolStatus.RUNNING && item.output != null) {
						val outputText = summarizeOutput(item.output)
						if (outputText.isNotBlank()) sb.append("<pre>").append(escape(truncate(outputText, 4000))).append("</pre>")
					}
					item.error?.let { sb.append("<div style=\"color: ${p.error}\">").append(escape(it)).append("</div>") }
					sb.append("</div>")
				}
				is TranscriptItem.Approval -> {
					sb.append("<div class=\"approval\">")
					val status = when (item.status) {
						ApprovalStatus.PENDING -> "<span style=\"color: ${p.warning}\">&#9888; Approval required</span>"
						ApprovalStatus.APPROVED -> "<span style=\"color: ${p.success}\">&#10003; Approved</span>"
						ApprovalStatus.REJECTED -> "<span style=\"color: ${p.error}\">&#10007; Rejected</span>"
					}
					sb.append(status).append(" &mdash; <b>").append(escape(item.toolName)).append("</b>")
					item.input?.let {
						sb.append("<pre>").append(escape(truncate(it.toDisplayString(), 2000))).append("</pre>")
					}
					item.reason?.takeIf { it.isNotBlank() }?.let { sb.append("<div class=\"muted\">").append(escape(it)).append("</div>") }
					sb.append("</div>")
				}
				is TranscriptItem.Notice -> {
					val color = when (item.level) {
						NoticeLevel.INFO -> p.muted
						NoticeLevel.WARNING -> p.warning
						NoticeLevel.ERROR -> p.error
					}
					sb.append("<div class=\"notice\" style=\"color: $color\">").append(escape(item.text).replace("\n", "<br>")).append("</div>")
				}
			}
		}
		sb.append("</body></html>")
		return sb.toString()
	}

	companion object {
		private val FENCE = Regex("```[^\\n]*\\n([\\s\\S]*?)```")

		fun escape(text: String): String = buildString(text.length + 16) {
			for (ch in text) {
				when (ch) {
					'&' -> append("&amp;")
					'<' -> append("&lt;")
					'>' -> append("&gt;")
					'"' -> append("&quot;")
					else -> append(ch)
				}
			}
		}

		fun truncate(text: String, max: Int): String =
			if (text.length <= max) text else text.substring(0, max) + "\n… (${text.length - max} more characters)"

		/** Tiny markdown subset: fenced code, inline code, bold, headings, bullet lines, paragraphs. */
		fun markdownToHtml(markdown: String): String {
			val out = StringBuilder()
			var last = 0
			for (match in FENCE.findAll(markdown)) {
				out.append(inlineToHtml(markdown.substring(last, match.range.first)))
				out.append("<pre>").append(escape(match.groupValues[1].trimEnd('\n'))).append("</pre>")
				last = match.range.last + 1
			}
			val tail = markdown.substring(last)
			// An unterminated fence while streaming: render what we have as code.
			val openFence = tail.indexOf("```")
			if (openFence >= 0) {
				out.append(inlineToHtml(tail.substring(0, openFence)))
				val code = tail.substring(openFence + 3).substringAfter('\n', "")
				out.append("<pre>").append(escape(code)).append("</pre>")
			} else {
				out.append(inlineToHtml(tail))
			}
			return out.toString()
		}

		private val INLINE_CODE = Regex("`([^`\\n]+)`")
		private val BOLD = Regex("\\*\\*([^*\\n]+)\\*\\*")
		private val HEADING = Regex("^(#{1,6})\\s+(.*)$")
		private val BULLET = Regex("^\\s*[-*]\\s+(.*)$")

		private fun inlineToHtml(text: String): String {
			if (text.isBlank()) return ""
			val lines = text.trim('\n').split('\n')
			val out = StringBuilder()
			var inList = false
			for (line in lines) {
				val bullet = BULLET.matchEntire(line)
				if (bullet != null) {
					if (!inList) { out.append("<ul>"); inList = true }
					out.append("<li>").append(inlineSpans(bullet.groupValues[1])).append("</li>")
					continue
				}
				if (inList) { out.append("</ul>"); inList = false }
				val heading = HEADING.matchEntire(line)
				if (heading != null) {
					out.append("<b>").append(inlineSpans(heading.groupValues[2])).append("</b><br>")
					continue
				}
				if (line.isBlank()) {
					out.append("<br>")
					continue
				}
				out.append(inlineSpans(line)).append("<br>")
			}
			if (inList) out.append("</ul>")
			return out.toString()
		}

		private fun inlineSpans(line: String): String {
			var html = escape(line)
			html = INLINE_CODE.replace(html) { "<code>${it.groupValues[1]}</code>" }
			html = BOLD.replace(html) { "<b>${it.groupValues[1]}</b>" }
			return html
		}

		/** One-line gist of a tool's input: the command, the path, the query… */
		fun summarizeInput(toolName: String, input: JsonElement?): String? {
			val obj = input?.takeIf { it.isJsonObject }?.asJsonObject ?: return input?.takeIf { it.isJsonPrimitive }?.asString
			for (key in listOf("path", "file_path", "filePath", "command", "query", "pattern", "url", "description")) {
				obj.get(key)?.takeIf { it.isJsonPrimitive }?.asString?.let { return it.lineSequence().first().take(120) }
			}
			obj.get("commands")?.takeIf { it.isJsonArray }?.asJsonArray?.let { arr ->
				return arr.mapNotNull { it.takeIf { e -> e.isJsonPrimitive }?.asString }.joinToString(" && ").take(120)
			}
			return null
		}

		fun summarizeOutput(output: JsonElement?): String {
			output ?: return ""
			if (output.isJsonPrimitive) return output.asString
			if (output.isJsonArray) {
				val arr = output.asJsonArray
				val results = arr.mapNotNull { el ->
					el.takeIf { it.isJsonObject }?.asJsonObject?.let { o ->
						o.get("result")?.takeIf { it.isJsonPrimitive }?.asString ?: o.get("output")?.takeIf { it.isJsonPrimitive }?.asString
					}
				}
				if (results.size == arr.size() && results.isNotEmpty()) return results.joinToString("\n")
			}
			if (output.isJsonObject) {
				val o = output.asJsonObject
				for (key in listOf("content", "result", "output", "text", "message")) {
					o.get(key)?.takeIf { it.isJsonPrimitive }?.asString?.let { return it }
				}
			}
			return output.toDisplayString()
		}
	}
}
