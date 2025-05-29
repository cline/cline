import pWaitFor from "p-wait-for"
import * as vscode from "vscode"

import { TelemetryService } from "@roo-code/telemetry"

import { Task } from "../task/Task"

import { getWorkspacePath } from "../../utils/path"

import { ClineApiReqInfo } from "../../shared/ExtensionMessage"
import { getApiMetrics } from "../../shared/getApiMetrics"

import { DIFF_VIEW_URI_SCHEME } from "../../integrations/editor/DiffViewProvider"

import { CheckpointServiceOptions, RepoPerTaskCheckpointService } from "../../services/checkpoints"

export function getCheckpointService(cline: Task) {
	if (!cline.enableCheckpoints) {
		return undefined
	}

	if (cline.checkpointService) {
		return cline.checkpointService
	}

	if (cline.checkpointServiceInitializing) {
		console.log("[Cline#getCheckpointService] checkpoint service is still initializing")
		return undefined
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

	console.log("[Cline#getCheckpointService] initializing checkpoints service")

	try {
		const workspaceDir = getWorkspacePath()

		if (!workspaceDir) {
			log("[Cline#getCheckpointService] workspace folder not found, disabling checkpoints")
			cline.enableCheckpoints = false
			return undefined
		}

		const globalStorageDir = provider?.context.globalStorageUri.fsPath

		if (!globalStorageDir) {
			log("[Cline#getCheckpointService] globalStorageDir not found, disabling checkpoints")
			cline.enableCheckpoints = false
			return undefined
		}

		const options: CheckpointServiceOptions = {
			taskId: cline.taskId,
			workspaceDir,
			shadowDir: globalStorageDir,
			log,
		}

		const service = RepoPerTaskCheckpointService.create(options)

		cline.checkpointServiceInitializing = true

		service.on("initialize", () => {
			log("[Cline#getCheckpointService] service initialized")

			try {
				const isCheckpointNeeded =
					typeof cline.clineMessages.find(({ say }) => say === "checkpoint_saved") === "undefined"

				cline.checkpointService = service
				cline.checkpointServiceInitializing = false

				if (isCheckpointNeeded) {
					log("[Cline#getCheckpointService] no checkpoints found, saving initial checkpoint")
					checkpointSave(cline)
				}
			} catch (err) {
				log("[Cline#getCheckpointService] caught error in on('initialize'), disabling checkpoints")
				cline.enableCheckpoints = false
			}
		})

		service.on("checkpoint", ({ isFirst, fromHash: from, toHash: to }) => {
			try {
				provider?.postMessageToWebview({ type: "currentCheckpointUpdated", text: to })

				cline
					.say("checkpoint_saved", to, undefined, undefined, { isFirst, from, to }, undefined, {
						isNonInteractive: true,
					})
					.catch((err) => {
						log("[Cline#getCheckpointService] caught unexpected error in say('checkpoint_saved')")
						console.error(err)
					})
			} catch (err) {
				log("[Cline#getCheckpointService] caught unexpected error in on('checkpoint'), disabling checkpoints")
				console.error(err)
				cline.enableCheckpoints = false
			}
		})

		log("[Cline#getCheckpointService] initializing shadow git")

		service.initShadowGit().catch((err) => {
			log(
				`[Cline#getCheckpointService] caught unexpected error in initShadowGit, disabling checkpoints (${err.message})`,
			)

			console.error(err)
			cline.enableCheckpoints = false
		})

		return service
	} catch (err) {
		log("[Cline#getCheckpointService] caught unexpected error, disabling checkpoints")
		cline.enableCheckpoints = false
		return undefined
	}
}

async function getInitializedCheckpointService(
	cline: Task,
	{ interval = 250, timeout = 15_000 }: { interval?: number; timeout?: number } = {},
) {
	const service = getCheckpointService(cline)

	if (!service || service.isInitialized) {
		return service
	}

	try {
		await pWaitFor(
			() => {
				console.log("[Cline#getCheckpointService] waiting for service to initialize")
				return service.isInitialized
			},
			{ interval, timeout },
		)

		return service
	} catch (err) {
		return undefined
	}
}

export async function checkpointSave(cline: Task, force = false) {
	const service = getCheckpointService(cline)

	if (!service) {
		return
	}

	if (!service.isInitialized) {
		const provider = cline.providerRef.deref()
		provider?.log("[checkpointSave] checkpoints didn't initialize in time, disabling checkpoints for this task")
		cline.enableCheckpoints = false
		return
	}

	TelemetryService.instance.captureCheckpointCreated(cline.taskId)

	// Start the checkpoint process in the background.
	return service.saveCheckpoint(`Task: ${cline.taskId}, Time: ${Date.now()}`, { allowEmpty: force }).catch((err) => {
		console.error("[Cline#checkpointSave] caught unexpected error, disabling checkpoints", err)
		cline.enableCheckpoints = false
	})
}

export type CheckpointRestoreOptions = {
	ts: number
	commitHash: string
	mode: "preview" | "restore"
}

export async function checkpointRestore(cline: Task, { ts, commitHash, mode }: CheckpointRestoreOptions) {
	const service = await getInitializedCheckpointService(cline)

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
	const service = await getInitializedCheckpointService(cline)

	if (!service) {
		return
	}

	TelemetryService.instance.captureCheckpointDiffed(cline.taskId)

	if (!previousCommitHash && mode === "checkpoint") {
		const previousCheckpoint = cline.clineMessages
			.filter(({ say }) => say === "checkpoint_saved")
			.sort((a, b) => b.ts - a.ts)
			.find((message) => message.ts < ts)

		previousCommitHash = previousCheckpoint?.text
	}

	try {
		const changes = await service.getDiff({ from: previousCommitHash, to: commitHash })

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
