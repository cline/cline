import {
	createLocalHubScheduleRuntimeHandlers,
	ensureHubWebSocketServer,
	probeHubServer,
	readHubDiscovery,
	rememberRecoverableLocalHubUrl,
	resolveSharedHubOwnerContext,
} from "@clinebot/core"
import { Logger } from "@/shared/services/Logger"

const HUB_DAEMON_TIMEOUT_MS = 8_000
const HUB_POLL_INTERVAL_MS = 200

export interface ActivatedHubConnection {
	endpoint: string
	authToken?: string
}

let hubConnection: ActivatedHubConnection | undefined
let hubStartupPromise: Promise<ActivatedHubConnection> | undefined

export function startHubDaemonDuringActivation(): Promise<ActivatedHubConnection> {
	if (!hubStartupPromise) {
		hubStartupPromise = discoverOrStartHub().catch((error) => {
			hubStartupPromise = undefined
			throw error
		})
	}
	return hubStartupPromise
}

export async function getActivationHubConnection(): Promise<ActivatedHubConnection | undefined> {
	if (hubConnection) {
		return hubConnection
	}
	if (!hubStartupPromise) {
		return undefined
	}
	try {
		return await hubStartupPromise
	} catch {
		return undefined
	}
}

async function discoverOrStartHub(): Promise<ActivatedHubConnection> {
	const owner = resolveSharedHubOwnerContext()
	const discovered = await probeDiscoveredHub(owner.discoveryPath)
	if (discovered) {
		hubConnection = discovered
		Logger.log(`[HubDaemon] Reusing hub daemon at ${discovered.endpoint}`)
		return discovered
	}

	Logger.log("[HubDaemon] Starting hub daemon during VS Code activation")
	await ensureHubWebSocketServer({
		owner,
		allowPortFallback: true,
		runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
	})

	const deadline = Date.now() + HUB_DAEMON_TIMEOUT_MS
	while (Date.now() < deadline) {
		const next = await probeDiscoveredHub(owner.discoveryPath)
		if (next) {
			hubConnection = next
			Logger.log(`[HubDaemon] Hub daemon ready at ${next.endpoint}`)
			return next
		}
		await new Promise((resolve) => setTimeout(resolve, HUB_POLL_INTERVAL_MS))
	}

	throw new Error("Timed out waiting for hub daemon to become ready.")
}

async function probeDiscoveredHub(discoveryPath: string): Promise<ActivatedHubConnection | undefined> {
	const discovery = await readHubDiscovery(discoveryPath)
	if (!discovery?.url) {
		return undefined
	}

	const healthy = await probeHubServer(discovery.url)
	if (!healthy?.url) {
		return undefined
	}

	return {
		endpoint: rememberRecoverableLocalHubUrl(healthy.url, discovery.authToken),
		authToken: discovery.authToken,
	}
}
