import * as fs from "fs/promises"
import * as path from "path"

import * as vscode from "vscode"

import { RooCodeAPI, TokenUsage } from "../../src/exports/roo-code"

import { waitUntilReady, waitUntilCompleted, sleep } from "./utils"

export async function run() {
	/**
	 * Validate environment variables.
	 */

	const runId = process.env.RUN_ID
	const openRouterApiKey = process.env.OPENROUTER_API_KEY
	const openRouterModelId = process.env.OPENROUTER_MODEL_ID
	const promptPath = process.env.PROMPT_PATH
	const workspacePath = process.env.WORKSPACE_PATH

	if (!runId || !openRouterApiKey || !openRouterModelId || !promptPath || !workspacePath) {
		throw new Error("ENV not configured.")
	}

	const prompt = await fs.readFile(promptPath, "utf-8")

	/**
	 * Activate the extension.
	 */

	const extension = vscode.extensions.getExtension<RooCodeAPI>("RooVeterinaryInc.roo-cline")

	if (!extension) {
		throw new Error("Extension not found.")
	}

	const api = extension.isActive ? extension.exports : await extension.activate()

	/**
	 * Wait for the Roo Code to be ready to accept tasks.
	 */

	await waitUntilReady({ api })

	/**
	 * Configure Roo Code as needed.
	 *
	 * Use Claude 3.7 Sonnet via OpenRouter.
	 * Don't require approval for anything.
	 * Run any command without approval.
	 * Disable checkpoints (for performance).
	 */

	await api.setConfiguration({
		apiProvider: "openrouter",
		openRouterApiKey,
		openRouterModelId,
		autoApprovalEnabled: true,
		alwaysAllowReadOnly: true,
		alwaysAllowWrite: true,
		alwaysAllowExecute: true,
		alwaysAllowBrowser: true,
		alwaysApproveResubmit: true,
		alwaysAllowMcp: true,
		alwaysAllowModeSwitch: true,
		enableCheckpoints: false,
	})

	await vscode.workspace
		.getConfiguration("roo-cline")
		.update("allowedCommands", ["*"], vscode.ConfigurationTarget.Global)

	await sleep(2_000)

	/**
	 * Run the task and wait up to 10 minutes for it to complete.
	 */

	const startTime = Date.now()
	const taskId = await api.startNewTask(prompt)

	let usage: TokenUsage | undefined = undefined

	try {
		usage = await waitUntilCompleted({ api, taskId, timeout: 5 * 60 * 1_000 }) // 5m
	} catch (e) {
		usage = api.getTokenUsage(taskId)
	}

	if (usage) {
		const content = JSON.stringify({ runId: parseInt(runId), ...usage, duration: Date.now() - startTime }, null, 2)
		await fs.writeFile(path.resolve(workspacePath, "usage.json"), content)
	}
}
