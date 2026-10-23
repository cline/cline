package bot.cline.jetbrains.hub

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * Exercises the real wire protocol against a locally running Cline Hub.
 * Skipped (not failed) when no hub is discoverable, so CI without a hub
 * stays green while developers get an end-to-end check for free.
 *
 * Start one with `cline hub start` (or `bun run cli hub start` from source).
 */
class HubClientLiveTest {
	private val discovery = HubDiscovery()
	private val endpoint: HubEndpoint? by lazy { discovery.findRunningHub() }

	private fun requireHub(): HubEndpoint {
		val hub = endpoint
		assumeTrue(
			"no running Cline Hub discovered under ${discovery.clineDataDir()} (user.home=${System.getProperty("user.home")}); skipping live test",
			hub != null,
		)
		return hub!!
	}

	@Test
	fun `registers, lists sessions and receives events for a created session`() {
		val hub = requireHub()

		val events = CopyOnWriteArrayList<HubEvent>()
		val created = CountDownLatch(1)
		HubClient(HubClientOptions(url = hub.url, authToken = hub.authToken, displayName = "jetbrains-live-test", autoReconnect = false)).use { client ->
			client.addListener(object : HubClientListener {
				override fun onEvent(event: HubEvent) {
					events.add(event)
					if (event.event == "session.created") created.countDown()
				}
			})
			client.connect().get(15, TimeUnit.SECONDS)
			assertTrue(client.isConnected)

			val list = client.command("session.list", jsonObject { addProperty("limit", 5) }).get(15, TimeUnit.SECONDS)
			assertTrue(list.ok)
			assertNotNull(list.payload?.arrayOrNull("sessions"))

			val cwd = System.getProperty("java.io.tmpdir")
			val create = client.command(
				"session.create",
				jsonObject {
					addProperty("workspaceRoot", cwd)
					addProperty("cwd", cwd)
					add("sessionConfig", jsonObject { addProperty("cwd", cwd); addProperty("workspaceRoot", cwd); addProperty("mode", "act") })
					add("metadata", jsonObject { addProperty("source", "jetbrains-test"); addProperty("interactive", true) })
					add("runtimeOptions", jsonObject { addProperty("mode", "act") })
				},
				timeoutMs = 60_000,
			).get(60, TimeUnit.SECONDS)
			assertTrue(create.ok)
			val sessionId = create.payload?.objectOrNull("session")?.stringOrNull("sessionId")
			assertNotNull(sessionId)

			assertTrue("expected a session.created event on the stream", created.await(10, TimeUnit.SECONDS))
			val createdEvent = events.first { it.event == "session.created" }
			assertEquals(sessionId, createdEvent.sessionId)
			assertNotNull("events must carry a sequence for resubscription", createdEvent.sequence)

			val detach = client.command("session.detach", jsonObject { addProperty("sessionId", sessionId) }, sessionId).get(15, TimeUnit.SECONDS)
			assertTrue(detach.ok)
		}
	}

	@Test
	fun `rejects commands with a typed error`() {
		val hub = requireHub()
		HubClient(HubClientOptions(url = hub.url, authToken = hub.authToken, autoReconnect = false)).use { client ->
			client.connect().get(15, TimeUnit.SECONDS)
			try {
				client.command("session.messages", jsonObject { addProperty("sessionId", "does-not-exist") }, "does-not-exist").get(15, TimeUnit.SECONDS)
				throw AssertionError("expected session_not_found")
			} catch (e: java.util.concurrent.ExecutionException) {
				val cause = e.cause as HubCommandException
				assertEquals("session_not_found", cause.code)
			}
		}
	}
}
