package bot.cline.jetbrains.session

import bot.cline.jetbrains.hub.HubClient
import bot.cline.jetbrains.hub.HubClientListener
import bot.cline.jetbrains.hub.HubClientOptions
import bot.cline.jetbrains.hub.HubConnectionState
import bot.cline.jetbrains.hub.HubDiscovery
import bot.cline.jetbrains.hub.HubEndpoint
import bot.cline.jetbrains.hub.HubEvent
import bot.cline.jetbrains.hub.HubReply
import bot.cline.jetbrains.hub.ProviderDefaults
import bot.cline.jetbrains.hub.arrayOrNull
import bot.cline.jetbrains.hub.jsonObject
import bot.cline.jetbrains.hub.longOrNull
import bot.cline.jetbrains.hub.objectOrNull
import bot.cline.jetbrains.hub.putIfNotNull
import bot.cline.jetbrains.hub.stringOrNull
import bot.cline.jetbrains.hub.unwrap
import bot.cline.jetbrains.settings.ClineSettings
import bot.cline.jetbrains.settings.SessionMode
import com.google.gson.JsonArray
import com.google.gson.JsonObject
import com.intellij.ide.plugins.PluginManagerCore
import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationInfo
import com.intellij.openapi.components.Service
import com.intellij.openapi.diagnostic.logger
import com.intellij.openapi.extensions.PluginId
import com.intellij.openapi.project.Project
import com.intellij.util.concurrency.AppExecutorUtil
import java.util.concurrent.CompletableFuture
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicReference

/** A row in the session picker, from `session.list`. */
data class SessionSummary(
	val sessionId: String,
	val title: String,
	val status: String,
	val workspaceRoot: String?,
	val updatedAt: Long,
	val provider: String?,
	val model: String?,
	val active: Boolean,
) {
	companion object {
		fun from(json: JsonObject): SessionSummary? {
			val sessionId = json.stringOrNull("sessionId") ?: return null
			val metadata = json.objectOrNull("metadata")
			val rawTitle = metadata?.stringOrNull("title")
				?: metadata?.stringOrNull("prompt")?.let(Transcript::stripUserInputWrapper)
				?: sessionId
			return SessionSummary(
				sessionId = sessionId,
				title = rawTitle.lineSequence().firstOrNull()?.take(80)?.ifBlank { sessionId } ?: sessionId,
				status = json.stringOrNull("status") ?: "unknown",
				workspaceRoot = json.stringOrNull("workspaceRoot"),
				updatedAt = json.longOrNull("updatedAt") ?: json.longOrNull("createdAt") ?: 0L,
				provider = metadata?.stringOrNull("provider"),
				model = metadata?.stringOrNull("model"),
				active = (json.arrayOrNull("participants")?.size() ?: 0) > 0 || json.stringOrNull("status") == "running",
			)
		}
	}
}

/** UI-facing view of the service; all callbacks arrive on a background thread. */
interface ClineSessionListener {
	fun onConnectionChanged(state: HubConnectionState, endpoint: HubEndpoint?, error: Throwable?) {}
	fun onTranscriptChanged() {}
	fun onSessionChanged(sessionId: String?, title: String?) {}
}

/**
 * Per-project owner of the hub connection and the active chat session.
 *
 * Every public method is non-blocking and safe to call from the EDT; work runs
 * on the shared app executor and results are published through
 * [ClineSessionListener]. The service talks to the hub exactly like the CLI's
 * remote runtime does: `session.create` for new/resumed sessions,
 * `session.send_input` for turns (reply arrives when the turn ends),
 * `run.abort`, `approval.respond`, `session.list`, `session.messages`.
 */
@Service(Service.Level.PROJECT)
class ClineSessionService(private val project: Project) : Disposable {
	private val log = logger<ClineSessionService>()
	private val executor = AppExecutorUtil.createBoundedApplicationPoolExecutor("Cline Hub", 2)
	private val listeners = CopyOnWriteArrayList<ClineSessionListener>()
	private val clientRef = AtomicReference<HubClient?>()
	private val discovery = HubDiscovery()

	val transcript = Transcript()

	@Volatile var endpoint: HubEndpoint? = null
		private set
	@Volatile var connectionState: HubConnectionState = HubConnectionState.DISCONNECTED
		private set
	@Volatile var connectionError: Throwable? = null
		private set
	@Volatile var sessionId: String? = null
		private set
	@Volatile var sessionTitle: String? = null
		private set
	@Volatile var sessionMode: SessionMode = ClineSettings.getInstance().defaultMode
	@Volatile var sessionProvider: String? = null
		private set
	@Volatile var sessionModel: String? = null
		private set
	@Volatile private var connecting: CompletableFuture<HubClient>? = null

	val isRunning: Boolean get() = transcript.running
	val workspaceRoot: String? get() = project.basePath

	fun addListener(listener: ClineSessionListener): () -> Unit {
		listeners.add(listener)
		return { listeners.remove(listener) }
	}

	// ---------------------------------------------------------------- connection

	/** Discovers (or starts, via the CLI) a hub and connects. Idempotent while connected. */
	fun connect(force: Boolean = false): CompletableFuture<HubClient> {
		synchronized(this) {
			val existing = clientRef.get()
			if (!force && existing != null && existing.isConnected) return CompletableFuture.completedFuture(existing)
			connecting?.let { if (!force && !it.isDone) return it }
			if (force) {
				clientRef.getAndSet(null)?.let { runCatching { it.close() } }
			}
			val future = CompletableFuture.supplyAsync({ resolveAndOpen() }, executor)
			connecting = future
			future.whenComplete { _, error ->
				if (error != null) {
					connectionError = unwrap(error)
					connectionState = HubConnectionState.DISCONNECTED
					notifyConnection()
				}
			}
			return future
		}
	}

	private fun resolveAndOpen(): HubClient {
		connectionState = HubConnectionState.CONNECTING
		connectionError = null
		notifyConnection()
		val settings = ClineSettings.getInstance()
		val resolved = discovery.resolve(
			HubDiscovery.Options(
				cliCommand = settings.cliCommand,
				workspaceRoot = workspaceRoot,
				urlOverride = settings.hubUrlOverride.takeIf { it.isNotBlank() },
				authTokenOverride = settings.authTokenOverride,
				discoveryPathOverride = settings.discoveryPathOverride.takeIf { it.isNotBlank() },
			),
		)
		endpoint = resolved
		val client = HubClient(
			HubClientOptions(
				url = resolved.url,
				authToken = resolved.authToken,
				clientType = "jetbrains",
				displayName = runCatching { ApplicationInfo.getInstance().fullApplicationName }.getOrDefault("JetBrains IDE"),
				clientVersion = pluginVersion(),
				workspaceRoot = workspaceRoot,
				cwd = workspaceRoot,
				metadata = mapOf("project" to project.name),
			),
		)
		client.addListener(object : HubClientListener {
			override fun onEvent(event: HubEvent) = handleEvent(event)
			override fun onConnectionStateChanged(state: HubConnectionState, error: Throwable?) {
				if (clientRef.get() !== client && state != HubConnectionState.CONNECTED) return
				connectionState = state
				connectionError = error
				notifyConnection()
			}
		})
		clientRef.getAndSet(client)?.let { runCatching { it.close() } }
		try {
			client.connect().get()
		} catch (e: Exception) {
			clientRef.compareAndSet(client, null)
			client.close()
			throw unwrap(e)
		}
		connectionState = HubConnectionState.CONNECTED
		connectionError = null
		notifyConnection()
		return client
	}

	private fun pluginVersion(): String =
		PluginManagerCore.getPlugin(PluginId.getId("bot.cline.jetbrains.hub"))?.version ?: "dev"

	private fun handleEvent(event: HubEvent) {
		val current = sessionId
		if (event.sessionId == null || event.sessionId != current) {
			return
		}
		if (event.event == "session.updated") {
			val title = event.payload.objectOrNull("session")?.objectOrNull("metadata")?.stringOrNull("title")
				?: event.payload.objectOrNull("snapshot")?.stringOrNull("title")
			if (title != null && title != sessionTitle) {
				sessionTitle = title
				notifySession()
			}
			return
		}
		if (transcript.apply(event)) notifyTranscript()
	}

	// ---------------------------------------------------------------- sessions

	/** Forgets the current session; the next prompt creates a new one. */
	fun newSession() {
		val previous = sessionId
		sessionId = null
		sessionTitle = null
		sessionProvider = null
		sessionModel = null
		transcript.clear()
		notifySession()
		notifyTranscript()
		if (previous != null) {
			clientRef.get()?.takeIf { it.isConnected }?.command("session.detach", jsonObject { addProperty("sessionId", previous) }, previous)
				?.exceptionally { null }
		}
	}

	/** Sends one prompt on the current session, creating the session first when needed. */
	fun send(prompt: String, mode: SessionMode = sessionMode): CompletableFuture<Void> {
		val text = prompt.trim()
		if (text.isEmpty()) return CompletableFuture.completedFuture(null)
		sessionMode = mode
		transcript.addUserMessage(text)
		transcript.markRunning(true)
		notifyTranscript()
		return connect()
			.thenCompose { client -> ensureSession(client).thenApply { id -> client to id } }
			.thenCompose { (client, id) ->
				val payload = jsonObject {
					addProperty("prompt", text)
					addProperty("mode", mode.wireValue)
				}
				client.command("session.send_input", payload, id, timeoutMs = null)
			}
			.handle { reply, error ->
				if (error != null) {
					val root = unwrap(error)
					log.info("send_input failed", root)
					transcript.markRunning(false)
					transcript.addNotice(root.message ?: "Sending the prompt failed.", NoticeLevel.ERROR)
				} else {
					applyTurnResult(reply)
					transcript.markRunning(false)
				}
				notifyTranscript()
				null
			}
	}

	private fun applyTurnResult(reply: HubReply) {
		val result = reply.payload?.objectOrNull("result") ?: return
		if (result.stringOrNull("finishReason") == "error") {
			val message = result.stringOrNull("error") ?: result.stringOrNull("text")
			if (!message.isNullOrBlank() && transcript.items.lastOrNull().let { it !is TranscriptItem.Notice || it.text != message }) {
				transcript.addNotice(message, NoticeLevel.ERROR)
			}
		}
	}

	private fun ensureSession(client: HubClient): CompletableFuture<String> {
		sessionId?.let { return CompletableFuture.completedFuture(it) }
		return createSession(client, existingSessionId = null, initialMessages = null)
	}

	private fun createSession(client: HubClient, existingSessionId: String?, initialMessages: JsonArray?): CompletableFuture<String> {
		val settings = ClineSettings.getInstance()
		val defaults = ProviderDefaults.read(discovery.providerSettingsPath())
		val provider = settings.provider.ifBlank { defaults.provider ?: "" }.ifBlank { null }
		val model = settings.model.ifBlank { defaults.model ?: "" }.ifBlank { null }
		val root = workspaceRoot
		val mode = sessionMode.wireValue
		val payload = jsonObject {
			putIfNotNull("workspaceRoot", root)
			putIfNotNull("cwd", root)
			add("sessionConfig", jsonObject {
				putIfNotNull("sessionId", existingSessionId)
				putIfNotNull("providerId", provider)
				putIfNotNull("modelId", model)
				putIfNotNull("cwd", root)
				putIfNotNull("workspaceRoot", root)
				addProperty("mode", mode)
			})
			add("metadata", jsonObject {
				addProperty("source", "jetbrains")
				putIfNotNull("provider", provider)
				putIfNotNull("model", model)
				addProperty("interactive", true)
				addProperty("project", project.name)
			})
			add("runtimeOptions", jsonObject {
				addProperty("mode", mode)
				addProperty("autoApproveTools", settings.autoApproveTools)
			})
			add("toolPolicies", jsonObject {
				add("*", jsonObject { addProperty("autoApprove", settings.autoApproveTools) })
			})
			add("modelSelection", jsonObject {
				putIfNotNull("provider", provider)
				putIfNotNull("model", model)
			})
			if (initialMessages != null) add("initialMessages", initialMessages)
		}
		return client.command("session.create", payload, timeoutMs = 60_000).thenApply { reply ->
			val session = reply.payload?.objectOrNull("session") ?: throw IllegalStateException("session.create returned no session")
			val id = session.stringOrNull("sessionId") ?: throw IllegalStateException("session.create returned no sessionId")
			sessionId = id
			sessionTitle = session.objectOrNull("metadata")?.stringOrNull("title")
			sessionProvider = provider
			sessionModel = model
			notifySession()
			id
		}
	}

	/** Lists hub sessions, most recently updated first. */
	fun listSessions(limit: Int = 50): CompletableFuture<List<SessionSummary>> =
		connect().thenCompose { client ->
			client.command("session.list", jsonObject { addProperty("limit", limit); addProperty("rootOnly", true) })
		}.thenApply { reply ->
			(reply.payload?.arrayOrNull("sessions") ?: JsonArray())
				.mapNotNull { it.takeIf { e -> e.isJsonObject }?.asJsonObject?.let(SessionSummary::from) }
				.sortedByDescending { it.updatedAt }
		}

	/**
	 * Switches to an existing session: loads its history, then either attaches
	 * (session still live in the hub) or re-creates it from the persisted
	 * messages, which is how the CLI resumes sessions.
	 */
	fun openSession(summary: SessionSummary): CompletableFuture<Void> {
		transcript.clear()
		sessionId = summary.sessionId
		sessionTitle = summary.title
		sessionProvider = summary.provider
		sessionModel = summary.model
		notifySession()
		notifyTranscript()
		return connect().thenCompose { client ->
			client.command("session.messages", jsonObject { addProperty("sessionId", summary.sessionId) }, summary.sessionId)
				.thenCompose { reply ->
					val messages = reply.payload?.arrayOrNull("messages")
					transcript.loadHistory(messages)
					notifyTranscript()
					if (summary.active) {
						client.command("session.attach", jsonObject { addProperty("sessionId", summary.sessionId) }, summary.sessionId)
							.thenApply { summary.sessionId }
					} else {
						createSession(client, summary.sessionId, messages ?: JsonArray())
					}
				}
		}.handle { _, error ->
			if (error != null) {
				val root = unwrap(error)
				log.info("openSession failed", root)
				transcript.addNotice("Could not open session: ${root.message}", NoticeLevel.ERROR)
				notifyTranscript()
			}
			null
		}
	}

	fun abort(): CompletableFuture<Void> {
		val id = sessionId ?: return CompletableFuture.completedFuture(null)
		val client = clientRef.get() ?: return CompletableFuture.completedFuture(null)
		return client.command("run.abort", jsonObject { addProperty("sessionId", id) }, id)
			.handle { _, error ->
				if (error != null) {
					transcript.addNotice("Abort failed: ${unwrap(error).message}", NoticeLevel.WARNING)
					notifyTranscript()
				}
				null
			}
	}

	fun respondToApproval(approvalId: String, approved: Boolean, reason: String? = null): CompletableFuture<Void> {
		transcript.resolveApprovalLocally(approvalId, approved)
		notifyTranscript()
		val client = clientRef.get() ?: return CompletableFuture.completedFuture(null)
		val payload = jsonObject {
			addProperty("approvalId", approvalId)
			addProperty("approved", approved)
			if (!reason.isNullOrBlank()) add("payload", jsonObject { addProperty("reason", reason) })
		}
		return client.command("approval.respond", payload, sessionId).handle { _, error ->
			if (error != null) {
				transcript.addNotice("Approval response failed: ${unwrap(error).message}", NoticeLevel.WARNING)
				notifyTranscript()
			}
			null
		}
	}

	// ---------------------------------------------------------------- notify

	private fun notifyConnection() {
		for (l in listeners) runCatching { l.onConnectionChanged(connectionState, endpoint, connectionError) }
	}

	private fun notifyTranscript() {
		for (l in listeners) runCatching { l.onTranscriptChanged() }
	}

	private fun notifySession() {
		for (l in listeners) runCatching { l.onSessionChanged(sessionId, sessionTitle) }
	}

	override fun dispose() {
		clientRef.getAndSet(null)?.let { runCatching { it.close() } }
		listeners.clear()
	}

	companion object {
		fun getInstance(project: Project): ClineSessionService = project.getService(ClineSessionService::class.java)
	}
}
