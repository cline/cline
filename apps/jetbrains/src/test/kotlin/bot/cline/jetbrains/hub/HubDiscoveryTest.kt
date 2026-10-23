package bot.cline.jetbrains.hub

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.nio.file.Files

class HubDiscoveryTest {
	@get:Rule
	val tmp = TemporaryFolder()

	private fun writeRecord(dir: java.io.File, name: String, url: String, pid: Long = 123): java.nio.file.Path {
		dir.mkdirs()
		val path = dir.toPath().resolve(name)
		Files.writeString(
			path,
			"""{"hubId":"hub-x","protocolVersion":"v1","authToken":"secret","url":"$url","pid":$pid,"coreVersion":"0.0.95","buildId":"dev","updatedAt":"2026-10-23T03:00:00.000Z"}""",
		)
		return path
	}

	@Test
	fun `resolves cline dirs from env overrides`() {
		val home = tmp.newFolder("home").toPath()
		val custom = tmp.newFolder("custom-data").toPath()
		val defaults = HubDiscovery(env = emptyMap(), homeDir = home)
		assertEquals(home.resolve(".cline"), defaults.clineDir())
		assertEquals(home.resolve(".cline").resolve("data"), defaults.clineDataDir())
		assertEquals(home.resolve(".cline/data/settings/providers.json"), defaults.providerSettingsPath())

		val overridden = HubDiscovery(env = mapOf("CLINE_DATA_DIR" to custom.toString()), homeDir = home)
		assertEquals(custom, overridden.clineDataDir())
	}

	@Test
	fun `candidate records prefer explicit path then production then newest owner`() {
		val home = tmp.newFolder("home2").toPath()
		val hubDir = home.resolve(".cline/data/locks/hub").toFile()
		val production = writeRecord(hubDir, "production.json", "ws://127.0.0.1:25463/hub")
		val ownersDir = hubDir.resolve("owners")
		val older = writeRecord(ownersDir, "hub-old.json", "ws://127.0.0.1:25466/hub")
		Files.setLastModifiedTime(older, java.nio.file.attribute.FileTime.fromMillis(1_000_000))
		val newer = writeRecord(ownersDir, "hub-new.json", "ws://127.0.0.1:25467/hub")
		Files.setLastModifiedTime(newer, java.nio.file.attribute.FileTime.fromMillis(2_000_000))
		val explicit = writeRecord(tmp.newFolder("elsewhere"), "explicit.json", "ws://127.0.0.1:30000/hub")
		Files.writeString(ownersDir.toPath().resolve("garbage.json"), "not json")

		val discovery = HubDiscovery(env = emptyMap(), homeDir = home)
		val records = discovery.candidateRecords(explicit.toString())
		assertEquals(listOf(explicit, production, newer, older), records.map { it.path })
		assertEquals("secret", records.first().authToken)
	}

	@Test
	fun `probe returns null when nothing listens`() {
		val discovery = HubDiscovery(env = emptyMap(), homeDir = tmp.newFolder("home3").toPath())
		// Port 9 (discard) is virtually never bound; connection is refused quickly.
		assertNull(discovery.probe("ws://127.0.0.1:9/hub"))
		assertNull(discovery.findRunningHub())
	}

	@Test
	fun `parses cli ensure output ignoring banner lines`() {
		val discovery = HubDiscovery(env = emptyMap(), homeDir = tmp.newFolder("home4").toPath())
		val endpoint = discovery.parseEnsureOutput(
			"""
			[cline] development build
			{"url":"ws://127.0.0.1:25466/hub","authToken":"tok","cwd":"/w","platform":"linux","arch":"x64"}
			""".trimIndent(),
		)
		assertNotNull(endpoint)
		assertEquals("ws://127.0.0.1:25466/hub", endpoint!!.url)
		assertEquals("tok", endpoint.authToken)
		assertNull(discovery.parseEnsureOutput("no json here"))
	}

	@Test
	fun `splits quoted command lines`() {
		val discovery = HubDiscovery(env = emptyMap(), homeDir = tmp.newFolder("home5").toPath())
		assertEquals(listOf("cline"), discovery.splitCommand("  "))
		assertEquals(listOf("/usr/local/bin/cline"), discovery.splitCommand("/usr/local/bin/cline"))
		assertEquals(listOf("bun", "run", "/path with space/cli.ts"), discovery.splitCommand("bun run \"/path with space/cli.ts\""))
		assertEquals(listOf("npx", "cline"), discovery.splitCommand("npx 'cline'"))
	}

	@Test
	fun `ensureViaCli reports a missing binary clearly`() {
		val discovery = HubDiscovery(env = emptyMap(), homeDir = tmp.newFolder("home6").toPath())
		try {
			discovery.ensureViaCli("definitely-not-a-real-cline-binary-xyz", null)
			throw AssertionError("expected failure")
		} catch (e: HubTransportException) {
			assertTrue(e.message!!.contains("Could not run the Cline CLI"))
		}
	}

	@Test
	fun `locates a bare command in well-known install dirs when PATH misses it`() {
		val home = tmp.newFolder("home7").toPath()
		val bunBin = home.resolve(".bun/bin")
		Files.createDirectories(bunBin)
		val exe = bunBin.resolve("cline")
		Files.writeString(exe, "#!/bin/sh\n")
		exe.toFile().setExecutable(true)

		val emptyPath = tmp.newFolder("emptybin").toString()
		val discovery = HubDiscovery(env = mapOf("PATH" to emptyPath), homeDir = home)
		assertEquals(exe.toString(), discovery.locateExecutable("cline"))
		assertNull("unknown commands stay unresolved", discovery.locateExecutable("definitely-missing"))

		// When PATH already resolves the name, the bare name is kept (null = no rewrite).
		val onPath = HubDiscovery(env = mapOf("PATH" to bunBin.toString()), homeDir = home)
		assertNull(onPath.locateExecutable("cline"))
	}

	@Test
	fun `url helpers`() {
		assertEquals("ws://127.0.0.1:25463/hub", normalizeWsUrl("http://127.0.0.1:25463/hub"))
		assertEquals("wss://example.com/hub", normalizeWsUrl("https://example.com/hub"))
		assertEquals("http://127.0.0.1:25463/health", toHttpUrl("ws://127.0.0.1:25463/hub", "/health"))
		assertEquals("https://example.com/health", toHttpUrl("wss://example.com/hub", "/health"))
		assertNull(toHttpUrl("ftp://nope", "/health"))
	}
}
