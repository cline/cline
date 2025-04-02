import * as fs from "fs"
import * as path from "path"
import * as os from "os"

import pMap from "p-map"
import pWaitFor from "p-wait-for"
import { execa, parseCommandString } from "execa"
import { build, filesystem, GluegunPrompt, GluegunToolbox } from "gluegun"

import {
	type ExerciseLanguage,
	exerciseLanguages,
	RooCodeEventName,
	IpcOrigin,
	IpcMessageType,
	TaskCommandName,
	rooCodeDefaults,
} from "@evals/types"
import {
	type Run,
	findRun,
	createRun,
	finishRun,
	type Task,
	createTask,
	getTasks,
	updateTask,
	createTaskMetrics,
	updateTaskMetrics,
} from "@evals/db"
import { IpcServer, IpcClient } from "@evals/ipc"

import { __dirname, extensionDevelopmentPath, exercisesPath } from "./paths.js"
import { getExercises } from "./exercises.js"

const maxConcurrency = 2
const taskTimeLimit = 5 * 60 * 1_000

const testCommands: Record<ExerciseLanguage, { commands: string[]; timeout?: number; cwd?: string }> = {
	go: { commands: ["go test"] }, // timeout 15s bash -c "cd '$dir' && go test > /dev/null 2>&1"
	java: { commands: ["./gradlew test"] }, // timeout --foreground 15s bash -c "cd '$dir' && ./gradlew test > /dev/null 2>&1"
	javascript: { commands: ["pnpm install", "pnpm test"], timeout: 30_000 }, // timeout 30s bash -c "cd '$dir' && pnpm install >/dev/null 2>&1 && pnpm test >/dev/null 2>&1"
	python: { commands: ["uv run python3 -m pytest -o markers=task *_test.py"] }, // timeout 15s bash -c "cd '$dir' && uv run python3 -m pytest -o markers=task *_test.py"
	rust: { commands: ["cargo test"] }, // timeout 15s bash -c "cd '$dir' && cargo test > /dev/null 2>&1"
}

const run = async (toolbox: GluegunToolbox) => {
	const { config, prompt } = toolbox

	let { language, exercise } = config

	if (![undefined, ...exerciseLanguages, "all"].includes(language)) {
		throw new Error(`Language is invalid: ${language}`)
	}

	if (!["undefined", "string"].includes(typeof exercise)) {
		throw new Error(`Exercise is invalid: ${exercise}`)
	}

	const id = config.runId ? Number(config.runId) : undefined
	let run: Run

	if (id) {
		run = await findRun(id)
	} else {
		run = await createRun({
			model: rooCodeDefaults.openRouterModelId!,
			pid: process.pid,
			socketPath: path.resolve(os.tmpdir(), `roo-code-evals-${crypto.randomUUID()}.sock`),
		})

		if (language === "all") {
			for (const language of exerciseLanguages) {
				const exercises = getExercises()[language as ExerciseLanguage]

				await pMap(exercises, (exercise) => createTask({ runId: run.id, language, exercise }), {
					concurrency: 10,
				})
			}
		} else if (exercise === "all") {
			const exercises = getExercises()[language as ExerciseLanguage]
			await pMap(exercises, (exercise) => createTask({ runId: run.id, language, exercise }), { concurrency: 10 })
		} else {
			language = language || (await askLanguage(prompt))
			exercise = exercise || (await askExercise(prompt, language))
			await createTask({ runId: run.id, language, exercise })
		}
	}

	const tasks = await getTasks(run.id)

	if (!tasks[0]) {
		throw new Error("No tasks found.")
	}

	console.log(await execa({ cwd: exercisesPath })`git config user.name "Roo Code"`)
	console.log(await execa({ cwd: exercisesPath })`git config user.email "support@roocode.com"`)
	console.log(await execa({ cwd: exercisesPath })`git checkout -f`)
	console.log(await execa({ cwd: exercisesPath })`git clean -fd`)
	console.log(await execa({ cwd: exercisesPath })`git checkout -b runs/${run.id} main`)

	fs.writeFileSync(
		path.resolve(exercisesPath, "settings.json"),
		JSON.stringify({ ...rooCodeDefaults, ...run.settings }, null, 2),
	)

	const server = new IpcServer(run.socketPath, () => {})
	server.listen()

	// server.on(IpcMessageType.Connect, (clientId) => {
	// 	server.send(clientId, {
	// 		type: IpcMessageType.TaskEvent,
	// 		origin: IpcOrigin.Server,
	// 		data: { eventName: RooCodeEventName.Connect, taskId: -1 },
	// 	})
	// })

	const runningPromises: Promise<void>[] = []

	const processTask = async (task: Task) => {
		if (task.finishedAt === null) {
			await runExercise({ run, task, server })
		}

		if (task.passed === null) {
			const passed = await runUnitTest({ task })
			await updateTask(task.id, { passed })
		}
	}

	for (const task of tasks) {
		const taskPromise = processTask(task)
		runningPromises.push(taskPromise)

		taskPromise.finally(() => {
			const index = runningPromises.indexOf(taskPromise)

			if (index > -1) {
				runningPromises.splice(index, 1)
			}
		})

		if (runningPromises.length >= maxConcurrency) {
			await Promise.race(runningPromises)
		}
	}

	await Promise.all(runningPromises)

	const result = await finishRun(run.id)
	try {
		console.log("[cli#run]", result)
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
	} catch (error) {
		// console.error(error)
	}

	console.log(await execa({ cwd: exercisesPath })`git add .`)
	console.log(await execa({ cwd: exercisesPath })`git commit -m ${`Run #${run.id}`} --no-verify`)
}

const runExercise = async ({ run, task, server }: { run: Run; task: Task; server: IpcServer }) => {
	const { language, exercise } = task
	const prompt = fs.readFileSync(path.resolve(exercisesPath, `prompts/${language}.md`), "utf-8")
	const dirname = path.dirname(run.socketPath)
	const taskSocketPath = path.resolve(dirname, `${dirname}/task-${task.id}.sock`)

	const controller = new AbortController()
	const cancelSignal = controller.signal

	// If debugging:
	// Use --wait --log trace or --verbose.
	const codeCommand = `code --disable-workspace-trust`

	await execa({
		env: {
			ROO_CODE_IPC_SOCKET_PATH: taskSocketPath,
		},
		shell: "/bin/bash",
		cancelSignal,
	})`${codeCommand} -n ${path.resolve(exercisesPath, language, exercise)}`

	// If debugging:
	// Don't await execa and store result as subprocess.
	// subprocess.stdout.pipe(process.stdout)

	// Give VSCode some time to spawn before connectint to its unix socket.
	await new Promise((resolve) => setTimeout(resolve, 1_000))
	console.log(`Connecting to ${taskSocketPath}`)

	const createClient = (taskSocketPath: string) => {
		const ipcClient = new IpcClient(taskSocketPath)

		ipcClient.on(IpcMessageType.Ack, (ack) => {
			console.log(`[cli#runExercise | ${language} / ${exercise}] ack`, ack)
		})

		return ipcClient
	}

	let tries = 0
	let client = createClient(taskSocketPath)

	while (++tries < 5) {
		try {
			await pWaitFor(() => client.isReady, { interval: 100, timeout: 5_000 })
			break
		} catch (error) {
			console.error(error)
			client.disconnect()
			client = createClient(taskSocketPath)
		}
	}

	let isTaskFinished = false
	let isClientDisconnected = false

	client.on(IpcMessageType.Disconnect, async () => {
		console.log(`[cli#runExercise | ${language} / ${exercise}] disconnect`)
		isTaskFinished = true
		isClientDisconnected = true
	})

	const ignoreEvents: RooCodeEventName[] = [
		// RooCodeEventName.Message,
		RooCodeEventName.TaskTokenUsageUpdated,
		RooCodeEventName.TaskAskResponded,
	]

	let taskStartedAt = Date.now()
	let taskMetricsId: number | undefined
	let rooTaskId: string | undefined

	client.on(IpcMessageType.TaskEvent, async (taskEvent) => {
		const { eventName, payload } = taskEvent

		server.broadcast({
			type: IpcMessageType.TaskEvent,
			origin: IpcOrigin.Server,
			relayClientId: client.clientId!,
			data: { ...taskEvent, taskId: task.id },
		})

		if (!ignoreEvents.includes(eventName)) {
			console.log(`[cli#runExercise | ${language} / ${exercise}] taskEvent -> ${eventName}`)
			console.log(payload)
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

		if (eventName === RooCodeEventName.TaskCompleted || eventName === RooCodeEventName.TaskAborted) {
			await updateTask(task.id, { finishedAt: new Date() })
			isTaskFinished = true
		}
	})

	if (client.isReady) {
		client.sendMessage({
			type: IpcMessageType.TaskCommand,
			origin: IpcOrigin.Client,
			clientId: client.clientId!,
			data: {
				commandName: TaskCommandName.StartNewTask,
				data: {
					configuration: {
						...rooCodeDefaults,
						openRouterApiKey: process.env.OPENROUTER_API_KEY!,
						...run.settings,
					},
					text: prompt,
					newTab: true,
				},
			},
		})

		console.log(`[cli#runExercise | ${language} / ${exercise}] starting task`)
	} else {
		console.log(`[cli#runExercise | ${language} / ${exercise}] unable to connect`)
		client.disconnect()
		isTaskFinished = true
		isClientDisconnected = true
	}

	try {
		await pWaitFor(() => isTaskFinished, { interval: 1_000, timeout: taskTimeLimit })
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
	} catch (error) {
		console.log(`[cli#runExercise | ${language} / ${exercise}] time limit reached`)

		if (rooTaskId && !isClientDisconnected) {
			client.sendMessage({
				type: IpcMessageType.TaskCommand,
				origin: IpcOrigin.Client,
				clientId: client.clientId!,
				data: { commandName: TaskCommandName.CancelTask, data: rooTaskId },
			})

			await new Promise((resolve) => setTimeout(resolve, 2_000))
		}

		await updateTask(task.id, { finishedAt: new Date() })
	}

	if (!isClientDisconnected) {
		try {
			if (rooTaskId) {
				client.sendMessage({
					type: IpcMessageType.TaskCommand,
					origin: IpcOrigin.Client,
					clientId: client.clientId!,
					data: { commandName: TaskCommandName.CloseTask, data: rooTaskId },
				})
			}

			client.disconnect()
		} catch (error) {
			console.error(error)
		}
	}

	// try {
	// 	console.log(`[cli#runExercise | ${language} / ${exercise}] aborting subprocess`)
	// 	controller.abort()
	// 	await subprocess
	// } catch (error) {
	// }
}

const runUnitTest = async ({ task }: { task: Task }) => {
	const cmd = testCommands[task.language]
	const exercisePath = path.resolve(exercisesPath, task.language, task.exercise)
	const cwd = cmd.cwd ? path.resolve(exercisePath, cmd.cwd) : exercisePath
	const commands = cmd.commands.map((cs) => parseCommandString(cs))

	let passed = true

	for (const command of commands) {
		// const controller = new AbortController()
		// const cancelSignal = controller.signal
		// const timeout = setTimeout(() => controller.abort(), cmd.timeout ?? 15_000)

		try {
			const result = await execa({ cwd, shell: true, reject: false /* , cancelSignal */ })`${command}`
			// console.log('[cli#run] execa result =', { ...result, cwd, command })

			// clearTimeout(timeout)

			if (result.failed) {
				passed = false
				break
			}
		} catch (error) {
			console.log("[cli#run] execa error =", error)
			passed = false
			break
		}
	}

	return passed
}

const askLanguage = async (prompt: GluegunPrompt) => {
	const { language } = await prompt.ask<{ language: ExerciseLanguage }>({
		type: "select",
		name: "language",
		message: "Which language?",
		choices: [...exerciseLanguages],
	})

	return language
}

const askExercise = async (prompt: GluegunPrompt, language: ExerciseLanguage) => {
	const exercises = filesystem.subdirectories(path.join(exercisesPath, language))

	if (exercises.length === 0) {
		throw new Error(`No exercises found for ${language}`)
	}

	const { exercise } = await prompt.ask<{ exercise: string }>({
		type: "select",
		name: "exercise",
		message: "Which exercise?",
		choices: exercises.map((exercise) => path.basename(exercise)).filter((exercise) => !exercise.startsWith(".")),
	})

	return exercise
}

const main = async () => {
	const cli = build()
		.brand("cli")
		.src(__dirname)
		.help()
		.version()
		.command({
			name: "run",
			description: "Run an eval",
			run: ({ config, parameters }) => {
				config.language = parameters.first
				config.exercise = parameters.second

				if (parameters.options["runId"]) {
					config.runId = parameters.options["runId"]
				}
			},
		})
		.defaultCommand()
		.create()

	const toolbox = await cli.run(process.argv)
	const { command } = toolbox

	switch (command?.name) {
		case "run":
			await run(toolbox)
			break
	}

	process.exit(0)
}

if (!fs.existsSync(extensionDevelopmentPath)) {
	console.error(`"extensionDevelopmentPath" does not exist.`)
	process.exit(1)
}

if (!fs.existsSync(exercisesPath)) {
	console.error(
		`Exercises path does not exist. Please run "git clone https://github.com/cte/Roo-Code-Benchmark.git exercises".`,
	)
	process.exit(1)
}

main()
