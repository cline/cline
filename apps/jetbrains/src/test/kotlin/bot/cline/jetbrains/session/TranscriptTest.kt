package bot.cline.jetbrains.session

import bot.cline.jetbrains.hub.HubEvent
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class TranscriptTest {
	private var seq = 0L

	private fun event(name: String, payloadJson: String, sessionId: String = "s1"): HubEvent =
		HubEvent(name, "hevt_${seq}", seq++, sessionId, null, System.currentTimeMillis(), JsonParser.parseString(payloadJson).asJsonObject)

	private fun event(name: String, payload: JsonObject = JsonObject(), sessionId: String = "s1"): HubEvent =
		HubEvent(name, "hevt_${seq}", seq++, sessionId, null, System.currentTimeMillis(), payload)

	@Test
	fun `streams assistant text and finalizes with canonical text`() {
		val t = Transcript()
		t.addUserMessage("Reply with pong")
		assertTrue(t.apply(event("run.started")))
		assertTrue(t.running)
		assertTrue(t.apply(event("assistant.delta", """{"text":"po"}""")))
		assertTrue(t.apply(event("assistant.delta", """{"text":"ng"}""")))
		val assistant = t.items.last() as TranscriptItem.AssistantMessage
		assertEquals("pong", assistant.text.toString())
		assertTrue(assistant.streaming)
		assertTrue(t.apply(event("assistant.finished", """{"text":"pong!"}""")))
		assertEquals("pong!", assistant.text.toString())
		assertFalse(assistant.streaming)
		assertTrue(t.apply(event("run.completed", """{"reason":"completed","result":{"text":"pong!","usage":{"inputTokens":10,"outputTokens":2,"totalCost":0.5}}}""")))
		assertFalse(t.running)
		assertEquals(10L, t.usage?.inputTokens)
		assertEquals(0.5, t.usage?.totalCost ?: 0.0, 1e-9)
		assertEquals(2, t.items.size)
	}

	@Test
	fun `reasoning deltas attach to the assistant bubble`() {
		val t = Transcript()
		t.apply(event("run.started"))
		t.apply(event("reasoning.delta", """{"text":"think","redacted":false}"""))
		t.apply(event("reasoning.delta", """{"text":"ing","redacted":false}"""))
		t.apply(event("assistant.delta", """{"text":"answer"}"""))
		val assistant = t.items.single() as TranscriptItem.AssistantMessage
		assertEquals("thinking", assistant.reasoning.toString())
		assertEquals("answer", assistant.text.toString())
		t.apply(event("reasoning.finished", """{"reasoning":"thinking harder"}"""))
		assertEquals("thinking harder", assistant.reasoning.toString())
	}

	@Test
	fun `tool calls split assistant bubbles and collect streamed output`() {
		val t = Transcript()
		t.apply(event("run.started"))
		t.apply(event("assistant.delta", """{"text":"Let me look."}"""))
		t.apply(event("tool.started", """{"toolCallId":"call_0","toolName":"run_commands","input":{"commands":["cat hello.txt"]}}"""))
		t.apply(event("tool.updated", """{"toolCallId":"call_0","toolName":"run_commands","update":{"stream":"stdout","chunk":"hello from probe\n"}}"""))
		t.apply(event("tool.finished", """{"toolCallId":"call_0","toolName":"run_commands","output":[{"query":"cat hello.txt","result":"hello from probe\n","success":true}]}"""))
		t.apply(event("assistant.delta", """{"text":"It says hello."}"""))
		t.apply(event("agent.done", """{"reason":"completed","text":"It says hello."}"""))

		assertEquals(3, t.items.size)
		val first = t.items[0] as TranscriptItem.AssistantMessage
		assertFalse(first.streaming)
		assertEquals("Let me look.", first.text.toString())
		val tool = t.items[1] as TranscriptItem.ToolCall
		assertEquals("run_commands", tool.toolName)
		assertEquals(ToolStatus.SUCCEEDED, tool.status)
		assertEquals("hello from probe\n", tool.stream.toString())
		assertNotNull(tool.output)
		assertNull(tool.error)
		val second = t.items[2] as TranscriptItem.AssistantMessage
		assertEquals("It says hello.", second.text.toString())
		assertFalse(second.streaming)
	}

	@Test
	fun `failed tools carry the error`() {
		val t = Transcript()
		t.apply(event("tool.started", """{"toolCallId":"c1","toolName":"read_file","input":{"path":"missing.txt"}}"""))
		t.apply(event("tool.finished", """{"toolCallId":"c1","toolName":"read_file","error":"ENOENT"}"""))
		val tool = t.items.single() as TranscriptItem.ToolCall
		assertEquals(ToolStatus.FAILED, tool.status)
		assertEquals("ENOENT", tool.error)
	}

	@Test
	fun `approvals are tracked pending then resolved and deduplicated`() {
		val t = Transcript()
		val requested = """{"approvalId":"ap1","sessionId":"s1","toolCallId":"c1","toolName":"write_to_file","inputJson":{"path":"a.txt"},"policy":"ask"}"""
		assertTrue(t.apply(event("approval.requested", requested)))
		assertFalse("re-issued pending approvals must not duplicate", t.apply(event("approval.requested", requested)))
		assertEquals(1, t.pendingApprovals.size)
		assertEquals("write_to_file", t.pendingApprovals.single().toolName)

		t.resolveApprovalLocally("ap1", approved = true)
		assertTrue(t.pendingApprovals.isEmpty())
		t.apply(event("approval.resolved", """{"approvalId":"ap1","approved":true}"""))
		assertEquals(ApprovalStatus.APPROVED, (t.items.single() as TranscriptItem.Approval).status)
	}

	@Test
	fun `run failure and abort add notices and stop running`() {
		val t = Transcript()
		t.apply(event("run.started"))
		t.apply(event("run.failed", """{"reason":"error","error":"Unauthorized"}"""))
		assertFalse(t.running)
		val notice = t.items.last() as TranscriptItem.Notice
		assertEquals(NoticeLevel.ERROR, notice.level)
		assertEquals("Unauthorized", notice.text)

		t.apply(event("run.started"))
		t.apply(event("run.aborted", """{"reason":"aborted"}"""))
		assertFalse(t.running)
		assertEquals(NoticeLevel.WARNING, (t.items.last() as TranscriptItem.Notice).level)
	}

	@Test
	fun `usage updates and notices`() {
		val t = Transcript()
		t.apply(event("usage.updated", """{"delta":{},"totals":{"inputTokens":5,"outputTokens":7,"totalCost":0.01}}"""))
		assertEquals(7L, t.usage?.outputTokens)
		t.apply(event("session.notice", """{"message":"Context compacted","noticeType":"info"}"""))
		assertEquals("Context compacted", (t.items.single() as TranscriptItem.Notice).text)
	}

	@Test
	fun `unknown and empty events are ignored`() {
		val t = Transcript()
		assertFalse(t.apply(event("iteration.started", """{"iteration":1}""")))
		assertFalse(t.apply(event("assistant.delta", """{"text":""}""")))
		assertFalse(t.apply(event("tool.updated", """{"toolCallId":"nope","update":{"chunk":"x"}}""")))
		assertTrue(t.items.isEmpty())
	}

	@Test
	fun `loads persisted history stripping the user_input wrapper`() {
		val t = Transcript()
		val messages = JsonParser.parseString(
			"""[
			{"id":"u1","role":"user","content":[{"type":"text","text":"<user_input mode=\"act\">Run cat hello.txt</user_input>"}],"ts":1},
			{"id":"a1","role":"assistant","content":[
				{"type":"thinking","thinking":"I should run it."},
				{"type":"text","text":"Running."},
				{"type":"tool-call","toolCallId":"call_0","toolName":"run_commands","input":{"commands":["cat hello.txt"]}}
			],"ts":2},
			{"id":"t1","role":"tool","content":[{"type":"tool-result","toolCallId":"call_0","output":[{"result":"hello\n","success":true}]}],"ts":3},
			{"id":"a2","role":"assistant","content":[{"type":"text","text":"It prints hello."}],"ts":4}
			]""",
		).asJsonArray
		t.loadHistory(messages)
		assertEquals(4, t.items.size)
		assertEquals("Run cat hello.txt", (t.items[0] as TranscriptItem.UserMessage).text)
		val a1 = t.items[1] as TranscriptItem.AssistantMessage
		assertEquals("I should run it.", a1.reasoning.toString())
		assertEquals("Running.", a1.text.toString())
		assertFalse(a1.streaming)
		val tool = t.items[2] as TranscriptItem.ToolCall
		assertEquals("run_commands", tool.toolName)
		assertEquals(ToolStatus.SUCCEEDED, tool.status)
		assertEquals("It prints hello.", (t.items[3] as TranscriptItem.AssistantMessage).text.toString())
		assertFalse(t.running)
	}

	@Test
	fun `stripUserInputWrapper handles plain text`() {
		assertEquals("hello", Transcript.stripUserInputWrapper("<user_input mode=\"plan\">hello</user_input>"))
		assertEquals("hello", Transcript.stripUserInputWrapper("  hello "))
		assertEquals("a\nb", Transcript.stripUserInputWrapper("<user_input>a\nb</user_input>"))
	}
}
