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

	try {
		environment = await startLocalCloudEnvironment({ ...options, port: options.port ?? 7777, accessToken })
		const settingsDir = path.join(dataDir, "settings")
		await mkdir(settingsDir, { recursive: true })
		await writeFile(
			path.join(settingsDir, "providers.json"),
			JSON.stringify({
				version: 1,
				lastUsedProvider: "cline",
				providers: {
					cline: {
						provider: "cline",
						auth: {
							accessToken: `workos:${accessToken}`,
							accountId: "local-cloud-user",
							expiresAt: Date.now() + 24 * 60 * 60 * 1000,
						},
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
