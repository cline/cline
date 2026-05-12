import os from "node:os"
import path from "node:path"

type SpikeProviderId = "deepseek" | "ollama" | "litellm" | "openrouter"
type ProviderConfig = {
	providerId: string
	modelId: string
	apiKey?: string
	baseUrl?: string
	headers?: Record<string, string>
	auth?: { apiKey?: string; accessToken?: string }
	apiLine?: string
	region?: string
}

type CoreSdk = {
	ProviderSettingsManager: new (options: {
		filePath: string
		dataDir: string
	}) => {
		getProviderConfig(providerId: string, options?: { includeKnownModels?: boolean }): ProviderConfig | undefined
	}
	resolveProviderConfig(
		providerId: string,
		modelCatalog?: Record<string, unknown>,
		config?: ProviderConfig,
	): Promise<
		| {
				baseUrl: string
				modelId: string
				knownModels?: Record<string, unknown>
		  }
		| undefined
	>
	getLocalProviderModels(providerId: string, config?: ProviderConfig): Promise<{ providerId: string; models: unknown[] }>
}

const PROVIDERS: readonly SpikeProviderId[] = ["deepseek", "ollama", "litellm", "openrouter"]

const modelCatalog = {
	loadLatestOnInit: true,
	loadPrivateOnAuth: true,
	failOnError: false,
	cacheTtlMs: 0,
}

function resolveDataDir(): string {
	if (process.env.CLINE_DATA_DIR) {
		return process.env.CLINE_DATA_DIR
	}
	const clineDir = process.env.CLINE_DIR || path.join(os.homedir(), ".cline")
	return path.join(clineDir, "data")
}

function fallbackConfig(providerId: SpikeProviderId): ProviderConfig {
	switch (providerId) {
		case "ollama":
			return { providerId, modelId: "", baseUrl: "http://localhost:11434/v1" }
		case "litellm":
			return { providerId, modelId: "", baseUrl: "http://localhost:4000/v1" }
		case "deepseek":
			return { providerId, modelId: "" }
		case "openrouter":
			return { providerId, modelId: "" }
	}
}

function redactConfig(config: ProviderConfig | undefined): Record<string, unknown> | undefined {
	if (!config) {
		return undefined
	}
	return {
		providerId: config.providerId,
		modelId: config.modelId,
		baseUrl: config.baseUrl,
		headersPresent: config.headers ? Object.keys(config.headers).length > 0 : false,
		apiKeyPresent: typeof config.apiKey === "string" && config.apiKey.length > 0,
		authPresent: Boolean(config.auth?.accessToken || config.auth?.apiKey),
		apiLine: config.apiLine,
		region: config.region,
	}
}

function fieldNames(value: unknown): string[] {
	if (!value || typeof value !== "object") {
		return []
	}
	return Object.keys(value).sort()
}

function writeJsonLine(value: unknown): void {
	process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

async function inspectProvider(core: CoreSdk, providerId: SpikeProviderId): Promise<void> {
	const dataDir = resolveDataDir()
	const manager = new core.ProviderSettingsManager({
		filePath: path.join(dataDir, "settings", "providers.json"),
		dataDir,
	})
	const storedConfig = manager.getProviderConfig(providerId, { includeKnownModels: false })
	const inputConfig = storedConfig ?? fallbackConfig(providerId)
	const resolved = await core.resolveProviderConfig(providerId, modelCatalog, inputConfig)
	const knownModelEntries = Object.entries(resolved?.knownModels ?? {})
	const [firstModelId, firstModelInfo] = knownModelEntries[0] ?? []

	let localModelsCount: number | undefined
	let localModelsFirst: unknown
	let localModelsError: string | undefined
	try {
		const localModels = await core.getLocalProviderModels(providerId, inputConfig)
		localModelsCount = localModels.models.length
		localModelsFirst = localModels.models[0]
	} catch (error) {
		localModelsError = error instanceof Error ? error.message : String(error)
	}

	writeJsonLine({
		providerId,
		inputConfig: redactConfig(inputConfig),
		resolved: resolved
			? {
					baseUrl: resolved.baseUrl,
					defaultModelId: resolved.modelId,
					knownModelsCount: knownModelEntries.length,
					firstModelId,
					firstModelInfoFields: fieldNames(firstModelInfo),
					firstModelInfo,
				}
			: undefined,
		localModels: {
			count: localModelsCount,
			first: localModelsFirst,
			error: localModelsError,
		},
	})
}

async function main(): Promise<void> {
	const core = (await import("@clinebot/core")) as CoreSdk

	writeJsonLine({
		spike: "sdk-model-catalog-phase-2.1",
		sdkPackage: "@clinebot/core",
		apis: ["resolveProviderConfig", "getLocalProviderModels", "ProviderSettingsManager.getProviderConfig"],
		modelCatalog,
	})

	for (const providerId of PROVIDERS) {
		await inspectProvider(core, providerId)
	}
}

main().catch((error) => {
	process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`)
	process.exitCode = 1
})
