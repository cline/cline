package bot.cline.jetbrains.hub

import com.google.gson.JsonArray
import com.google.gson.JsonObject
import java.net.URI
import java.net.http.HttpClient
import java.net.http.WebSocket
import java.time.Duration
import java.util.concurrent.CompletableFuture
import java.util.concurrent.CompletionStage
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.atomic.AtomicReference

data class HubClientOptions(
	val url: String,
	val authToken: String?,
	val clientId: String = "jetbrains-" + java.lang.Long.toString(System.nanoTime(), 36),
	val clientType: String = "jetbrains",
	val displayName: String = "JetBrains IDE",
	val clientVersion: String = "0.0.0",
	val workspaceRoot: String? = null,
	val cwd: String? = null,
	val capabilities: List<String> = listOf(HubProtocol.TOOL_APPROVAL_CAPABILITY),
	val metadata: Map<String, String> = emptyMap(),
	val connectTimeout: Duration = Duration.ofSeconds(8),
	val autoReconnect: Boolean = true,
)

enum class HubConnectionState { DISCONNECTED, CONNECTING, CONNECTED }

interface HubClientListener {
	fun onEvent(event: HubEvent) {}
	fun onConnectionStateChanged(state: HubConnectionState, error: Throwable?) {}
}

/**
 * Minimal, dependency-free Cline Hub client on top of the JDK's
 * `java.net.http.WebSocket`.
 *
 * Behaviorally it follows `NodeHubClient` (`sdk/packages/core/src/hub/client/index.ts`):
 * auth via the `cline-hub-auth.<token>` subprotocol, a `client.register` command right
 * after the socket opens, `stream.subscribe` for the event feed, request/reply
 * correlation by `requestId`, and exponential-backoff reconnects that resume the
 * event stream from the last seen `sequence`.
 */
class HubClient(
	val options: HubClientOptions,
	private val scheduler: ScheduledExecutorService = sharedScheduler,
) : AutoCloseable {
	companion object {
		private val sharedScheduler: ScheduledExecutorService = Executors.newSingleThreadScheduledExecutor { runnable ->
			Thread(runnable, "cline-hub-client").apply { isDaemon = true }
		}
		private const val RECONNECT_INITIAL_MS = 250L
		private const val RECONNECT_MAX_MS = 5_000L
	}

	private class Pending(val command: String, val future: CompletableFuture<HubReply>, var timeout: ScheduledFuture<*>?)

	private val http: HttpClient = HttpClient.newBuilder()
		.connectTimeout(options.connectTimeout)
		.proxy(java.net.ProxySelector.of(null))
		.build()

	private val socket = AtomicReference<WebSocket?>()
	private val pending = ConcurrentHashMap<String, Pending>()
	private val listeners = CopyOnWriteArrayList<HubClientListener>()
	private val requestCounter = AtomicLong()
	private val lastEventSequence = AtomicLong(-1)
	private val closedByClient = AtomicBoolean(false)
	private val generation = AtomicLong()
	private var reconnectAttempt = 0
	private var reconnectTask: ScheduledFuture<*>? = null
	@Volatile private var connectFuture: CompletableFuture<Void>? = null
	@Volatile var state: HubConnectionState = HubConnectionState.DISCONNECTED
		private set
	@Volatile var lastError: Throwable? = null
		private set

	val clientId: String get() = options.clientId
	val isConnected: Boolean get() = state == HubConnectionState.CONNECTED && socket.get()?.isOutputClosed == false

	fun addListener(listener: HubClientListener): () -> Unit {
		listeners.add(listener)
		return { listeners.remove(listener) }
	}

	/** Opens the socket, registers this client and subscribes to the global event stream. */
	@Synchronized
	fun connect(): CompletableFuture<Void> {
		connectFuture?.let { if (!it.isDone) return it }
		if (isConnected) return CompletableFuture.completedFuture(null)
		closedByClient.set(false)
		reconnectTask?.cancel(false)
		reconnectTask = null
		val myGeneration = generation.incrementAndGet()
		setState(HubConnectionState.CONNECTING, null)

		val uri = URI.create(normalizeWsUrl(options.url))
		val builder = http.newWebSocketBuilder().connectTimeout(options.connectTimeout)
		options.authToken?.takeIf { it.isNotBlank() }?.let { builder.subprotocols(HubProtocol.AUTH_SUBPROTOCOL_PREFIX + it) }

		val future = builder.buildAsync(uri, SocketListener(myGeneration))
			.exceptionally { error -> throw HubTransportException("Failed to connect to hub at ${options.url}: ${rootMessage(error)}", error) }
			.thenCompose { ws ->
				socket.set(ws)
				register()
			}
			.thenAccept {
				if (myGeneration != generation.get() || closedByClient.get()) throw HubTransportException("Hub connection superseded")
				reconnectAttempt = 0
				setState(HubConnectionState.CONNECTED, null)
				sendSubscribe()
			}
			.whenComplete { _, error ->
				if (error != null) {
					lastError = unwrap(error)
					socket.getAndSet(null)?.abort()
					setState(HubConnectionState.DISCONNECTED, lastError)
					if (options.autoReconnect && !closedByClient.get()) scheduleReconnect()
				}
			}
		connectFuture = future
		return future
	}

	private fun register(): CompletionStage<HubReply> {
		val payload = jsonObject {
			addProperty("clientId", options.clientId)
			addProperty("clientType", options.clientType)
			addProperty("displayName", options.displayName)
			addProperty("transport", "native")
			addProperty("actorKind", "client")
			addProperty("protocolVersion", HubProtocol.VERSION)
			add("capabilities", JsonArray().apply {
				options.capabilities.forEach { name -> add(jsonObject { addProperty("name", name) }) }
			})
			add("metadata", jsonObject {
				addProperty("version", options.clientVersion)
				addProperty("pid", ProcessHandle.current().pid())
				options.metadata.forEach { (k, v) -> addProperty(k, v) }
			})
			add("workspaceContext", jsonObject {
				putIfNotNull("workspaceRoot", options.workspaceRoot)
				putIfNotNull("cwd", options.cwd)
			})
		}
		return sendCommand("client.register", payload, null, HubProtocol.DEFAULT_COMMAND_TIMEOUT_MS)
	}

	/**
	 * Sends a command and resolves with its reply. Rejects with [HubCommandException]
	 * when the hub answers `ok: false`, and with [HubTransportException] when the
	 * socket is not open or closes before the reply arrives.
	 */
	fun command(
		command: String,
		payload: JsonObject? = null,
		sessionId: String? = null,
		timeoutMs: Long? = HubProtocol.defaultTimeoutMs(command),
	): CompletableFuture<HubReply> {
		if (!isConnected) {
			return CompletableFuture.failedFuture(HubTransportException(lastError?.let { "Hub connection is not open: ${it.message}" } ?: "Hub connection is not open."))
		}
		return sendCommand(command, payload, sessionId, timeoutMs).toCompletableFuture()
	}

	private fun sendCommand(command: String, payload: JsonObject?, sessionId: String?, timeoutMs: Long?): CompletableFuture<HubReply> {
		val ws = socket.get() ?: return CompletableFuture.failedFuture(HubTransportException("Hub connection is not open."))
		val requestId = "jbreq_${requestCounter.incrementAndGet()}_${java.lang.Long.toString(System.nanoTime(), 36)}"
		val future = CompletableFuture<HubReply>()
		val entry = Pending(command, future, null)
		pending[requestId] = entry
		if (timeoutMs != null) {
			entry.timeout = scheduler.schedule({
				if (pending.remove(requestId) != null) {
					future.completeExceptionally(
						HubCommandException("hub_command_timeout", "Hub command $command timed out after ${timeoutMs}ms (hub=${options.url}, requestId=$requestId)."),
					)
				}
			}, timeoutMs, TimeUnit.MILLISECONDS)
		}
		val frame = HubFrame.Command(HubCommand(command, requestId, options.clientId, sessionId, timeoutMs, payload))
		ws.sendText(HubFrameCodec.encode(frame), true).whenComplete { _, error ->
			if (error != null && pending.remove(requestId) != null) {
				entry.timeout?.cancel(false)
				future.completeExceptionally(HubTransportException("Failed to send $command: ${rootMessage(error)}", error))
			}
		}
		return future.thenApply { reply ->
			reply.errorOrNull()?.let { throw it }
			reply
		}
	}

	private fun sendSubscribe() {
		val ws = socket.get() ?: return
		val since = lastEventSequence.get().takeIf { it >= 0 }
		ws.sendText(HubFrameCodec.encode(HubFrame.StreamSubscribe(options.clientId, null, since)), true)
	}

	private fun handleFrame(frame: HubFrame) {
		when (frame) {
			is HubFrame.Reply -> {
				val requestId = frame.envelope.requestId ?: return
				val entry = pending.remove(requestId) ?: return
				entry.timeout?.cancel(false)
				entry.future.complete(frame.envelope)
			}
			is HubFrame.Event -> {
				frame.envelope.sequence?.let { seq -> lastEventSequence.updateAndGet { prev -> maxOf(prev, seq) } }
				for (listener in listeners) {
					try {
						listener.onEvent(frame.envelope)
					} catch (_: Throwable) {
						// A misbehaving listener must not break the event loop for the others.
					}
				}
			}
			else -> Unit
		}
	}

	private fun handleClosed(myGeneration: Long, error: Throwable?) {
		if (myGeneration != generation.get()) return
		socket.set(null)
		val reason = error ?: HubTransportException("Hub connection closed")
		lastError = reason
		failPending(reason)
		setState(HubConnectionState.DISCONNECTED, reason)
		if (options.autoReconnect && !closedByClient.get()) scheduleReconnect()
	}

	private fun failPending(error: Throwable) {
		val entries = pending.values.toList()
		pending.clear()
		for (entry in entries) {
			entry.timeout?.cancel(false)
			entry.future.completeExceptionally(HubTransportException("Hub connection closed before ${entry.command} replied", error))
		}
	}

	@Synchronized
	private fun scheduleReconnect() {
		if (reconnectTask != null || closedByClient.get()) return
		val delay = minOf(RECONNECT_INITIAL_MS shl minOf(reconnectAttempt, 10), RECONNECT_MAX_MS)
		val jittered = (delay * (0.5 + Math.random() * 0.5)).toLong()
		reconnectAttempt++
		reconnectTask = scheduler.schedule({
			synchronized(this) { reconnectTask = null }
			if (!closedByClient.get()) connect()
		}, jittered, TimeUnit.MILLISECONDS)
	}

	private fun setState(next: HubConnectionState, error: Throwable?) {
		if (state == next && error == null) return
		state = next
		for (listener in listeners) {
			try {
				listener.onConnectionStateChanged(next, error)
			} catch (_: Throwable) {
			}
		}
	}

	/** Best-effort `client.unregister`, then closes the socket and stops reconnecting. */
	override fun close() {
		closedByClient.set(true)
		generation.incrementAndGet()
		synchronized(this) {
			reconnectTask?.cancel(false)
			reconnectTask = null
		}
		val ws = socket.getAndSet(null)
		if (ws != null && !ws.isOutputClosed) {
			try {
				val requestId = "jbreq_bye_${requestCounter.incrementAndGet()}"
				ws.sendText(HubFrameCodec.encode(HubFrame.Command(HubCommand("client.unregister", requestId, options.clientId, null, 2_000))), true)
					.orTimeout(1, TimeUnit.SECONDS)
					.handle { _, _ -> ws.sendClose(WebSocket.NORMAL_CLOSURE, "bye") }
					.thenCompose { it }
					.orTimeout(2, TimeUnit.SECONDS)
					.exceptionally { ws.abort(); null }
			} catch (_: Throwable) {
				ws.abort()
			}
		}
		failPending(HubTransportException("Hub client closed"))
		setState(HubConnectionState.DISCONNECTED, null)
	}

	private inner class SocketListener(private val myGeneration: Long) : WebSocket.Listener {
		private val buffer = StringBuilder()

		override fun onOpen(webSocket: WebSocket) {
			webSocket.request(1)
		}

		override fun onText(webSocket: WebSocket, data: CharSequence, last: Boolean): CompletionStage<*>? {
			buffer.append(data)
			if (last) {
				val text = buffer.toString()
				buffer.setLength(0)
				try {
					handleFrame(HubFrameCodec.decode(text))
				} catch (_: Exception) {
					// Malformed frame: ignore rather than tear down the connection.
				}
			}
			webSocket.request(1)
			return null
		}

		override fun onClose(webSocket: WebSocket, statusCode: Int, reason: String): CompletionStage<*>? {
			handleClosed(myGeneration, HubTransportException("Hub connection closed (code=$statusCode${if (reason.isNotBlank()) ", reason=$reason" else ""})"))
			return null
		}

		override fun onError(webSocket: WebSocket, error: Throwable) {
			handleClosed(myGeneration, HubTransportException("Hub connection error: ${rootMessage(error)}", error))
		}
	}
}

internal fun unwrap(error: Throwable): Throwable {
	var current = error
	while ((current is java.util.concurrent.CompletionException || current is java.util.concurrent.ExecutionException) && current.cause != null) {
		current = current.cause!!
	}
	return current
}

internal fun rootMessage(error: Throwable): String {
	val root = unwrap(error)
	return root.message?.takeIf { it.isNotBlank() } ?: root.javaClass.simpleName
}
