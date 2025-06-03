import * as fs from "fs"
import * as path from "path"

import pWaitFor from "p-wait-for"
import { execa, parseCommandString } from "execa"
import { command, run, number, positional } from "cmd-ts"
import psTree from "ps-tree"

import { RooCodeEventName, IpcOrigin, IpcMessageType, TaskCommandName } from "@roo-code/types"
import { IpcServer, IpcClient } from "@roo-code/ipc"

import {
	type Run,
	type Task,
	findRun,
	finishRun,
	getTasks,
	updateTask,
	createTaskMetrics,
	updateTaskMetrics,
	createToolError,
} from "../db/index.js"
import { type ExerciseLanguage, exercisesPath } from "../exercises/index.js"

type TaskResult = { success: boolean }
type TaskPromise = Promise<TaskResult>

const TASK_START_DELAY = 10 * 1_000
const TASK_TIMEOUT = 5 * 60 * 1_000
const UNIT_TEST_TIMEOUT = 2 * 60 * 1_000

const testCommands: Record<ExerciseLanguage, { commands: string[]; timeout?: number; cwd?: string }> = {
	go: { commands: ["go test"] }, // timeout 15s bash -c "cd '$dir' && go test > /dev/null 2>&1"
	java: { commands: ["./gradlew test"] }, // timeout --foreground 15s bash -c "cd '$dir' && ./gradlew test > /dev/null 2>&1"
	javascript: { commands: ["pnpm install", "pnpm test"] }, // timeout 15s bash -c "cd '$dir' && pnpm install >/dev/null 2>&1 && pnpm test >/dev/null 2>&1"
	python: { commands: ["uv run python3 -m pytest -o markers=task *_test.py"] }, // timeout 15s bash -c "cd '$dir' && uv run python3 -m pytest -o markers=task *_test.py"
	rust: { commands: ["cargo test"] }, // timeout 15s bash -c "cd '$dir' && cargo test > /dev/null 2>&1"
}

const runEvals = async (id: number) => {
	const run = await findRun(id)
	const tasks = await getTasks(run.id)

	if (!tasks[0]) {
		throw new Error("No tasks found.")
	}

	await execa({ cwd: exercisesPath })`git config user.name "Roo Code"`
	await execa({ cwd: exercisesPath })`git config user.email "support@roocode.com"`
	await execa({ cwd: exercisesPath })`git checkout -f`
	await execa({ cwd: exercisesPath })`git clean -fd`
	await execa({ cwd: exercisesPath })`git checkout -b runs/${run.id}-${crypto.randomUUID().slice(0, 8)} main`

	const server = new IpcServer(run.socketPath, () => {})
	server.listen()

	const runningPromises: TaskPromise[] = []

	const processTask = async (task: Task, delay = 0) => {
		if (task.finishedAt === null) {
			await new Promise((resolve) => setTimeout(resolve, delay))
			await runExercise({ run, task, server })
		}

		if (task.passed === null) {
			const passed = await runUnitTest({ task })
			await updateTask(task.id, { passed })

			server.broadcast({
				type: IpcMessageType.TaskEvent,
				origin: IpcOrigin.Server,
				data: { eventName: passed ? RooCodeEventName.EvalPass : RooCodeEventName.EvalFail, taskId: task.id },
			})

			return { success: passed }
		} else {
			return { success: task.passed }
		}
	}

	const processTaskResult = async (task: Task, promise: TaskPromise) => {
		const index = runningPromises.indexOf(promise)

		if (index > -1) {
			runningPromises.splice(index, 1)
		}
	}

	let delay = TASK_START_DELAY

	for (const task of tasks) {
		const promise = processTask(task, delay)
		delay = delay + TASK_START_DELAY
		runningPromises.push(promise)
		promise.then(() => processTaskResult(task, promise))

		if (runningPromises.length >= run.concurrency) {
			delay = 0
			await Promise.race(runningPromises)
		}
	}

	await Promise.all(runningPromises)

	const result = await finishRun(run.id)
	console.log(`${Date.now()} [cli#run]`, result)

	await execa({ cwd: exercisesPath })`git add .`
	await execa({ cwd: exercisesPath })`git commit -m ${`Run #${run.id}`} --no-verify`
}

const runExercise = async ({ run, task, server }: { run: Run; task: Task; server: IpcServer }): TaskPromise => {
	const { language, exercise } = task
	const prompt = fs.readFileSync(path.resolve(exercisesPath, `prompts/${language}.md`), "utf-8")
	const dirname = path.dirname(run.socketPath)
	const workspacePath = path.resolve(exercisesPath, language, exercise)
	const taskSocketPath = path.resolve(dirname, `${dirname}/task-${task.id}.sock`)

	// Inject foot gun system prompt if present
	if (process.env.FOOTGUN_SYSTEM_PROMPT) {
		const rooDir = path.join(workspacePath, ".roo")
		if (!fs.existsSync(rooDir)) {
			fs.mkdirSync(rooDir, { recursive: true })
		}
		fs.writeFileSync(path.join(rooDir, "system-prompt-code"), process.env.FOOTGUN_SYSTEM_PROMPT)
	}

	// If debugging:
	// Use --wait --log trace or --verbose.
	// Don't await execa and store result as subprocess.
	// subprocess.stdout.pipe(process.stdout)

	console.log(`${Date.now()} [cli#runExercise] Opening new VS Code window at ${workspacePath}`)

	const controller = new AbortController()
	const cancelSignal = controller.signal

	// If debugging:
	// Use --wait --log trace or --verbose.
	let codeCommand = `code --disable-workspace-trust`
	const isDocker = fs.existsSync("/.dockerenv")

	if (isDocker) {
		if (run.concurrency > 1) {
			throw new Error("Cannot run multiple tasks in parallel in Docker. Please set concurrency to 1.")
		}
		codeCommand = `xvfb-run --auto-servernum --server-num=1 ${codeCommand} --wait --log trace --disable-gpu --password-store="basic"`
	}

	const subprocess = execa({
		env: {
			ROO_CODE_IPC_SOCKET_PATH: taskSocketPath,
		},
		shell: "/bin/bash",
		cancelSignal,
	})`${codeCommand} -n ${workspacePath}`

	// If debugging:
	// subprocess.stdout.pipe(process.stdout)

	// Give VSCode some time to spawn before connecting to its unix socket.
	await new Promise((resolve) => setTimeout(resolve, 3_000))
	console.log(`${Date.now()} [cli#runExercise] Connecting to ${taskSocketPath}`)
	const client = new IpcClient(taskSocketPath)

	try {
		await pWaitFor(() => client.isReady, { interval: 250, timeout: 5_000 })
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
	} catch (error) {
		console.log(`${Date.now()} [cli#runExercise | ${language} / ${exercise}] unable to connect`)
		client.disconnect()
		return { success: false }
	}

	let taskStartedAt = Date.now()
	let taskFinishedAt: number | undefined
	let taskMetricsId: number | undefined
	let rooTaskId: string | undefined
	let isClientDisconnected = false

	const ignoreEvents: Record<"broadcast" | "log", RooCodeEventName[]> = {
		broadcast: [RooCodeEventName.Message],
		log: [RooCodeEventName.Message, RooCodeEventName.TaskTokenUsageUpdated, RooCodeEventName.TaskAskResponded],
	}

	client.on(IpcMessageType.TaskEvent, async (taskEvent) => {
		const { eventName, payload } = taskEvent

		if (!ignoreEvents.broadcast.includes(eventName)) {
			server.broadcast({
				type: IpcMessageType.TaskEvent,
				origin: IpcOrigin.Server,
				relayClientId: client.clientId!,
				data: { ...taskEvent, taskId: task.id },
			})
		}

		if (!ignoreEvents.log.includes(eventName)) {
			console.log(
				`${Date.now()} [cli#runExercise | ${language} / ${exercise}] taskEvent -> ${eventName}`,
				payload,
			)
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
		console.log(`${Date.now()} [cli#runExercise | ${language} / ${exercise}] disconnect`)
		isClientDisconnected = true
	})

	console.log(`${Date.now()} [cli#runExercise | ${language} / ${exercise}] starting task`)

	if (client.isReady) {
		client.sendMessage({
			type: IpcMessageType.TaskCommand,
			origin: IpcOrigin.Client,
			clientId: client.clientId!,
			data: {
				commandName: TaskCommandName.StartNewTask,
				data: {
					configuration: {
						openRouterApiKey: process.env.OPENROUTER_API_KEY!,
						...run.settings,
					},
					text: prompt,
					newTab: true,
				},
			},
		})
	} else {
		console.log(`[cli#runExercise | ${language} / ${exercise}] unable to connect`)
		client.disconnect()
		taskFinishedAt = Date.now()
		isClientDisconnected = true
	}

	try {
		await pWaitFor(() => !!taskFinishedAt || isClientDisconnected, { interval: 1_000, timeout: TASK_TIMEOUT })
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
	} catch (error) {
		console.log(`${Date.now()} [cli#runExercise | ${language} / ${exercise}] time limit reached`)

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

const runUnitTest = async ({ task }: { task: Task }) => {
	const cmd = testCommands[task.language]
	const exercisePath = path.resolve(exercisesPath, task.language, task.exercise)
	const cwd = cmd.cwd ? path.resolve(exercisePath, cmd.cwd) : exercisePath
	const commands = cmd.commands.map((cs) => parseCommandString(cs))

	let passed = true

	for (const command of commands) {
		try {
			console.log(
				`${Date.now()} [cli#runUnitTest | ${task.language} / ${task.exercise}] running "${command.join(" ")}"`,
			)

			const subprocess = execa({ cwd, shell: true, reject: false })`${command}`

			const timeout = setTimeout(async () => {
				const descendants = await new Promise<number[]>((resolve, reject) => {
					psTree(subprocess.pid!, (err, children) => {
						if (err) {
							reject(err)
						}

						resolve(children.map((p) => parseInt(p.PID)))
					})
				})

				console.log(
					`${Date.now()} [cli#runUnitTest | ${task.language} / ${task.exercise}] "${command.join(" ")}": unit tests timed out, killing ${subprocess.pid} + ${JSON.stringify(descendants)}`,
				)

				if (descendants.length > 0) {
					for (const descendant of descendants) {
						try {
							console.log(
								`${Date.now()} [cli#runUnitTest | ${task.language} / ${task.exercise}] killing ${descendant}`,
							)

							await execa`kill -9 ${descendant}`
						} catch (error) {
							console.error(
								`${Date.now()} [cli#runUnitTest | ${task.language} / ${task.exercise}] Error killing descendant processes:`,
								error,
							)
						}
					}
				}

				console.log(
					`${Date.now()} [cli#runUnitTest | ${task.language} / ${task.exercise}] killing ${subprocess.pid}`,
				)

				try {
					await execa`kill -9 ${subprocess.pid!}`
				} catch (error) {
					console.error(
						`${Date.now()} [cli#runUnitTest | ${task.language} / ${task.exercise}] Error killing process:`,
						error,
					)
				}
			}, UNIT_TEST_TIMEOUT)

			const result = await subprocess

			console.log(
				`${Date.now()} [cli#runUnitTest | ${task.language} / ${task.exercise}] "${command.join(" ")}" result -> ${JSON.stringify(result)}`,
			)

			clearTimeout(timeout)

			if (result.failed) {
				passed = false
				break
			}
		} catch (error) {
			console.log(`${Date.now()} [cli#runUnitTest | ${task.language} / ${task.exercise}]`, error)
			passed = false
			break
		}
	}

	return passed
}

const main = async () => {
	const result = await run(
		command({
			name: "cli",
			description: "Execute an eval run.",
			version: "0.0.0",
			args: {
				runId: positional({ type: number, displayName: "runId" }),
			},
			handler: (args) => runEvals(args.runId),
		}),
		process.argv.slice(2),
	)

	console.log(result)
	process.exit(0)
}

if (!fs.existsSync(exercisesPath)) {
	console.error(
		`Exercises do not exist at ${exercisesPath}. Please run "git clone https://github.com/RooCodeInc/Roo-Code-Evals.git evals".`,
	)
	process.exit(1)
}

main()
