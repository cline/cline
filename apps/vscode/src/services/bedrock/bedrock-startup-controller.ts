import { stat } from "node:fs/promises"
import { isAbsolute, join, resolve } from "node:path"
import type { BedrockConnection } from "@cline/llms"
import { BEDROCK_DEFAULT_MODEL_ID } from "@shared/api"
import {
	type BedrockDoctorError,
	type BedrockStartupPhase,
	type BedrockStartupState,
	type BedrockTarget,
	bedrockTargetKey,
} from "@shared/bedrock-startup"
import type { StateManager } from "@/core/storage/StateManager"
import { buildBedrockConnection } from "@/sdk/bedrock-config"
import { LocalDiagnosticLogger } from "@/services/diagnostics/local-diagnostic-logger"
import { Logger } from "@/shared/services/Logger"
import type { BedrockDiscoveryResult } from "./bedrock-discovery"
import { mapBedrockDoctorError, redactBedrockDiagnostics } from "./bedrock-errors"
import { BedrockStartupDoctor } from "./bedrock-startup-doctor"

const STAGE_LABELS: Record<BedrockStartupPhase, string> = {
	idle: "Waiting to validate AWS Bedrock",
	resolvingCredentials: "Resolving AWS credentials",
	validatingIdentity: "Validating AWS identity",
	checkingBedrock: "Connecting to the Bedrock control plane",
	discoveringModels: "Discovering foundation models",
	discoveringProfiles: "Discovering inference profiles",
	awaitingSelection: "Choose an invocable Bedrock destination",
	probingSelection: "Probing the selected destination",
	ready: "Bedrock is ready",
	cancelled: "Startup check cancelled",
	failed: "Bedrock startup check failed",
}

const CANCELLABLE = new Set<BedrockStartupPhase>([
	"resolvingCredentials",
	"validatingIdentity",
	"checkingBedrock",
	"discoveringModels",
	"discoveringProfiles",
	"probingSelection",
])

function summary(connection: BedrockConnection): BedrockStartupState["connectionSummary"] {
	return {
		region: connection.region,
		profile: connection.profile || "Default credential chain",
		runtimeEndpoint: connection.endpoint || "Regional AWS endpoint",
		controlPlaneEndpoint: connection.controlPlaneEndpoint || "Regional AWS endpoint",
		caBundle: connection.caBundlePath || "System trust store",
	}
}

function initialState(connection: BedrockConnection): BedrockStartupState {
	const now = Date.now()
	return {
		phase: "idle",
		progress: {
			label: STAGE_LABELS.idle,
			startedAt: now,
			cancellable: false,
			diagnosticStage: "idle",
		},
		targets: [],
		probe: { status: "not-run" },
		probeFailures: {},
		connectionSummary: summary(connection),
		updatedAt: now,
	}
}

function errorContext(phase: BedrockStartupPhase): Pick<BedrockDoctorError, "stage" | "service" | "operation"> {
	switch (phase) {
		case "resolvingCredentials":
			return { stage: phase, service: "sts", operation: "ResolveCredentials" }
		case "validatingIdentity":
			return { stage: phase, service: "sts", operation: "GetCallerIdentity" }
		case "discoveringModels":
			return { stage: phase, service: "bedrock", operation: "ListFoundationModels" }
		case "discoveringProfiles":
			return { stage: phase, service: "bedrock", operation: "ListInferenceProfiles" }
		case "probingSelection":
			return { stage: phase, service: "bedrock-runtime", operation: "ConverseStream" }
		default:
			return { stage: phase, service: "bedrock", operation: "Connect" }
	}
}

export interface BedrockStartupControllerOptions {
	stateManager: StateManager
	workspaceRoot: () => Promise<string | undefined>
	logDirectory: string
	onStateChanged: () => Promise<void>
	doctor?: BedrockStartupDoctor
}

export class BedrockStartupController {
	private static readonly discoveryCache = new Map<string, BedrockDiscoveryResult>()
	private readonly doctor: BedrockStartupDoctor
	private readonly logPath: string
	private abortController?: AbortController
	private generation = 0
	private currentState: BedrockStartupState

	constructor(private readonly options: BedrockStartupControllerOptions) {
		this.doctor = options.doctor ?? new BedrockStartupDoctor()
		this.logPath = join(options.logDirectory, "current.jsonl")
		this.currentState = initialState(this.connection())
	}

	get state(): BedrockStartupState {
		return this.currentState
	}

	get diagnosticLogPath(): string {
		return this.logPath
	}

	assertReady(): void {
		if (this.currentState.phase !== "ready") {
			throw new Error("AWS Bedrock startup validation must succeed before prompt submission.")
		}
	}

	start(forceRefresh = false): Promise<void> {
		const run = ++this.generation
		this.abortController?.abort()
		const abortController = new AbortController()
		this.abortController = abortController
		return this.runDiscovery(run, abortController, forceRefresh)
	}

	retry(): Promise<void> {
		if (this.currentState.probe.status === "failed" && this.currentState.selectedTarget) {
			const run = ++this.generation
			this.abortController?.abort()
			const abortController = new AbortController()
			this.abortController = abortController
			return this.runProbe(run, abortController, this.currentState.selectedTarget)
		}
		return this.start(false)
	}

	refresh(): Promise<void> {
		return this.start(true)
	}

	cancel(): void {
		this.abortController?.abort()
	}

	async connectionChanged(): Promise<void> {
		await this.start(true)
	}

	async selectTarget(kind: BedrockTarget["kind"], invocationId: string): Promise<void> {
		const target = this.currentState.targets.find(
			(candidate) => candidate.kind === kind && candidate.invocationId === invocationId,
		)
		if (!target) throw new Error("The selected Bedrock destination is no longer in the discovery results.")
		const run = ++this.generation
		this.abortController?.abort()
		const abortController = new AbortController()
		this.abortController = abortController
		await this.runProbe(run, abortController, target)
	}

	diagnosticsText(): string {
		return redactBedrockDiagnostics({
			phase: this.currentState.phase,
			progress: this.currentState.progress,
			connection: this.currentState.connectionSummary,
			selectedTarget: this.currentState.selectedTarget,
			probe: this.currentState.probe,
			error: this.currentState.error,
			notice: this.currentState.notice,
			targetCount: this.currentState.targets.length,
			maskedAccountId: this.currentState.maskedAccountId,
		})
	}

	dispose(): void {
		this.generation += 1
		this.abortController?.abort()
		this.abortController = undefined
	}

	private connection(): BedrockConnection {
		return buildBedrockConnection(this.options.stateManager.getApiConfiguration())
	}

	private async cacheKey(connection: BedrockConnection, workspaceRoot?: string): Promise<string> {
		let caMtime = "none"
		const caPath = connection.caBundlePath?.trim()
		if (caPath) {
			const absolutePath = isAbsolute(caPath) ? caPath : workspaceRoot ? resolve(workspaceRoot, caPath) : caPath
			try {
				caMtime = String((await stat(absolutePath)).mtimeMs)
			} catch {
				caMtime = "unavailable"
			}
		}
		return JSON.stringify({
			region: connection.region,
			runtimeEndpoint: connection.endpoint ?? "",
			controlPlaneEndpoint: connection.controlPlaneEndpoint ?? "",
			profile: connection.profile ?? "<default-chain>",
			caBundlePath: connection.caBundlePath ?? "",
			caMtime,
		})
	}

	private async runDiscovery(run: number, abortController: AbortController, forceRefresh: boolean): Promise<void> {
		const startedAt = Date.now()
		const connection = this.connection()
		const workspaceRoot = await this.options.workspaceRoot()
		if (!this.isCurrent(run)) return
		this.transition("resolvingCredentials", {
			connectionSummary: summary(connection),
			error: undefined,
			notice: undefined,
			probe: { status: "not-run" },
			discoveryFromCache: false,
		})
		const key = await this.cacheKey(connection, workspaceRoot)
		const cachedDiscovery = forceRefresh ? undefined : BedrockStartupController.discoveryCache.get(key)
		try {
			const result = await this.doctor.discover({
				connection,
				workspaceRoot,
				signal: abortController.signal,
				cachedDiscovery,
				onStage: (stage) => {
					if (this.isCurrent(run)) this.transition(stage)
				},
			})
			if (!this.isCurrent(run)) return
			const discovery = {
				targets: result.targets,
				foundationModelCount: result.foundationModelCount,
				inferenceProfileCount: result.inferenceProfileCount,
				inferenceProfilePages: result.inferenceProfilePages,
			}
			BedrockStartupController.discoveryCache.set(key, discovery)
			this.currentState = {
				...this.currentState,
				targets: result.targets,
				maskedAccountId: result.maskedAccountId,
				discoveryFromCache: Boolean(cachedDiscovery),
				updatedAt: Date.now(),
			}
			await this.writeLog("discovery", {
				durationMs: Date.now() - startedAt,
				foundationModels: result.foundationModelCount,
				inferenceProfiles: result.inferenceProfileCount,
				inferenceProfilePages: result.inferenceProfilePages,
				fromCache: Boolean(cachedDiscovery),
			})

			const savedId = this.options.stateManager.getGlobalSettingsKey("actModeApiModelId") || BEDROCK_DEFAULT_MODEL_ID
			const savedTarget = result.targets.find((target) => target.invocationId === savedId || target.arn === savedId)
			if (!savedTarget) {
				this.transition("awaitingSelection", {
					selectedTarget: undefined,
					notice: savedId
						? `The saved destination "${savedId}" is no longer returned as an invocable streaming text target. Choose another destination.`
						: "Choose a Bedrock destination to run the compatibility probe.",
				})
				return
			}
			await this.runProbe(run, abortController, savedTarget)
		} catch (error) {
			await this.handleFailure(run, error)
		}
	}

	private async runProbe(run: number, abortController: AbortController, target: BedrockTarget): Promise<void> {
		const startedAt = Date.now()
		const key = bedrockTargetKey(target)
		this.transition("probingSelection", {
			selectedTarget: target,
			error: undefined,
			notice: "The compatibility probe uses the production streaming runtime and may incur a very small Bedrock charge.",
			probe: { status: "running", targetKey: key },
		})
		try {
			const usage = await this.doctor.probe({
				connection: this.connection(),
				workspaceRoot: await this.options.workspaceRoot(),
				target,
				signal: abortController.signal,
			})
			if (!this.isCurrent(run)) return
			this.options.stateManager.setGlobalStateBatch({
				planModeApiModelId: target.invocationId,
				actModeApiModelId: target.invocationId,
				bedrockSelectedTargetKind: target.kind,
				bedrockSelectedTargetArn: target.arn,
				bedrockSelectedBaseModelId: target.baseModelId,
			})
			this.transition("ready", {
				selectedTarget: target,
				probe: {
					status: "succeeded",
					targetKey: key,
					completedAt: Date.now(),
					usage,
				},
				notice: "The selected destination passed the production streaming compatibility probe.",
			})
			await this.writeLog("probe-succeeded", {
				target,
				usage,
				durationMs: Date.now() - startedAt,
			})
		} catch (error) {
			if (!this.isCurrent(run)) return
			const mapped = mapBedrockDoctorError(error, errorContext("probingSelection"))
			if (mapped.category === "cancelled") {
				this.transition("cancelled", {
					selectedTarget: target,
					probe: { status: "not-run", targetKey: key },
					error: mapped,
				})
			} else {
				this.transition("awaitingSelection", {
					selectedTarget: target,
					probe: {
						status: "failed",
						targetKey: key,
						completedAt: Date.now(),
						error: mapped,
					},
					probeFailures: { ...this.currentState.probeFailures, [key]: mapped },
					error: mapped,
					notice: "This destination remains available so you can inspect the failure or choose another target.",
				})
			}
			await this.writeLog("probe-failed", {
				...mapped,
				durationMs: Date.now() - startedAt,
			})
		}
	}

	private async handleFailure(run: number, error: unknown): Promise<void> {
		if (!this.isCurrent(run)) return
		const mapped = mapBedrockDoctorError(error, errorContext(this.currentState.phase))
		this.transition(mapped.category === "cancelled" ? "cancelled" : "failed", {
			error: mapped,
		})
		await this.writeLog("startup-failed", mapped)
	}

	private transition(phase: BedrockStartupPhase, updates: Partial<BedrockStartupState> = {}): void {
		const now = Date.now()
		this.currentState = {
			...this.currentState,
			...updates,
			phase,
			progress: {
				label: STAGE_LABELS[phase],
				startedAt: now,
				cancellable: CANCELLABLE.has(phase),
				diagnosticStage: phase,
			},
			updatedAt: now,
		}
		Logger.log(`[BedrockStartup] ${phase}`)
		void this.options.onStateChanged().catch((error) => {
			Logger.warn("[BedrockStartup] Failed to publish state:", error)
		})
	}

	private isCurrent(run: number): boolean {
		return run === this.generation
	}

	private async writeLog(event: string, details: unknown): Promise<void> {
		try {
			const sanitized = redactBedrockDiagnostics({
				ts: new Date().toISOString(),
				event,
				details,
			})
			LocalDiagnosticLogger.recordGlobal({
				name: event,
				category: event.startsWith("probe") ? "bedrock" : "doctor",
				level: event.includes("failed") ? "error" : "info",
				stage: this.currentState.phase,
				details: { summary: sanitized },
			})
		} catch (error) {
			Logger.warn("[BedrockStartup] Failed to write diagnostic log:", error)
		}
	}
}
