#!/usr/bin/env npx tsx

import { type ChildProcess, spawn } from "node:child_process"
import { once } from "node:events"
import net from "node:net"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { credentials } from "@grpc/grpc-js"
import { AccountServiceClient } from "../src/generated/grpc-js/cline/account"
import { StateServiceClient } from "../src/generated/grpc-js/cline/state"
import { TaskServiceClient } from "../src/generated/grpc-js/cline/task"
import { UiServiceClient } from "../src/generated/grpc-js/cline/ui"

type ValidationMode = "local" | "remote"

type ValidationVariant = {
	name: string
	env: Record<string, string>
}

type ValidationScenario = {
	name: string
	prompt: string
}

type ScenarioResult = {
	scenario: string
	variant: string
	mode: ValidationMode
	newTaskRpcMs: number
	firstStateMs: number | null
	firstPartialMessageMs: number | null
	firstTaskDeltaMs: number | null
	completionMs: number | null
	stateUpdateCount: number
	partialMessageCount: number
	taskDeltaCount: number
	statePayloadBytes: number
	taskDeltaPayloadBytes: number
	totalTransportBytes: number
	messageCountAtCompletion: number | null
	finalUniqueMessageCount: number | null
	hasDuplicateMessagesAtCompletion: boolean | null
	finalStateSignature: string | null
	completed: boolean
	error?: string
}

type ScenarioComparison = {
	scenario: string
	mode: ValidationMode
	baselineVariant: string
	baselineSignature: string | null
	baselineSemanticSignature: string | null
	allVariantsMatchBaseline: boolean
	mismatchedVariants: string[]
}

function buildSemanticMessageSignature(message: any) {
	const messageType = message.type
	const sayType = message.say ?? null
	const askType = message.ask ?? null

	let normalizedText: string | null = message.text ?? null
	if (sayType === "api_req_started" || sayType === "hook_status" || sayType === "checkpoint_created") {
		normalizedText = null
	}
	if (messageType === "ask") {
		normalizedText = null
	}

	return {
		type: messageType,
		say: sayType,
		ask: askType,
		text: normalizedText,
		partial: message.partial ?? false,
		images: Array.isArray(message.images) ? message.images.length : 0,
		files: Array.isArray(message.files) ? message.files.length : 0,
	}
}

function buildSemanticStateSignature(state: any, clineMessages: any[]): string {
	return JSON.stringify({
		clineMessages: clineMessages.map(buildSemanticMessageSignature),
		currentFocusChainChecklist: state.currentFocusChainChecklist ?? null,
		backgroundCommandRunning: state.backgroundCommandRunning ?? false,
		backgroundCommandTaskId: state.backgroundCommandTaskId ?? null,
	})
}

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, "..")

const variants: ValidationVariant[] = [
	{ name: "default", env: {} },
	{
		name: "presentation_disabled",
		env: {
			CLINE_DISABLE_PRESENTATION_SCHEDULER: "true",
		},
	},
	{
		name: "ephemeral_disabled",
		env: {
			CLINE_DISABLE_EPHEMERAL_MESSAGE_PERSISTENCE: "true",
		},
	},
	{
		name: "delta_disabled",
		env: {
			CLINE_DISABLE_TASK_UI_DELTA_SYNC: "true",
		},
	},
]

const scenarios: ValidationScenario[] = [
	{ name: "basic", prompt: "latency_validation" },
	{ name: "long_running", prompt: "latency_validation_long" },
]

async function waitForPort(port: number, timeoutMs = 20_000): Promise<void> {
	const startedAt = Date.now()
	while (Date.now() - startedAt < timeoutMs) {
		try {
			await new Promise<void>((resolve, reject) => {
				const socket = net.connect(port, "127.0.0.1", () => {
					socket.destroy()
					resolve()
				})
				socket.on("error", reject)
			})
			return
		} catch {
			await new Promise((resolve) => setTimeout(resolve, 100))
		}
	}
	throw new Error(`Timed out waiting for port ${port}`)
}

async function getFreePort(): Promise<number> {
	return await new Promise((resolve, reject) => {
		const server = net.createServer()
		server.listen(0, "127.0.0.1", () => {
			const address = server.address()
			if (!address || typeof address === "string") {
				server.close(() => reject(new Error("Unable to allocate port")))
				return
			}
			const { port } = address
			server.close((error) => {
				if (error) {
					reject(error)
					return
				}
				resolve(port)
			})
		})
		server.on("error", reject)
	})
}

function unaryCall<T>(fn: (callback: (error: Error | null, response: T) => void) => void): Promise<T> {
	return new Promise((resolve, reject) => {
		fn((error, response) => {
			if (error) {
				reject(error)
				return
			}
			resolve(response)
		})
	})
}

async function startServer(mode: ValidationMode, envOverrides: Record<string, string>) {
	const grpcPort = await getFreePort()
	const hostbridgePort = await getFreePort()
	const env: Record<string, string> = {
		...process.env,
		PROTOBUS_PORT: String(grpcPort),
		HOSTBRIDGE_PORT: String(hostbridgePort),
		E2E_TEST: "true",
		CLINE_ENVIRONMENT: "local",
		TEST_HOSTBRIDGE_REMOTE_NAME: mode === "remote" ? "ssh-remote" : "",
		TEST_HOSTBRIDGE_PLATFORM: mode === "remote" ? "VS Code Remote" : "VS Code",
		GRPC_RECORDER_ENABLED: "false",
		...envOverrides,
	}

	const child = spawn("npx", ["tsx", path.join(PROJECT_ROOT, "scripts", "test-standalone-core-api-server.ts")], {
		cwd: PROJECT_ROOT,
		env,
		stdio: ["ignore", "pipe", "pipe"],
	})

	child.stdout?.on("data", () => {
		// Drain stdout so the spawned server cannot block on a full pipe buffer.
	})

	let stderr = ""
	child.stderr?.on("data", (chunk) => {
		stderr += chunk.toString()
	})

	await waitForPort(grpcPort)
	return { child, grpcPort, hostbridgePort, getStderr: () => stderr }
}

async function stopServer(child: ChildProcess) {
	if (child.killed || child.exitCode !== null) {
		return
	}
	child.kill("SIGINT")
	try {
		await Promise.race([once(child, "exit"), new Promise((resolve) => setTimeout(resolve, 5_000))])
	} catch {
		child.kill("SIGKILL")
	}
}

async function runScenario(
	mode: ValidationMode,
	variant: ValidationVariant,
	scenario: ValidationScenario,
): Promise<ScenarioResult> {
	const server = await startServer(mode, variant.env)
	const address = `127.0.0.1:${server.grpcPort}`
	const accountClient = new AccountServiceClient(address, credentials.createInsecure())
	const stateClient = new StateServiceClient(address, credentials.createInsecure())
	const taskClient = new TaskServiceClient(address, credentials.createInsecure())
	const uiClient = new UiServiceClient(address, credentials.createInsecure())

	let currentTaskId: string | undefined
	const startedAt = Date.now()
	let firstStateMs: number | null = null
	let firstPartialMessageMs: number | null = null
	let firstTaskDeltaMs: number | null = null
	let completionMs: number | null = null
	let stateUpdateCount = 0
	let partialMessageCount = 0
	let taskDeltaCount = 0
	let statePayloadBytes = 0
	let taskDeltaPayloadBytes = 0
	let messageCountAtCompletion: number | null = null
	let finalUniqueMessageCount: number | null = null
	let hasDuplicateMessagesAtCompletion: boolean | null = null
	let finalStateSignature: string | null = null
	let completed = false

	const stateStream = stateClient.subscribeToState({})
	const partialStream = uiClient.subscribeToPartialMessage({})
	const deltaStream = uiClient.subscribeToTaskUiDeltas({})

	for (const stream of [stateStream, partialStream, deltaStream]) {
		stream.on("error", (streamError: any) => {
			if (streamError?.code === 1 || streamError?.details === "Cancelled on client") {
				return
			}
			console.error("validation stream error", streamError)
		})
	}

	stateStream.on("data", (response: { stateJson?: string }) => {
		stateUpdateCount += 1
		const stateJson = response.stateJson || "{}"
		statePayloadBytes += Buffer.byteLength(stateJson, "utf8")
		if (firstStateMs === null) {
			firstStateMs = Date.now() - startedAt
		}
		try {
			const state = JSON.parse(stateJson)
			const activeTaskId = state.currentTaskItem?.id
			if (activeTaskId) {
				currentTaskId = activeTaskId
			}
			const clineMessages = Array.isArray(state.clineMessages) ? state.clineMessages : []
			const hasCompletion = clineMessages.some(
				(message: any) => message.ask === "completion_result" || message.ask === "resume_completed_task",
			)
			if (hasCompletion && completionMs === null) {
				completionMs = Date.now() - startedAt
				messageCountAtCompletion = clineMessages.length
				const uniqueMessageTs = new Set(clineMessages.map((message: any) => message.ts))
				finalUniqueMessageCount = uniqueMessageTs.size
				hasDuplicateMessagesAtCompletion = uniqueMessageTs.size !== clineMessages.length
				finalStateSignature = buildSemanticStateSignature(state, clineMessages)
				completed = true
			}
		} catch {
			// ignore parse errors in validation harness
		}
	})

	partialStream.on("data", (message: { say?: string; text?: string }) => {
		partialMessageCount += 1
		if (firstPartialMessageMs === null && (message.say === "text" || message.say === "reasoning")) {
			firstPartialMessageMs = Date.now() - startedAt
		}
	})

	deltaStream.on("data", (event: { deltaJson?: string }) => {
		taskDeltaCount += 1
		const deltaJson = event.deltaJson || ""
		taskDeltaPayloadBytes += Buffer.byteLength(deltaJson, "utf8")
		if (firstTaskDeltaMs === null) {
			try {
				const delta = JSON.parse(deltaJson)
				if (delta.type?.startsWith("message_") || delta.type === "task_metadata_updated") {
					firstTaskDeltaMs = Date.now() - startedAt
				}
			} catch {
				// ignore parse errors
			}
		}
	})

	let newTaskRpcMs = 0
	let error: string | undefined

	try {
		await unaryCall<{ value?: string }>((callback) => accountClient.accountLoginClicked({}, callback as any))
		await unaryCall((callback) => accountClient.getUserOrganizations({}, callback as any))

		const rpcStartedAt = Date.now()
		const newTaskResponse = await unaryCall<{ value?: string }>((callback) =>
			taskClient.newTask(
				{
					metadata: undefined,
					text: scenario.prompt,
					images: [],
					files: [],
					taskSettings: undefined,
				},
				callback as any,
			),
		)
		newTaskRpcMs = Date.now() - rpcStartedAt
		currentTaskId = newTaskResponse.value || currentTaskId

		const timeoutAt = Date.now() + 20_000
		while (!completed && Date.now() < timeoutAt) {
			await new Promise((resolve) => setTimeout(resolve, 100))
		}
		if (!completed) {
			error = "Scenario timed out before completion"
		}
	} catch (scenarioError) {
		error = scenarioError instanceof Error ? scenarioError.message : String(scenarioError)
	}

	stateStream.cancel()
	partialStream.cancel()
	deltaStream.cancel()
	accountClient.close()
	stateClient.close()
	taskClient.close()
	uiClient.close()
	await stopServer(server.child)

	return {
		scenario: scenario.name,
		variant: variant.name,
		mode,
		newTaskRpcMs,
		firstStateMs,
		firstPartialMessageMs,
		firstTaskDeltaMs,
		completionMs,
		stateUpdateCount,
		partialMessageCount,
		taskDeltaCount,
		statePayloadBytes,
		taskDeltaPayloadBytes,
		totalTransportBytes: statePayloadBytes + taskDeltaPayloadBytes,
		messageCountAtCompletion,
		finalUniqueMessageCount,
		hasDuplicateMessagesAtCompletion,
		finalStateSignature,
		completed,
		error,
	}
}

function compareScenarioResults(results: ScenarioResult[]): ScenarioComparison[] {
	const comparisons = new Map<string, ScenarioComparison>()

	for (const result of results) {
		const key = `${result.scenario}:${result.mode}`
		const comparison = comparisons.get(key)
		if (!comparison) {
			comparisons.set(key, {
				scenario: result.scenario,
				mode: result.mode,
				baselineVariant: "delta_disabled",
				baselineSignature: result.variant === "delta_disabled" ? result.finalStateSignature : null,
				baselineSemanticSignature: result.variant === "delta_disabled" ? result.finalStateSignature : null,
				allVariantsMatchBaseline: true,
				mismatchedVariants: [],
			})
			continue
		}

		if (result.variant === "delta_disabled") {
			comparison.baselineSignature = result.finalStateSignature
			comparison.baselineSemanticSignature = result.finalStateSignature
		}
	}

	for (const result of results) {
		const key = `${result.scenario}:${result.mode}`
		const comparison = comparisons.get(key)
		if (!comparison || result.variant === comparison.baselineVariant) {
			continue
		}

		if (comparison.baselineSignature !== result.finalStateSignature) {
			comparison.allVariantsMatchBaseline = false
			comparison.mismatchedVariants.push(result.variant)
		}
	}

	return [...comparisons.values()]
}

async function main() {
	const results: ScenarioResult[] = []
	for (const scenario of scenarios) {
		for (const mode of ["local", "remote"] as const) {
			for (const variant of variants) {
				results.push(await runScenario(mode, variant, scenario))
			}
		}
	}
	const comparisons = compareScenarioResults(results)
	console.log(JSON.stringify({ results, comparisons }, null, 2))
}

main().catch((error) => {
	console.error(error)
	process.exit(1)
})
