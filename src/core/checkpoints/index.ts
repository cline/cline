import pWaitFor from "p-wait-for"
import * as vscode from "vscode"

import { TelemetryService } from "@roo-code/telemetry"

import { Task } from "../task/Task"

import { getWorkspacePath } from "../../utils/path"
import { checkGitInstalled } from "../../utils/git"
import { t } from "../../i18n"

import { ClineApiReqInfo } from "../../shared/ExtensionMessage"
import { getApiMetrics } from "../../shared/getApiMetrics"

import { DIFF_VIEW_URI_SCHEME } from "../../integrations/editor/DiffViewProvider"

import { CheckpointServiceOptions, RepoPerTaskCheckpointService } from "../../services/checkpoints"

export async function getCheckpointService(
	cline: Task,
	{ interval = 250, timeout = 15_000 }: { interval?: number; timeout?: number } = {},
) {
	if (!cline.enableCheckpoints) {
		return undefined
	}
	if (cline.checkpointService) {
		return cline.checkpointService
	}

	const provider = cline.providerRef.deref()

	const log = (message: string) => {
		console.log(message)

		try {
			provider?.log(message)
		} catch (err) {
			// NO-OP
		}
	}

	console.log("[Task#getCheckpointService] initializing checkpoints service")

	try {
		const workspaceDir = getWorkspacePath()

		if (!workspaceDir) {
			log("[Task#getCheckpointService] workspace folder not found, disabling checkpoints")
			cline.enableCheckpoints = false
			return undefined
		}

		const globalStorageDir = provider?.context.globalStorageUri.fsPath

		if (!globalStorageDir) {
			log("[Task#getCheckpointService] globalStorageDir not found, disabling checkpoints")
			cline.enableCheckpoints = false
			return undefined
		}

		const options: CheckpointServiceOptions = {
			taskId: cline.taskId,
			workspaceDir,
			shadowDir: globalStorageDir,
			log,
		}
		if (cline.checkpointServiceInitializing) {
			await pWaitFor(
				() => {
					console.log("[Task#getCheckpointService] waiting for service to initialize")
					return !!cline.checkpointService && !!cline?.checkpointService?.isInitialized
				},
				{ interval, timeout },
			)
			if (!cline?.checkpointService) {
				cline.enableCheckpoints = false
				return undefined
			}
			return cline.checkpointService
		}
		if (!cline.enableCheckpoints) {
			return undefined
		}
		const service = RepoPerTaskCheckpointService.create(options)
		cline.checkpointServiceInitializing = true
		await checkGitInstallation(cline, service, log, provider)
		cline.checkpointService = service
		return service
	} catch (err) {
		log(`[Task#getCheckpointService] ${err.message}`)
		cline.enableCheckpoints = false
		cline.checkpointServiceInitializing = false
		return undefined
	}
}

async function checkGitInstallation(
	cline: Task,
	service: RepoPerTaskCheckpointService,
	log: (message: string) => void,
	provider: any,
) {
	try {
		const gitInstalled = await checkGitInstalled()

		if (!gitInstalled) {
			log("[Task#getCheckpointService] Git is not installed, disabling checkpoints")
			cline.enableCheckpoints = false
			cline.checkpointServiceInitializing = false

			// Show user-friendly notification
			const selection = await vscode.window.showWarningMessage(
				t("common:errors.git_not_installed"),
				t("common:buttons.learn_more"),
			)

			if (selection === t("common:buttons.learn_more")) {
				await vscode.env.openExternal(vscode.Uri.parse("https://git-scm.com/downloads"))
			}

			return
		}

		// Git is installed, proceed with initialization
		service.on("initialize", () => {
			log("[Task#getCheckpointService] service initialized")
			cline.checkpointServiceInitializing = false
		})

		service.on("checkpoint", ({ fromHash: from, toHash: to }) => {
			try {
				provider?.postMessageToWebview({ type: "currentCheckpointUpdated", text: to })

				cline
					.say("checkpoint_saved", to, undefined, undefined, { from, to }, undefined, {
						isNonInteractive: true,
					})
					.catch((err) => {
						log("[Task#getCheckpointService] caught unexpected error in say('checkpoint_saved')")
						console.error(err)
					})
			} catch (err) {
				log("[Task#getCheckpointService] caught unexpected error in on('checkpoint'), disabling checkpoints")
				console.error(err)
				cline.enableCheckpoints = false
			}
		})

		log("[Task#getCheckpointService] initializing shadow git")
		try {
			await service.initShadowGit()
		} catch (err) {
			log(`[Task#getCheckpointService] initShadowGit -> ${err.message}`)
			cline.enableCheckpoints = false
		}
	} catch (err) {
		log(`[Task#getCheckpointService] Unexpected error during Git check: ${err.message}`)
		console.error("Git check error:", err)
		cline.enableCheckpoints = false
		cline.checkpointServiceInitializing = false
	}
}

export async function checkpointSave(cline: Task, force = false) {
	const service = await getCheckpointService(cline)

	if (!service) {
		return
	}

	TelemetryService.instance.captureCheckpointCreated(cline.taskId)

	// Start the checkpoint process in the background.
	return service.saveCheckpoint(`Task: ${cline.taskId}, Time: ${Date.now()}`, { allowEmpty: force }).catch((err) => {
		console.error("[Task#checkpointSave] caught unexpected error, disabling checkpoints", err)
		cline.enableCheckpoints = false
	})
}

export type CheckpointRestoreOptions = {
	ts: number
	commitHash: string
	mode: "preview" | "restore"
}

export async function checkpointRestore(cline: Task, { ts, commitHash, mode }: CheckpointRestoreOptions) {
	const service = await getCheckpointService(cline)

	if (!service) {
		return
	}

	const index = cline.clineMessages.findIndex((m) => m.ts === ts)

	if (index === -1) {
		return
	}

	const provider = cline.providerRef.deref()

	try {
		await service.restoreCheckpoint(commitHash)
		TelemetryService.instance.captureCheckpointRestored(cline.taskId)
		await provider?.postMessageToWebview({ type: "currentCheckpointUpdated", text: commitHash })

		if (mode === "restore") {
			await cline.overwriteApiConversationHistory(cline.apiConversationHistory.filter((m) => !m.ts || m.ts < ts))

			const deletedMessages = cline.clineMessages.slice(index + 1)

			const { totalTokensIn, totalTokensOut, totalCacheWrites, totalCacheReads, totalCost } = getApiMetrics(
				cline.combineMessages(deletedMessages),
			)

			await cline.overwriteClineMessages(cline.clineMessages.slice(0, index + 1))

			// TODO: Verify that this is working as expected.
			await cline.say(
				"api_req_deleted",
				JSON.stringify({
					tokensIn: totalTokensIn,
					tokensOut: totalTokensOut,
					cacheWrites: totalCacheWrites,
					cacheReads: totalCacheReads,
					cost: totalCost,
				} satisfies ClineApiReqInfo),
			)
		}

		// The task is already cancelled by the provider beforehand, but we
		// need to re-init to get the updated messages.
		//
		// This was take from Cline's implementation of the checkpoints
		// feature. The cline instance will hang if we don't cancel twice,
		// so this is currently necessary, but it seems like a complicated
		// and hacky solution to a problem that I don't fully understand.
		// I'd like to revisit this in the future and try to improve the
		// task flow and the communication between the webview and the
		// Cline instance.
		provider?.cancelTask()
	} catch (err) {
		provider?.log("[checkpointRestore] disabling checkpoints for this task")
		cline.enableCheckpoints = false
	}
}

export type CheckpointDiffOptions = {
	ts: number
	previousCommitHash?: string
	commitHash: string
	mode: "full" | "checkpoint"
}

export async function checkpointDiff(cline: Task, { ts, previousCommitHash, commitHash, mode }: CheckpointDiffOptions) {
	const service = await getCheckpointService(cline)

	if (!service) {
		return
	}

	TelemetryService.instance.captureCheckpointDiffed(cline.taskId)

	let prevHash = commitHash
	let nextHash: string | undefined

	const checkpoints = typeof service.getCheckpoints === "function" ? service.getCheckpoints() : []
	const idx = checkpoints.indexOf(commitHash)
	if (idx !== -1 && idx < checkpoints.length - 1) {
		nextHash = checkpoints[idx + 1]
	} else {
		nextHash = undefined
	}

	try {
		const changes = await service.getDiff({ from: prevHash, to: nextHash })

		if (!changes?.length) {
			vscode.window.showInformationMessage("No changes found.")
			return
		}

		await vscode.commands.executeCommand(
			"vscode.changes",
			mode === "full" ? "Changes since task started" : "Changes since previous checkpoint",
			changes.map((change) => [
				vscode.Uri.file(change.paths.absolute),
				vscode.Uri.parse(`${DIFF_VIEW_URI_SCHEME}:${change.paths.relative}`).with({
					query: Buffer.from(change.content.before ?? "").toString("base64"),
				}),
				vscode.Uri.parse(`${DIFF_VIEW_URI_SCHEME}:${change.paths.relative}`).with({
					query: Buffer.from(change.content.after ?? "").toString("base64"),
				}),
			]),
		)
	} catch (err) {
		const provider = cline.providerRef.deref()
		provider?.log("[checkpointDiff] disabling checkpoints for this task")
		cline.enableCheckpoints = false
	}
}
