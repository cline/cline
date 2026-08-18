import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { prepareRemoteConfigCoreIntegration } from "@cline/core"
import { clearMaterializedRemoteConfigRuntime } from "@cline/shared"
import { Controller } from "@/sdk/SdkController"
import { telemetryService } from "@/services/telemetry"
import { Logger } from "@/shared/services/Logger"
import type { ConfiguredAPIKeys } from "@/shared/storage/state-keys"
import { SdkRemoteConfigControlPlane } from "./sdk-control-plane"
import { applyRemoteConfig, clearRemoteConfig } from "./utils"

export interface RefreshSdkRemoteConfigOptions {
	workspacePath?: string
	rootPath?: string
	isCurrent?: () => boolean
}

const publicationTails = new WeakMap<object, Promise<void>>()

async function withPublicationLock<T>(controller: object, operation: () => Promise<T>): Promise<T> {
	const previous = publicationTails.get(controller) ?? Promise.resolve()
	let release!: () => void
	const current = new Promise<void>((resolve) => {
		release = resolve
	})
	publicationTails.set(controller, current)

	await previous
	try {
		return await operation()
	} finally {
		release()
		if (publicationTails.get(controller) === current) {
			publicationTails.delete(controller)
		}
	}
}

/**
 * File cleanup is best-effort: a filesystem error (e.g. EACCES on the
 * remote-config workspace) must not reject the refresh, or every session
 * start — including for personal users with no org — fails with a raw fs
 * error. State and integration clearing still proceed.
 */
async function clearMaterializedRuntimeBestEffort(workspacePath: string): Promise<void> {
	try {
		await clearMaterializedRemoteConfigRuntime({ workspacePath })
	} catch (error) {
		Logger.error("[RemoteConfig] Failed to remove materialized remote config files; continuing with state clear:", error)
	}
}

/**
 * Authoritative local clear (sign-out): runs under the same publication lock
 * as refreshes so an in-flight refresh cannot interleave with the clear.
 * Callers must also invalidate the refresh coordinator first so a refresh
 * that already fetched under the old identity cannot republish afterward.
 */
export async function clearSdkRemoteConfig(
	controller: Controller,
	options: { workspacePath?: string; organizationId?: string } = {},
): Promise<void> {
	const workspacePath = await getRemoteConfigWorkspacePath(options.workspacePath)
	await withPublicationLock(controller, async () => {
		await clearMaterializedRuntimeBestEffort(workspacePath)
		clearRemoteConfig(options.organizationId)
		controller.setRemoteConfigAvailable(false)
		await controller.setRemoteConfigCoreIntegration(undefined)
	})
}

async function ensureGlobalRemoteConfigWorkspacePath(): Promise<string> {
	const clineDir = process.env.CLINE_DIR || path.join(os.homedir(), ".cline")
	const workspacePath = path.join(clineDir, "data", "remote-config-workspace")
	await fs.mkdir(workspacePath, { recursive: true })
	return workspacePath
}

async function getRemoteConfigWorkspacePath(workspacePath?: string): Promise<string> {
	const trimmed = workspacePath?.trim()
	if (trimmed) {
		return trimmed
	}
	return ensureGlobalRemoteConfigWorkspacePath()
}

export async function refreshSdkRemoteConfig(
	controller: Controller,
	options: RefreshSdkRemoteConfigOptions = {},
): Promise<boolean> {
	const controlPlane = new SdkRemoteConfigControlPlane(controller)
	const workspacePath = await getRemoteConfigWorkspacePath(options.workspacePath)
	let candidateIntegration: Awaited<ReturnType<typeof prepareRemoteConfigCoreIntegration>> | undefined
	let shouldPostState = false
	let outcome: "applied" | "cleared" | "failed" | "superseded" = "failed"
	let configVersion: string | undefined
	const startedAt = Date.now()
	const isCurrent = options.isCurrent ?? (() => true)

	try {
		try {
			candidateIntegration = await prepareRemoteConfigCoreIntegration({
				workspacePath,
				rootPath: options.rootPath,
				controlPlane,
				useCachedBundle: false,
			})

			if (!isCurrent()) {
				await candidateIntegration.dispose()
				outcome = "superseded"
				return false
			}

			const remoteConfig = controlPlane.getLastRemoteConfig()
			await withPublicationLock(controller, async () => {
				if (!isCurrent()) {
					await candidateIntegration?.dispose()
					candidateIntegration = undefined
					outcome = "superseded"
					return
				}
				controller.setRemoteConfigAvailable(controlPlane.isRemoteConfigAvailable())

				if (!remoteConfig) {
					await candidateIntegration?.dispose()
					candidateIntegration = undefined
					await clearMaterializedRuntimeBestEffort(workspacePath)
					clearRemoteConfig()
					await controller.setRemoteConfigCoreIntegration(undefined)
					shouldPostState = true
					outcome = "cleared"
					return
				}

				// Compatibility application and SDK publication are serialized. If this
				// generation becomes stale during application, the newer generation runs
				// next and is guaranteed to leave the final shared state authoritative.
				const configuredKeys: ConfiguredAPIKeys = controlPlane.getLastConfiguredKeys()
				await applyRemoteConfig(remoteConfig, configuredKeys, controller.mcpHub)
				if (!isCurrent()) {
					await candidateIntegration?.dispose()
					candidateIntegration = undefined
					outcome = "superseded"
					return
				}
				const publishedOrganizationId = candidateIntegration?.prepared.bundle?.metadata?.organizationId as
					| string
					| undefined
				await controller.setRemoteConfigCoreIntegration(candidateIntegration)
				candidateIntegration = undefined // Ownership transferred to the controller.
				controller.stateManager.setGlobalState(
					"lastManagedOrganizationId",
					publishedOrganizationId ?? controller.authService.getActiveOrganizationId() ?? undefined,
				)
				shouldPostState = true
				outcome = "applied"
				configVersion = remoteConfig.version
			})
		} catch (error) {
			if (candidateIntegration) {
				await candidateIntegration.dispose().catch((disposeError) => {
					Logger.error("[RemoteConfig] Failed to dispose unpublished SDK remote config integration:", disposeError)
				})
			}
			if (controlPlane.wasExplicitNoConfig()) {
				await withPublicationLock(controller, async () => {
					if (!isCurrent()) {
						outcome = "superseded"
						return
					}
					controller.setRemoteConfigAvailable(controlPlane.isRemoteConfigAvailable())
					await clearMaterializedRuntimeBestEffort(workspacePath)
					clearRemoteConfig()
					await controller.setRemoteConfigCoreIntegration(undefined)
					shouldPostState = true
					outcome = "cleared"
				})
			} else {
				Logger.error("[RemoteConfig] Failed to refresh SDK remote config; keeping previous config:", error)
				return false
			}
		}

		if (shouldPostState) {
			await controller.postStateToWebview()
		}
		return isCurrent()
	} finally {
		void telemetryService.captureRemoteConfigRefresh({
			outcome,
			durationMs: Date.now() - startedAt,
			managed: Boolean(controller.authService.getActiveOrganizationId()),
			configVersion,
		})
	}
}
