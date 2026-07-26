import { BedrockClient } from "@aws-sdk/client-bedrock"
import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts"
import {
	type BedrockConnection,
	createBedrockClient,
	createBedrockCredentialProvider,
	createBedrockTransport,
	type ToolDefinition,
	validateBedrockConnection,
} from "@bedrock-coder/llms"
import type { BedrockTarget } from "@shared/bedrock-startup"
import { type BedrockDiscoveryResult, BedrockDiscoveryService } from "./bedrock-discovery"

export interface BedrockDoctorDiscoveryResult extends BedrockDiscoveryResult {
	maskedAccountId?: string
}

function maskedAccountId(account: string | undefined): string | undefined {
	if (!account || !/^\d{12}$/.test(account)) return undefined
	return `${account.slice(0, 2)}••••••••${account.slice(-2)}`
}

export class BedrockStartupDoctor {
	async discover(input: {
		connection: BedrockConnection
		workspaceRoot?: string
		signal: AbortSignal
		onStage: (
			stage:
				| "resolvingCredentials"
				| "validatingIdentity"
				| "checkingBedrock"
				| "discoveringModels"
				| "discoveringProfiles",
		) => void
		cachedDiscovery?: BedrockDiscoveryResult
	}): Promise<BedrockDoctorDiscoveryResult> {
		const connection = validateBedrockConnection(input.connection)
		const transport = await createBedrockTransport(connection, input.workspaceRoot)
		try {
			const clientConfig = {
				region: connection.region,
				...(transport.requestHandler ? { requestHandler: transport.requestHandler } : {}),
			}
			input.onStage("resolvingCredentials")
			const provider = createBedrockCredentialProvider(connection, transport)
			const resolvedCredentials = await provider()
			const credentialProvider = async () => resolvedCredentials

			input.onStage("validatingIdentity")
			const sts = new STSClient({ ...clientConfig, credentials: credentialProvider })
			const identity = await sts.send(new GetCallerIdentityCommand({}), {
				abortSignal: input.signal,
			})

			input.onStage("checkingBedrock")
			if (input.cachedDiscovery) {
				return {
					...input.cachedDiscovery,
					maskedAccountId: maskedAccountId(identity.Account),
				}
			}
			const bedrock = new BedrockClient({
				...clientConfig,
				credentials: credentialProvider,
				...(connection.controlPlaneEndpoint ? { endpoint: connection.controlPlaneEndpoint } : {}),
			})
			const discovered = await new BedrockDiscoveryService(bedrock).discover(input.signal, input.onStage)
			return { ...discovered, maskedAccountId: maskedAccountId(identity.Account) }
		} finally {
			await transport.dispose()
		}
	}

	async probe(input: {
		connection: BedrockConnection
		workspaceRoot?: string
		target: BedrockTarget
		signal: AbortSignal
	}): Promise<{ inputTokens: number; outputTokens: number }> {
		const harmlessTool: ToolDefinition = {
			name: "startup_probe",
			description: "A harmless startup compatibility probe. Do not call it.",
			inputSchema: {
				type: "object",
				properties: {
					acknowledged: { type: "boolean" },
				},
				required: ["acknowledged"],
			},
		}
		const client = createBedrockClient({
			providerId: "bedrock",
			modelId: input.target.invocationId,
			connection: input.connection,
			workspaceRoot: input.workspaceRoot,
			maxOutputTokens: 16,
			abortSignal: input.signal,
		})
		const stream = client.createMessage(
			"You are validating an AWS Bedrock coding-agent connection.",
			[{ role: "user", content: "Reply with OK. Do not call the tool." }],
			[harmlessTool],
		)
		let observed = false
		let inputTokens = 0
		let outputTokens = 0
		for await (const event of stream) {
			observed = true
			if (event.type === "usage") {
				inputTokens = event.inputTokens
				outputTokens = event.outputTokens
			}
			if (event.type === "done" && event.success === false) {
				throw event.error ?? new Error("Bedrock streaming probe did not complete successfully.")
			}
		}
		if (!observed) {
			throw new Error("Bedrock streaming probe returned no stream events.")
		}
		return { inputTokens, outputTokens }
	}
}
