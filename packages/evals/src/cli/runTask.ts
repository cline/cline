import * as fs from "fs"
import * as path from "path"
import * as os from "node:os"

import pWaitFor from "p-wait-for"
import { execa } from "execa"

import {
	RooCodeEventName,
	IpcOrigin,
	IpcMessageType,
	TaskCommandName,
	type TaskEvent,
	EVALS_SETTINGS,
	EVALS_TIMEOUT,
} from "@roo-code/types"
import { IpcClient } from "@roo-code/ipc"

import { type Run, type Task, updateTask, createTaskMetrics, updateTaskMetrics, createToolError } from "../db/index.js"
import { exercisesPath } from "../exercises/index.js"

import { getTag, isDockerContainer } from "./utils.js"

type RunTaskOptions = {
	run: Run
	task: Task
	publish: (taskEvent: TaskEvent) => Promise<void>
}

export const runTask = async ({ run, task, publish }: RunTaskOptions): Promise<{ success: boolean }> => {
	const { language, exercise } = task
	const tag = getTag("runTask", { run, task })

	const prompt = fs.readFileSync(path.resolve(exercisesPath, `prompts/${language}.md`), "utf-8")
	const workspacePath = path.resolve(exercisesPath, language, exercise)
	const taskSocketPath = path.resolve(os.tmpdir(), `evals-${run.id}-${task.id}.sock`)

	// Inject foot gun system prompt if present.
	if (process.env.FOOTGUN_SYSTEM_PROMPT) {
		const rooDir = path.join(workspacePath, ".roo")

		if (!fs.existsSync(rooDir)) {
			fs.mkdirSync(rooDir, { recursive: true })
		}

		fs.writeFileSync(path.join(rooDir, "system-prompt-code"), process.env.FOOTGUN_SYSTEM_PROMPT)
	}

	console.log(`[${Date.now()} | ${tag}] Opening new VS Code window at ${workspacePath}`)

	const controller = new AbortController()
	const cancelSignal = controller.signal

	const codeCommand = isDockerContainer()
		? `xvfb-run --auto-servernum --server-num=1 code --wait --log trace --disable-workspace-trust --disable-gpu --disable-lcd-text --no-sandbox --user-data-dir /roo/.vscode --password-store="basic"`
		: `code --disable-workspace-trust`

	console.log(`[${Date.now()} | ${tag}] ${codeCommand}`)

	// Sleep for a random amount of time between 5 and 10 seconds.
	await new Promise((resolve) => setTimeout(resolve, Math.random() * 5_000 + 5_000))

	const subprocess = execa({
		env: {
			ROO_CODE_IPC_SOCKET_PATH: taskSocketPath,
		},
		shell: "/bin/bash",
		cancelSignal,
	})`${codeCommand} -n ${workspacePath}`

	// If debugging:
	subprocess.stdout.pipe(process.stdout)

	// Give VSCode some time to spawn before connecting to its unix socket.
	await new Promise((resolve) => setTimeout(resolve, 3_000))
	let client: IpcClient | undefined = undefined
	let attempts = 5

	while (true) {
		try {
			console.log(`[${Date.now()} | ${tag}] connecting to ${taskSocketPath}`)
			client = new IpcClient(taskSocketPath)
			await pWaitFor(() => client!.isReady, { interval: 250, timeout: 1_000 })
			break
		} catch (_error) {
			if (client) {
				client.disconnect()
			}

			attempts--

			if (attempts <= 0) {
				console.error(`[${Date.now()} | ${tag}] unable to connect`)
				return { success: false }
			}
		}
	}

	console.log(`[${Date.now()} | ${tag}] connected to ${taskSocketPath}`)

	let taskStartedAt = Date.now()
	let taskFinishedAt: number | undefined
	let taskMetricsId: number | undefined
	let rooTaskId: string | undefined
	let isClientDisconnected = false

	const ignoreEvents: Record<"broadcast" | "log", RooCodeEventName[]> = {
		broadcast: [RooCodeEventName.Message],
		log: [RooCodeEventName.TaskTokenUsageUpdated], // [RooCodeEventName.Message, RooCodeEventName.TaskAskResponded],
	}

	client.on(IpcMessageType.TaskEvent, async (taskEvent) => {
		const { eventName, payload } = taskEvent

		if (!ignoreEvents.broadcast.includes(eventName)) {
			await publish({ ...taskEvent, taskId: task.id })
		}

		if (!ignoreEvents.log.includes(eventName)) {
			console.log(`[${Date.now()} | ${tag}] ${eventName} ->`, payload)
		}

		if (eventName === RooCodeEventName.TaskStarted) {
			taskStartedAt = Date.now()

			const taskMetrics = await createTaskMetrics({
				cost: 0,
				tokensIn: 0,
				tokensOut: 0,
				tokensContext: 0,
				duration: 0,
				cacheWrites: 0,
				cacheReads: 0,
			})

			await updateTask(task.id, { taskMetricsId: taskMetrics.id, startedAt: new Date() })

			taskStartedAt = Date.now()
			taskMetricsId = taskMetrics.id
			rooTaskId = payload[0]
		}

		if (eventName === RooCodeEventName.TaskToolFailed) {
			const [_taskId, toolName, error] = payload
			await createToolError({ taskId: task.id, toolName, error })
		}

		if (
			(eventName === RooCodeEventName.TaskTokenUsageUpdated || eventName === RooCodeEventName.TaskCompleted) &&
			taskMetricsId
		) {
			const duration = Date.now() - taskStartedAt

			const { totalCost, totalTokensIn, totalTokensOut, contextTokens, totalCacheWrites, totalCacheReads } =
				payload[1]

			await updateTaskMetrics(taskMetricsId, {
				cost: totalCost,
				tokensIn: totalTokensIn,
				tokensOut: totalTokensOut,
				tokensContext: contextTokens,
				duration,
				cacheWrites: totalCacheWrites ?? 0,
				cacheReads: totalCacheReads ?? 0,
			})
		}

		if (eventName === RooCodeEventName.TaskCompleted && taskMetricsId) {
			const toolUsage = payload[2]
			await updateTaskMetrics(taskMetricsId, { toolUsage })
		}

		if (eventName === RooCodeEventName.TaskAborted || eventName === RooCodeEventName.TaskCompleted) {
			taskFinishedAt = Date.now()
			await updateTask(task.id, { finishedAt: new Date() })
		}
	})

	client.on(IpcMessageType.Disconnect, async () => {
		console.log(`[${Date.now()} | ${tag}] disconnect`)
		isClientDisconnected = true
	})

	if (client.isReady) {
		const configuration = {
			...EVALS_SETTINGS,
			...run.settings,
			openRouterApiKey: process.env.OPENROUTER_API_KEY,
		}

		client.sendMessage({
			type: IpcMessageType.TaskCommand,
			origin: IpcOrigin.Client,
			clientId: client.clientId!,
			data: {
				commandName: TaskCommandName.StartNewTask,
				data: {
					configuration,
					text: prompt,
					newTab: true,
				},
			},
		})
	} else {
		console.error(`[${Date.now()} | ${tag}] unable to connect`)
		client.disconnect()
		taskFinishedAt = Date.now()
		isClientDisconnected = true
	}

	try {
		await pWaitFor(() => !!taskFinishedAt || isClientDisconnected, { interval: 1_000, timeout: EVALS_TIMEOUT })
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
	} catch (error) {
		console.log(`[${Date.now()} | ${tag}] time limit reached`)

		// Cancel the task.
		if (rooTaskId && !isClientDisconnected) {
			client.sendMessage({
				type: IpcMessageType.TaskCommand,
				origin: IpcOrigin.Client,
				clientId: client.clientId!,
				data: { commandName: TaskCommandName.CancelTask, data: rooTaskId },
			})

			// Allow some time for the task to cancel.
			await new Promise((resolve) => setTimeout(resolve, 5_000))
		}

		await updateTask(task.id, { finishedAt: new Date() })
	}

	if (!isClientDisconnected) {
		if (rooTaskId) {
			client.sendMessage({
				type: IpcMessageType.TaskCommand,
				origin: IpcOrigin.Client,
				clientId: client.clientId!,
				data: { commandName: TaskCommandName.CloseTask, data: rooTaskId },
			})

			// Allow some time for the window to close.
			await new Promise((resolve) => setTimeout(resolve, 2_000))
		}

		client.disconnect()
	}

	controller.abort()
	await subprocess

	return { success: !!taskFinishedAt }
}
