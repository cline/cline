package bot.cline.jetbrains.hub

import com.google.gson.JsonObject
import com.google.gson.JsonParser
import java.io.File
import java.io.IOException
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.Paths
import java.time.Duration
import java.util.concurrent.TimeUnit

/** Where a usable hub lives and how to authenticate to it. */
data class HubEndpoint(
	val url: String,
	val authToken: String?,
	/** Human-readable description of how the endpoint was found. */
	val source: String,
	val coreVersion: String? = null,
	val pid: Long? = null,
)

/** Parsed `HubServerDiscoveryRecord` (`sdk/packages/core/src/hub/discovery/index.ts`). */
data class HubDiscoveryRecord(
	val hubId: String,
	val protocolVersion: String,
	val authToken: String,
	val url: String,
	val pid: Long?,
	val coreVersion: String?,
	val buildId: String?,
	val updatedAt: String,
	val path: Path,
) {
	companion object {
		fun parse(json: JsonObject, path: Path): HubDiscoveryRecord? {
			val hubId = json.stringOrNull("hubId") ?: return null
			val protocolVersion = json.stringOrNull("protocolVersion") ?: return null
			val authToken = json.stringOrNull("authToken") ?: return null
			val url = json.stringOrNull("url") ?: return null
			val updatedAt = json.stringOrNull("updatedAt") ?: return null
			return HubDiscoveryRecord(
				hubId = hubId,
				protocolVersion = protocolVersion,
				authToken = authToken,
				url = url,
				pid = json.longOrNull("pid"),
				coreVersion = json.stringOrNull("coreVersion"),
				buildId = json.stringOrNull("buildId"),
				updatedAt = updatedAt,
				path = path,
			)
		}

		fun read(path: Path): HubDiscoveryRecord? = try {
			val text = Files.readString(path)
			val json = JsonParser.parseString(text)
			if (json.isJsonObject) parse(json.asJsonObject, path) else null
		} catch (_: Exception) {
			null
		}
	}
}

/**
 * Finds the local Cline Hub the same way the CLI and other Cline surfaces do:
 *
 * 1. an explicit discovery-record path (`CLINE_HUB_DISCOVERY_PATH` or settings),
 * 2. the production owner record `<data>/locks/hub/production.json`,
 * 3. per-build owner records under `<data>/locks/hub/owners/` (source/dev builds),
 *
 * probing each record's `/health` endpoint so stale records left by dead
 * daemons are skipped. When nothing answers, the Cline CLI is asked to start
 * (or hand back) a daemon with `cline hub ensure --json`, which prints the
 * URL and auth token.
 */
class HubDiscovery(
	private val env: Map<String, String> = System.getenv(),
	private val homeDir: Path = Paths.get(System.getProperty("user.home")),
	private val http: HttpClient = HttpClient.newBuilder()
		// The hub's Bun server treats any `Upgrade` header (incl. the JDK's default
		// `h2c` negotiation) as a WebSocket handshake and drops plain HTTP requests
		// that carry one, so pin the probe to HTTP/1.1.
		.version(HttpClient.Version.HTTP_1_1)
		.connectTimeout(Duration.ofSeconds(2))
		.proxy(java.net.ProxySelector.of(null))
		.build(),
) {
	companion object {
		const val PROBE_TIMEOUT_MS = 2_500L
		const val CLI_ENSURE_TIMEOUT_SECONDS = 90L
	}

	fun clineDir(): Path = env["CLINE_DIR"]?.trim()?.takeIf { it.isNotEmpty() }?.let { Paths.get(it) }
		?: homeDir.resolve(".cline")

	fun clineDataDir(): Path = env["CLINE_DATA_DIR"]?.trim()?.takeIf { it.isNotEmpty() }?.let { Paths.get(it) }
		?: clineDir().resolve("data")

	fun providerSettingsPath(): Path = clineDataDir().resolve("settings").resolve("providers.json")

	/** Candidate discovery records, most specific and most recent first. */
	fun candidateRecords(explicitPath: String? = null): List<HubDiscoveryRecord> {
		val paths = linkedSetOf<Path>()
		listOfNotNull(explicitPath, env["CLINE_HUB_DISCOVERY_PATH"])
			.map { it.trim() }
			.filter { it.isNotEmpty() }
			.forEach { paths.add(Paths.get(it)) }
		val hubDir = clineDataDir().resolve("locks").resolve("hub")
		paths.add(hubDir.resolve("production.json"))
		val ownersDir = hubDir.resolve("owners")
		if (Files.isDirectory(ownersDir)) {
			Files.list(ownersDir).use { stream ->
				stream.filter { it.fileName.toString().endsWith(".json") }
					.sorted(compareByDescending<Path> { runCatching { Files.getLastModifiedTime(it).toMillis() }.getOrDefault(0L) })
					.forEach { paths.add(it) }
			}
		}
		return paths.mapNotNull { HubDiscoveryRecord.read(it) }
	}

	/** `GET /health` on the hub's HTTP side; `null` when it does not answer. */
	fun probe(wsUrl: String): JsonObject? {
		val healthUrl = toHttpUrl(wsUrl, "/health") ?: return null
		return try {
			val request = HttpRequest.newBuilder(URI.create(healthUrl))
				.timeout(Duration.ofMillis(PROBE_TIMEOUT_MS))
				.GET()
				.build()
			val response = http.send(request, HttpResponse.BodyHandlers.ofString())
			if (response.statusCode() !in 200..299) return null
			val json = JsonParser.parseString(response.body())
			if (!json.isJsonObject) return null
			json.asJsonObject.takeIf { it.stringOrNull("url") != null && it.stringOrNull("protocolVersion") != null }
		} catch (_: Exception) {
			null
		}
	}

	/**
	 * Returns the first discovery record whose daemon answers a health probe
	 * *and* reports the same `hubId`. The id check matters because a stale
	 * record can point at a port that a newer daemon (with a different auth
	 * token) has since reused.
	 */
	fun findRunningHub(explicitPath: String? = null): HubEndpoint? {
		for (record in candidateRecords(explicitPath)) {
			val health = probe(record.url) ?: continue
			val liveHubId = health.stringOrNull("hubId")
			if (liveHubId != null && liveHubId != record.hubId) continue
			return HubEndpoint(
				url = record.url,
				authToken = record.authToken,
				source = "discovery record ${record.path}",
				coreVersion = health.stringOrNull("coreVersion") ?: record.coreVersion,
				pid = health.longOrNull("pid") ?: record.pid,
			)
		}
		return null
	}

	/**
	 * Runs `cline hub ensure --json --cwd <workspaceRoot>`; the CLI starts a
	 * daemon unless a compatible one is already running and prints
	 * `{"url": ..., "authToken": ...}`.
	 */
	fun ensureViaCli(cliCommand: String, workspaceRoot: String?): HubEndpoint {
		val cwdArgs = workspaceRoot?.let { listOf("--cwd", it) } ?: emptyList()
		// `--login-shell-path` makes the daemon inherit the user's login-shell PATH,
		// which matters when the IDE was launched from a dock/launcher. Older CLIs
		// do not know the flag, so fall back to a plain `ensure` in that case.
		val first = runCli(cliCommand, listOf("hub", "ensure", "--json", "--login-shell-path") + cwdArgs, workspaceRoot)
		val result = if (first.exitCode != 0 && first.stderr.contains("unknown option", ignoreCase = true)) {
			runCli(cliCommand, listOf("hub", "ensure", "--json") + cwdArgs, workspaceRoot)
		} else {
			first
		}
		val parsed = parseEnsureOutput(result.stdout)
		if (result.exitCode != 0 || parsed == null) {
			val detail = result.stderr.trim().ifEmpty { result.stdout.trim() }
			throw HubTransportException(
				"`$cliCommand hub ensure` failed (exit ${result.exitCode})." + if (detail.isNotEmpty()) "\n$detail" else "",
			)
		}
		return parsed
	}

	private class CliResult(val exitCode: Int, val stdout: String, val stderr: String)

	private fun runCli(cliCommand: String, args: List<String>, workspaceRoot: String?): CliResult {
		val command = buildCliCommand(cliCommand, args)
		val builder = ProcessBuilder(command).redirectErrorStream(false)
		workspaceRoot?.let { root -> File(root).takeIf { it.isDirectory }?.let { builder.directory(it) } }
		val process = try {
			builder.start()
		} catch (e: IOException) {
			throw HubTransportException(
				"Could not run the Cline CLI (`$cliCommand`). Install it with `npm install -g cline` or set its path in Settings | Tools | Cline (Hub).",
				e,
			)
		}
		val stdout = StringBuilder()
		val stderr = StringBuilder()
		val outReader = Thread { process.inputStream.bufferedReader().forEachLine { stdout.appendLine(it) } }
		val errReader = Thread { process.errorStream.bufferedReader().forEachLine { stderr.appendLine(it) } }
		outReader.isDaemon = true
		errReader.isDaemon = true
		outReader.start()
		errReader.start()
		if (!process.waitFor(CLI_ENSURE_TIMEOUT_SECONDS, TimeUnit.SECONDS)) {
			process.destroyForcibly()
			throw HubTransportException("`$cliCommand hub ensure` did not finish within ${CLI_ENSURE_TIMEOUT_SECONDS}s.")
		}
		outReader.join(2_000)
		errReader.join(2_000)
		return CliResult(process.exitValue(), stdout.toString(), stderr.toString())
	}

	fun resolve(options: Options): HubEndpoint {
		options.urlOverride?.trim()?.takeIf { it.isNotEmpty() }?.let { url ->
			return HubEndpoint(normalizeWsUrl(url), options.authTokenOverride?.trim()?.takeIf { it.isNotEmpty() }, "settings override")
		}
		findRunningHub(options.discoveryPathOverride)?.let { return it }
		val started = ensureViaCli(options.cliCommand, options.workspaceRoot)
		// The CLI only prints url/token; enrich with /health so the UI can show the core version.
		val health = probe(started.url) ?: return started
		return started.copy(coreVersion = health.stringOrNull("coreVersion"), pid = health.longOrNull("pid"))
	}

	data class Options(
		val cliCommand: String = "cline",
		val workspaceRoot: String? = null,
		val urlOverride: String? = null,
		val authTokenOverride: String? = null,
		val discoveryPathOverride: String? = null,
	)

	internal fun parseEnsureOutput(stdout: String): HubEndpoint? {
		// The CLI may print build banners before the JSON line; take the last JSON object.
		val line = stdout.lineSequence().map { it.trim() }.lastOrNull { it.startsWith("{") && it.endsWith("}") } ?: return null
		val json = runCatching { JsonParser.parseString(line) }.getOrNull()?.takeIf { it.isJsonObject }?.asJsonObject ?: return null
		val url = json.stringOrNull("url") ?: return null
		return HubEndpoint(normalizeWsUrl(url), json.stringOrNull("authToken"), "cline hub ensure")
	}

	private fun buildCliCommand(cliCommand: String, args: List<String>): List<String> {
		val parts = splitCommand(cliCommand).toMutableList()
		val isWindows = System.getProperty("os.name").lowercase().contains("win")
		val bareName = parts.size == 1 && !parts[0].contains('\\') && !parts[0].contains('/')
		if (bareName && !isWindows) {
			locateExecutable(parts[0])?.let { parts[0] = it }
		}
		return if (isWindows && bareName) {
			// `cline` on Windows is `cline.cmd`; ProcessBuilder needs a shell for that.
			listOf("cmd.exe", "/c", parts[0]) + args
		} else {
			parts + args
		}
	}

	/**
	 * IDEs launched from a dock or desktop launcher often get a minimal PATH
	 * without the user's Node/npm bin directories, so when a bare command is
	 * not on PATH look in the places global npm/bun/volta installs end up.
	 */
	internal fun locateExecutable(name: String): String? {
		val pathDirs = (env["PATH"] ?: "").split(File.pathSeparatorChar).filter { it.isNotBlank() }
		val onPath = pathDirs.asSequence().map { Paths.get(it, name) }.firstOrNull { Files.isExecutable(it) }
		if (onPath != null) return null // PATH already resolves it; keep the bare name.
		val candidates = mutableListOf<Path>()
		listOf("/usr/local/bin", "/opt/homebrew/bin", "/usr/bin").forEach { candidates.add(Paths.get(it, name)) }
		listOf(".bun/bin", ".npm-global/bin", ".volta/bin", ".local/bin", "node_modules/.bin").forEach { candidates.add(homeDir.resolve(it).resolve(name)) }
		env["BUN_INSTALL"]?.takeIf { it.isNotBlank() }?.let { candidates.add(Paths.get(it, "bin", name)) }
		env["VOLTA_HOME"]?.takeIf { it.isNotBlank() }?.let { candidates.add(Paths.get(it, "bin", name)) }
		listOfNotNull(env["NVM_DIR"]?.takeIf { it.isNotBlank() }?.let { Paths.get(it) }, homeDir.resolve(".nvm"))
			.map { it.resolve("versions").resolve("node") }
			.filter { Files.isDirectory(it) }
			.forEach { nodeVersions ->
				runCatching {
					Files.list(nodeVersions).use { versions ->
						versions.sorted(compareByDescending<Path> { it.fileName.toString() }).forEach { candidates.add(it.resolve("bin").resolve(name)) }
					}
				}
			}
		env["NODE_PATH"]?.takeIf { it.isNotBlank() }?.split(File.pathSeparatorChar)?.forEach { candidates.add(Paths.get(it, ".bin", name)) }
		return candidates.firstOrNull { Files.isExecutable(it) }?.toString()
	}

	/** Splits a user-provided command line on whitespace, honoring simple quotes. */
	internal fun splitCommand(command: String): List<String> {
		val result = mutableListOf<String>()
		val current = StringBuilder()
		var quote: Char? = null
		for (ch in command.trim()) {
			when {
				quote != null -> if (ch == quote) quote = null else current.append(ch)
				ch == '"' || ch == '\'' -> quote = ch
				ch.isWhitespace() -> if (current.isNotEmpty()) { result.add(current.toString()); current.clear() }
				else -> current.append(ch)
			}
		}
		if (current.isNotEmpty()) result.add(current.toString())
		return result.ifEmpty { listOf("cline") }
	}
}

fun normalizeWsUrl(url: String): String {
	val trimmed = url.trim()
	return when {
		trimmed.startsWith("http://") -> "ws://" + trimmed.removePrefix("http://")
		trimmed.startsWith("https://") -> "wss://" + trimmed.removePrefix("https://")
		else -> trimmed
	}
}

/** `ws://host:port/hub` -> `http://host:port<path>` (query and fragment dropped). */
fun toHttpUrl(wsUrl: String, path: String): String? = try {
	val uri = URI.create(normalizeWsUrl(wsUrl))
	val scheme = when (uri.scheme) {
		"wss" -> "https"
		"ws" -> "http"
		"http", "https" -> uri.scheme
		else -> return null
	}
	val port = if (uri.port == -1) "" else ":${uri.port}"
	"$scheme://${uri.host}$port$path"
} catch (_: Exception) {
	null
}
