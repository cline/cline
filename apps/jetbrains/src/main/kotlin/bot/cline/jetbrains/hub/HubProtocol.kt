package bot.cline.jetbrains.hub

import com.google.gson.Gson
import com.google.gson.GsonBuilder
import com.google.gson.JsonArray
import com.google.gson.JsonElement
import com.google.gson.JsonObject
import com.google.gson.JsonParser

/**
 * Wire-level model of the Cline Hub WebSocket protocol ("v1").
 *
 * Mirrors `HubTransportFrame` / `HubCommandEnvelope` / `HubReplyEnvelope` /
 * `HubEventEnvelope` from `@cline/shared` (`sdk/packages/shared/src/hub.ts`).
 * Payloads stay as dynamic JSON because the hub's command surface is large and
 * the plugin only interprets a small, stable subset of it.
 */
object HubProtocol {
	const val VERSION = "v1"
	const val AUTH_SUBPROTOCOL_PREFIX = "cline-hub-auth."

	/** Client capability that tells the hub this surface can answer tool approvals. */
	const val TOOL_APPROVAL_CAPABILITY = "approval.respond"

	/** Default per-command timeout the hub applies when the envelope carries none. */
	const val DEFAULT_COMMAND_TIMEOUT_MS = 30_000L

	val gson: Gson = GsonBuilder().disableHtmlEscaping().serializeNulls().create()

	/** Commands whose reply only arrives when an agent turn finishes, so they never time out. */
	private val UNBOUNDED_COMMANDS = setOf("run.start", "session.send_input", "plugins.commands.run")

	fun defaultTimeoutMs(command: String): Long? =
		if (command in UNBOUNDED_COMMANDS) null else DEFAULT_COMMAND_TIMEOUT_MS
}

data class HubCommand(
	val command: String,
	val requestId: String,
	val clientId: String,
	val sessionId: String? = null,
	/** `null` means "no timeout" and is serialized as JSON `null`, matching the TS client. */
	val timeoutMs: Long?,
	val payload: JsonObject? = null,
)

data class HubReply(
	val requestId: String?,
	val ok: Boolean,
	val payload: JsonObject?,
	val errorCode: String?,
	val errorMessage: String?,
	val errorDetails: JsonObject?,
) {
	fun errorOrNull(): HubCommandException? =
		if (ok) null else HubCommandException(errorCode, errorMessage ?: "Hub command failed", errorDetails)
}

data class HubEvent(
	val event: String,
	val eventId: String?,
	val sequence: Long?,
	val sessionId: String?,
	val clientId: String?,
	val timestamp: Long?,
	val payload: JsonObject,
)

sealed class HubFrame {
	data class Command(val envelope: HubCommand) : HubFrame()
	data class Reply(val envelope: HubReply) : HubFrame()
	data class Event(val envelope: HubEvent) : HubFrame()
	data class StreamSubscribe(val clientId: String, val sessionId: String?, val sinceSequence: Long?) : HubFrame()
	data class StreamUnsubscribe(val clientId: String, val sessionId: String?) : HubFrame()
	/** A frame kind this client does not understand; kept so callers can log it. */
	data class Unknown(val kind: String?, val raw: JsonObject) : HubFrame()
}

class HubCommandException(
	val code: String?,
	message: String,
	val details: JsonObject? = null,
) : RuntimeException(message)

class HubTransportException(message: String, cause: Throwable? = null) : RuntimeException(message, cause)

object HubFrameCodec {
	fun encode(frame: HubFrame): String {
		val root = JsonObject()
		when (frame) {
			is HubFrame.Command -> {
				root.addProperty("kind", "command")
				val env = JsonObject()
				env.addProperty("version", HubProtocol.VERSION)
				env.addProperty("command", frame.envelope.command)
				env.addProperty("requestId", frame.envelope.requestId)
				env.addProperty("clientId", frame.envelope.clientId)
				frame.envelope.sessionId?.let { env.addProperty("sessionId", it) }
				val timeout = frame.envelope.timeoutMs
				if (timeout == null) env.add("timeoutMs", com.google.gson.JsonNull.INSTANCE) else env.addProperty("timeoutMs", timeout)
				frame.envelope.payload?.let { env.add("payload", it) }
				root.add("envelope", env)
			}
			is HubFrame.StreamSubscribe -> {
				root.addProperty("kind", "stream.subscribe")
				root.addProperty("clientId", frame.clientId)
				frame.sessionId?.let { root.addProperty("sessionId", it) }
				frame.sinceSequence?.let { root.addProperty("sinceSequence", it) }
			}
			is HubFrame.StreamUnsubscribe -> {
				root.addProperty("kind", "stream.unsubscribe")
				root.addProperty("clientId", frame.clientId)
				frame.sessionId?.let { root.addProperty("sessionId", it) }
			}
			is HubFrame.Reply, is HubFrame.Event, is HubFrame.Unknown ->
				throw IllegalArgumentException("Clients do not send ${frame::class.simpleName} frames")
		}
		return HubProtocol.gson.toJson(root)
	}

	fun decode(text: String): HubFrame {
		val root = JsonParser.parseString(text).asJsonObject
		val kind = root.stringOrNull("kind")
		val envelope = root.objectOrNull("envelope")
		return when (kind) {
			"reply" -> HubFrame.Reply(decodeReply(envelope ?: JsonObject()))
			"event" -> HubFrame.Event(decodeEvent(envelope ?: JsonObject()))
			"command" -> HubFrame.Command(
				HubCommand(
					command = envelope?.stringOrNull("command") ?: "",
					requestId = envelope?.stringOrNull("requestId") ?: "",
					clientId = envelope?.stringOrNull("clientId") ?: "",
					sessionId = envelope?.stringOrNull("sessionId"),
					timeoutMs = envelope?.longOrNull("timeoutMs"),
					payload = envelope?.objectOrNull("payload"),
				),
			)
			"stream.subscribe" -> HubFrame.StreamSubscribe(
				root.stringOrNull("clientId") ?: "",
				root.stringOrNull("sessionId"),
				root.longOrNull("sinceSequence"),
			)
			"stream.unsubscribe" -> HubFrame.StreamUnsubscribe(root.stringOrNull("clientId") ?: "", root.stringOrNull("sessionId"))
			else -> HubFrame.Unknown(kind, root)
		}
	}

	private fun decodeReply(env: JsonObject): HubReply {
		val error = env.objectOrNull("error")
		return HubReply(
			requestId = env.stringOrNull("requestId"),
			ok = env.get("ok")?.takeIf { it.isJsonPrimitive }?.asBoolean ?: false,
			payload = env.objectOrNull("payload"),
			errorCode = error?.stringOrNull("code"),
			errorMessage = error?.stringOrNull("message"),
			errorDetails = error?.objectOrNull("details"),
		)
	}

	private fun decodeEvent(env: JsonObject): HubEvent = HubEvent(
		event = env.stringOrNull("event") ?: "",
		eventId = env.stringOrNull("eventId"),
		sequence = env.longOrNull("sequence"),
		sessionId = env.stringOrNull("sessionId"),
		clientId = env.stringOrNull("clientId"),
		timestamp = env.longOrNull("timestamp"),
		payload = env.objectOrNull("payload") ?: JsonObject(),
	)
}

// Small null-safe accessors; Gson throws on type mismatches otherwise.

fun JsonObject.stringOrNull(name: String): String? =
	get(name)?.takeIf { it.isJsonPrimitive && it.asJsonPrimitive.isString }?.asString

fun JsonObject.longOrNull(name: String): Long? =
	get(name)?.takeIf { it.isJsonPrimitive && it.asJsonPrimitive.isNumber }?.asLong

fun JsonObject.doubleOrNull(name: String): Double? =
	get(name)?.takeIf { it.isJsonPrimitive && it.asJsonPrimitive.isNumber }?.asDouble

fun JsonObject.booleanOrNull(name: String): Boolean? =
	get(name)?.takeIf { it.isJsonPrimitive && it.asJsonPrimitive.isBoolean }?.asBoolean

fun JsonObject.objectOrNull(name: String): JsonObject? =
	get(name)?.takeIf { it.isJsonObject }?.asJsonObject

fun JsonObject.arrayOrNull(name: String): JsonArray? =
	get(name)?.takeIf { it.isJsonArray }?.asJsonArray

fun jsonObject(build: JsonObject.() -> Unit): JsonObject = JsonObject().apply(build)

fun JsonObject.putIfNotNull(name: String, value: String?) {
	if (value != null) addProperty(name, value)
}

fun JsonObject.putIfNotNull(name: String, value: Boolean?) {
	if (value != null) addProperty(name, value)
}

fun JsonObject.putIfNotNull(name: String, value: Number?) {
	if (value != null) addProperty(name, value)
}

fun JsonObject.putIfNotNull(name: String, value: JsonElement?) {
	if (value != null) add(name, value)
}

/** Pretty JSON for display; falls back to `toString` for primitives. */
fun JsonElement?.toDisplayString(): String = when {
	this == null || isJsonNull -> ""
	isJsonPrimitive && asJsonPrimitive.isString -> asString
	else -> GsonBuilder().setPrettyPrinting().disableHtmlEscaping().create().toJson(this)
}
