export type BedrockTargetKind = "foundation-model" | "inference-profile"

export interface BedrockTarget {
	kind: BedrockTargetKind
	invocationId: string
	arn?: string
	displayName: string
	providerName?: string
	baseModelId?: string
	profileType?: "SYSTEM_DEFINED" | "APPLICATION"
	inputModalities: string[]
	outputModalities: string[]
	streaming: boolean
	lifecycle?: string
}

export type BedrockStartupPhase =
	| "idle"
	| "resolvingCredentials"
	| "validatingIdentity"
	| "checkingBedrock"
	| "discoveringModels"
	| "discoveringProfiles"
	| "awaitingSelection"
	| "probingSelection"
	| "ready"
	| "cancelled"
	| "failed"

export type BedrockDoctorErrorCategory =
	| "configuration"
	| "credentials"
	| "tls"
	| "dns"
	| "proxy"
	| "endpoint"
	| "authorization"
	| "throttling"
	| "model-validation"
	| "streaming"
	| "cancelled"
	| "unknown"

export interface BedrockDoctorError {
	stage: string
	category: BedrockDoctorErrorCategory
	service?: "sts" | "bedrock" | "bedrock-runtime"
	operation?: string
	awsCode?: string
	httpStatus?: number
	requestId?: string
	message: string
	suggestion?: string
}

export interface BedrockStartupProgress {
	label: string
	startedAt: number
	cancellable: boolean
	diagnosticStage: string
}

export interface BedrockProbeResult {
	status: "not-run" | "running" | "succeeded" | "failed"
	targetKey?: string
	completedAt?: number
	usage?: {
		inputTokens: number
		outputTokens: number
	}
	error?: BedrockDoctorError
}

export interface BedrockStartupState {
	phase: BedrockStartupPhase
	progress: BedrockStartupProgress
	targets: BedrockTarget[]
	selectedTarget?: BedrockTarget
	probe: BedrockProbeResult
	probeFailures: Record<string, BedrockDoctorError>
	connectionSummary: {
		region: string
		profile: string
		runtimeEndpoint: string
		controlPlaneEndpoint: string
		caBundle: string
	}
	maskedAccountId?: string
	error?: BedrockDoctorError
	notice?: string
	discoveryFromCache?: boolean
	updatedAt: number
}

export function bedrockTargetKey(target: Pick<BedrockTarget, "kind" | "invocationId">): string {
	return `${target.kind}:${target.invocationId}`
}
