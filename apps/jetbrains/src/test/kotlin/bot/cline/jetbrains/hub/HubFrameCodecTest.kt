package bot.cline.jetbrains.hub

import com.google.gson.JsonParser
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class HubFrameCodecTest {
	@Test
	fun `encodes command envelope with explicit null timeout`() {
		val frame = HubFrame.Command(
			HubCommand(
				command = "session.send_input",
				requestId = "req-1",
				clientId = "jb-1",
				sessionId = "sess-1",
				timeoutMs = null,
				payload = jsonObject { addProperty("prompt", "hi") },
			),
		)
		val json = JsonParser.parseString(HubFrameCodec.encode(frame)).asJsonObject
		assertEquals("command", json.get("kind").asString)
		val env = json.getAsJsonObject("envelope")
		assertEquals("v1", env.get("version").asString)
		assertEquals("session.send_input", env.get("command").asString)
		assertEquals("req-1", env.get("requestId").asString)
		assertEquals("jb-1", env.get("clientId").asString)
		assertEquals("sess-1", env.get("sessionId").asString)
		assertTrue("timeoutMs must be serialized as JSON null so the hub does not apply its default", env.get("timeoutMs").isJsonNull)
		assertEquals("hi", env.getAsJsonObject("payload").get("prompt").asString)
	}

	@Test
	fun `encodes numeric timeout and omits absent optional fields`() {
		val frame = HubFrame.Command(HubCommand("client.register", "req-2", "jb-1", timeoutMs = 30_000))
		val env = JsonParser.parseString(HubFrameCodec.encode(frame)).asJsonObject.getAsJsonObject("envelope")
		assertEquals(30_000L, env.get("timeoutMs").asLong)
		assertFalse(env.has("sessionId"))
		assertFalse(env.has("payload"))
	}

	@Test
	fun `encodes stream subscribe with sinceSequence`() {
		val json = JsonParser.parseString(HubFrameCodec.encode(HubFrame.StreamSubscribe("jb-1", null, 42))).asJsonObject
		assertEquals("stream.subscribe", json.get("kind").asString)
		assertEquals("jb-1", json.get("clientId").asString)
		assertEquals(42L, json.get("sinceSequence").asLong)
		assertFalse(json.has("sessionId"))
	}

	@Test
	fun `decodes ok reply`() {
		val frame = HubFrameCodec.decode("""{"kind":"reply","envelope":{"version":"v1","requestId":"r1","ok":true,"payload":{"clientId":"jb-1"}}}""")
		val reply = (frame as HubFrame.Reply).envelope
		assertTrue(reply.ok)
		assertEquals("r1", reply.requestId)
		assertEquals("jb-1", reply.payload?.stringOrNull("clientId"))
		assertNull(reply.errorOrNull())
	}

	@Test
	fun `decodes error reply into exception`() {
		val frame = HubFrameCodec.decode(
			"""{"kind":"reply","envelope":{"version":"v1","requestId":"r2","ok":false,"error":{"code":"session_not_found","message":"Unknown session: x","details":{"sessionId":"x"}}}}""",
		)
		val error = (frame as HubFrame.Reply).envelope.errorOrNull()
		assertNotNull(error)
		assertEquals("session_not_found", error!!.code)
		assertEquals("Unknown session: x", error.message)
		assertEquals("x", error.details?.stringOrNull("sessionId"))
	}

	@Test
	fun `decodes event with sequence`() {
		val frame = HubFrameCodec.decode(
			"""{"kind":"event","envelope":{"version":"v1","event":"assistant.delta","eventId":"hevt_1","sessionId":"s1","timestamp":1792727809299,"payload":{"text":"pon"},"sequence":98}}""",
		)
		val event = (frame as HubFrame.Event).envelope
		assertEquals("assistant.delta", event.event)
		assertEquals("s1", event.sessionId)
		assertEquals(98L, event.sequence)
		assertEquals("pon", event.payload.stringOrNull("text"))
	}

	@Test
	fun `unknown kinds are preserved not thrown`() {
		val frame = HubFrameCodec.decode("""{"kind":"something.new","foo":1}""")
		assertTrue(frame is HubFrame.Unknown)
		assertEquals("something.new", (frame as HubFrame.Unknown).kind)
	}

	@Test
	fun `default timeouts are unbounded only for turn commands`() {
		assertNull(HubProtocol.defaultTimeoutMs("session.send_input"))
		assertNull(HubProtocol.defaultTimeoutMs("run.start"))
		assertEquals(HubProtocol.DEFAULT_COMMAND_TIMEOUT_MS, HubProtocol.defaultTimeoutMs("session.create"))
	}
}
