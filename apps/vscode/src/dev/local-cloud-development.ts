import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { type LocalCloudEnvironment, startLocalCloudEnvironment } from "../test/cloud/local-cloud-environment"

export async function startLocalCloudDevelopment(options: { port?: number; tempDir?: string } = {}) {
	const accessToken = "local-cloud-development-token"
	const clineDir = await mkdtemp(path.join(options.tempDir ?? tmpdir(), "cline-local-cloud-profile-"))
	const dataDir = path.join(clineDir, "data")
	let environment: LocalCloudEnvironment | undefined
	let disposal: Promise<void> | undefined
	const dispose = (): Promise<void> => {
		disposal ??= (async () => {
			try {
				await environment?.dispose()
			} finally {
				await rm(clineDir, { recursive: true, force: true })
			}
		})()
		return disposal
	}

	// CLINE_LOCAL_CLOUD_MODEL_DELAY_MS holds every scripted model reply so a
	// person can act (cancel, navigate) while the sandbox is still "thinking".
	const modelDelayMs = Number(process.env.CLINE_LOCAL_CLOUD_MODEL_DELAY_MS ?? 0)
	const beforeModelResponse =
		modelDelayMs > 0
			? (signal?: AbortSignal | null) =>
					new Promise<void>((resolve, reject) => {
						const timer = setTimeout(resolve, modelDelayMs)
						signal?.addEventListener(
							"abort",
							() => {
								clearTimeout(timer)
								reject(signal.reason)
							},
							{ once: true },
						)
					})
			: undefined
	// CLINE_LOCAL_CLOUD_PROVISION_DELAY_MS keeps a new sandbox in `provisioning`
	// for that long, like the hosted control plane, so cancelling during
	// provisioning can be exercised.
	const provisioningDelayMs = Number(process.env.CLINE_LOCAL_CLOUD_PROVISION_DELAY_MS ?? 0)
	// CLINE_LOCAL_CLOUD_SEED_EXPIRED=1 starts with two Personal sessions whose
	// sandboxes are already gone, so the read-only transcript view and the
	// "no history captured" path can be exercised without waiting a day.
	const seedExpiredSessions = process.env.CLINE_LOCAL_CLOUD_SEED_EXPIRED === "1"
	// CLINE_LOCAL_CLOUD_INSUFFICIENT_CREDITS=1 makes every model reply the hosted
	// API's 402 insufficient-credits response, so the out-of-credits card can be
	// exercised without spending anything.
	const insufficientCredits = process.env.CLINE_LOCAL_CLOUD_INSUFFICIENT_CREDITS === "1"
	// CLINE_LOCAL_CLOUD_REFUSE_SOCKETS=1 refuses every session socket, so a cloud
	// start fails after its sandbox is ready and the Retry path can be exercised.
	const refuseSessionSockets = process.env.CLINE_LOCAL_CLOUD_REFUSE_SOCKETS === "1"
	try {
		environment = await startLocalCloudEnvironment({
			...options,
			port: options.port ?? 7777,
			accessToken,
			beforeModelResponse,
			provisioningDelayMs,
			seedExpiredSessions,
			insufficientCredits,
			refuseSessionSockets,
		})
		const settingsDir = path.join(dataDir, "settings")
		await mkdir(settingsDir, { recursive: true })
		await writeFile(path.join(dataDir, "globalState.json"), JSON.stringify({ welcomeViewCompleted: true }))
		await writeFile(
			path.join(settingsDir, "providers.json"),
			JSON.stringify({
				version: 1,
				lastUsedProvider: "cline",
				providers: {
					cline: {
						settings: {
							provider: "cline",
							auth: {
								accessToken: `workos:${accessToken}`,
								accountId: "local-cloud-user",
								expiresAt: Date.now() + 24 * 60 * 60 * 1000,
							},
						},
						tokenSource: "oauth",
						updatedAt: new Date().toISOString(),
					},
				},
			}),
		)
		const launchEnv = {
			CLINE_ENVIRONMENT: "local",
			CLINE_ENVIRONMENT_OVERRIDE: "local",
			CLINE_LOCAL_CLOUD_URL: environment.apiBaseUrl,
			CLINE_API_BASE_URL: environment.apiBaseUrl,
			CLINE_CLOUD_SESSIONS: "1",
			CLINE_DIR: clineDir,
			CLINE_DATA_DIR: dataDir,
		}
		return {
			environment,
			clineDir,
			launchEnv,
			launchEnvironment: Object.entries(launchEnv)
				.map(([key, value]) => `${key}='${value.replaceAll("'", "'\\''")}'`)
				.join(" "),
			dispose,
		}
	} catch (error) {
		await dispose()
		throw error
	}
}
