#!/usr/bin/env node
/**
 * Applies a QA key file to an isolated Cline profile.
 *
 * Cline reads credentials from `$CLINE_DIR/data/settings/providers.json` and the
 * active provider/model from `$CLINE_DIR/data/globalState.json` (with
 * `secrets.json` as the legacy mirror the extension still consults first), so a
 * profile can be configured before VS Code starts instead of typing keys into
 * the settings UI.
 *
 * Usage:
 *   apply-keys.mjs --keys /tmp/qa-keys.json --list
 *   apply-keys.mjs --keys /tmp/qa-keys.json --profile-dir DIR --select openai-compatible
 *   apply-keys.mjs --profile-dir DIR --show
 */
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

/**
 * extension id  -> value written to plan/actModeApiProvider
 * sdk id        -> key in providers.json
 * secret        -> key in secrets.json
 * modelKey      -> plan/act state key holding the model id
 * baseUrlKey    -> global state key holding the base url
 */
const PROVIDERS = {
	anthropic: { ext: "anthropic", sdk: "anthropic", secret: "apiKey", modelKey: "ApiModelId", baseUrlKey: "anthropicBaseUrl" },
	"openai-native": { ext: "openai-native", sdk: "openai-native", secret: "openAiNativeApiKey", modelKey: "ApiModelId" },
	openrouter: { ext: "openrouter", sdk: "openrouter", secret: "openRouterApiKey", modelKey: "OpenRouterModelId" },
	gemini: { ext: "gemini", sdk: "gemini", secret: "geminiApiKey", modelKey: "ApiModelId", baseUrlKey: "geminiBaseUrl" },
	cline: { ext: "cline", sdk: "cline", secret: "clineApiKey", modelKey: "ApiModelId" },
	deepseek: { ext: "deepseek", sdk: "deepseek", secret: "deepSeekApiKey", modelKey: "ApiModelId" },
	groq: { ext: "groq", sdk: "groq", secret: "groqApiKey", modelKey: "GroqModelId" },
	xai: { ext: "xai", sdk: "xai", secret: "xaiApiKey", modelKey: "ApiModelId" },
	mistral: { ext: "mistral", sdk: "mistral", secret: "mistralApiKey", modelKey: "ApiModelId" },
	requesty: { ext: "requesty", sdk: "requesty", secret: "requestyApiKey", modelKey: "RequestyModelId", baseUrlKey: "requestyBaseUrl" },
	together: { ext: "together", sdk: "together", secret: "togetherApiKey", modelKey: "TogetherModelId" },
	"vercel-ai-gateway": { ext: "vercel-ai-gateway", sdk: "vercel-ai-gateway", secret: "vercelAiGatewayApiKey", modelKey: "VercelAiGatewayModelId" },
	"openai-compatible": { ext: "openai", sdk: "openai-compatible", secret: "openAiApiKey", modelKey: "OpenAiModelId", baseUrlKey: "openAiBaseUrl" },
	litellm: { ext: "litellm", sdk: "litellm", secret: "liteLlmApiKey", modelKey: "LiteLlmModelId", baseUrlKey: "liteLlmBaseUrl" },
	ollama: { ext: "ollama", sdk: "ollama", secret: "ollamaApiKey", modelKey: "OllamaModelId", baseUrlKey: "ollamaBaseUrl" },
	bedrock: { ext: "bedrock", sdk: "bedrock", modelKey: "ApiModelId" },
	vertex: { ext: "vertex", sdk: "vertex", modelKey: "ApiModelId" },
}

function parseArgs(argv) {
	const args = { _: [] }
	for (let index = 0; index < argv.length; index += 1) {
		const token = argv[index]
		if (token.startsWith("--")) {
			const name = token.slice(2)
			const next = argv[index + 1]
			if (!next || next.startsWith("--")) {
				args[name] = true
			} else {
				args[name] = next
				index += 1
			}
		} else {
			args._.push(token)
		}
	}
	return args
}

function fingerprint(value) {
	return `sha256:${createHash("sha256").update(value).digest("hex").slice(0, 8)}`
}

function readJson(path, fallback) {
	if (!existsSync(path)) {
		return fallback
	}
	try {
		return JSON.parse(readFileSync(path, "utf8"))
	} catch {
		return fallback
	}
}

function writeJson(path, value, mode) {
	mkdirSync(join(path, "..").replace(/\/\.\.$/, ""), { recursive: true })
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, mode ? { mode } : undefined)
}

function classify(keys) {
	const usable = []
	const notProvided = []
	const unknown = []
	for (const [name, entry] of Object.entries(keys)) {
		const definition = PROVIDERS[name]
		if (!definition) {
			unknown.push(name)
			continue
		}
		const hasCredential =
			Boolean(entry?.apiKey?.trim?.()) ||
			Boolean(entry?.awsAccessKey?.trim?.() && entry?.awsSecretKey?.trim?.()) ||
			Boolean(entry?.vertexProjectId?.trim?.()) ||
			(name === "ollama" && Boolean(entry?.baseUrl?.trim?.()))
		if (hasCredential) {
			usable.push(name)
		} else {
			notProvided.push(name)
		}
	}
	return { usable, notProvided, unknown }
}

function list(keys) {
	const { usable, notProvided, unknown } = classify(keys)
	console.log("provider              credential  model")
	console.log("--------------------- ----------- -----------------------------")
	for (const name of Object.keys(keys)) {
		const entry = keys[name] ?? {}
		const status = usable.includes(name) ? "present" : "absent"
		const detail = entry.apiKey ? fingerprint(entry.apiKey) : ""
		console.log(
			`${name.padEnd(21)} ${status.padEnd(11)} ${(entry.model || "(unset)").padEnd(30)} ${detail}`,
		)
	}
	if (unknown.length > 0) {
		console.log(`\nunknown provider ids in key file: ${unknown.join(", ")}`)
	}
	console.log(`\nusable: ${usable.length ? usable.join(", ") : "(none)"}`)
	console.log(`notProvided: ${notProvided.length ? notProvided.join(", ") : "(none)"}`)
}

function providerSettingsFor(name, entry) {
	const definition = PROVIDERS[name]
	const settings = { provider: definition.sdk }
	if (entry.apiKey?.trim()) {
		settings.apiKey = entry.apiKey.trim()
	}
	if (entry.baseUrl?.trim()) {
		settings.baseUrl = entry.baseUrl.trim()
	}
	if (entry.model?.trim()) {
		settings.model = entry.model.trim()
	}
	if (name === "bedrock" && entry.awsAccessKey?.trim()) {
		settings.aws = {
			region: entry.awsRegion?.trim() || "us-west-2",
			accessKey: entry.awsAccessKey.trim(),
			secretKey: entry.awsSecretKey?.trim() || "",
		}
	}
	if (name === "vertex" && entry.vertexProjectId?.trim()) {
		settings.gcp = {
			projectId: entry.vertexProjectId.trim(),
			region: entry.vertexRegion?.trim() || "us-east5",
		}
	}
	return settings
}

function apply({ keys, profileDir, select, model, price }) {
	const dataDir = join(profileDir, "cline", "data")
	const settingsDir = join(dataDir, "settings")
	mkdirSync(settingsDir, { recursive: true, mode: 0o700 })

	const { usable } = classify(keys)
	const now = new Date().toISOString()

	const stored = readJson(join(settingsDir, "providers.json"), { version: 1, providers: {} })
	stored.version = 1
	stored.providers = stored.providers ?? {}
	for (const name of usable) {
		const settings = providerSettingsFor(name, keys[name])
		stored.providers[PROVIDERS[name].sdk] = { settings, updatedAt: now, tokenSource: "manual" }
	}
	if (select) {
		stored.lastUsedProvider = PROVIDERS[select].sdk
	}
	writeJson(join(settingsDir, "providers.json"), stored, 0o600)

	const secrets = readJson(join(dataDir, "secrets.json"), {})
	for (const name of usable) {
		const definition = PROVIDERS[name]
		if (definition.secret && keys[name].apiKey?.trim()) {
			secrets[definition.secret] = keys[name].apiKey.trim()
		}
		if (name === "bedrock") {
			secrets.awsAccessKey = keys[name].awsAccessKey?.trim()
			secrets.awsSecretKey = keys[name].awsSecretKey?.trim()
		}
	}
	writeJson(join(dataDir, "secrets.json"), secrets, 0o600)

	const state = readJson(join(dataDir, "globalState.json"), {})
	state.mode = "act"
	// Keep onboarding out of the way of a UI-driven run.
	state.welcomeViewCompleted = true
	state.telemetrySetting = "disabled"

	for (const name of usable) {
		const definition = PROVIDERS[name]
		const entry = keys[name]
		if (definition.baseUrlKey && entry.baseUrl?.trim()) {
			state[definition.baseUrlKey] = entry.baseUrl.trim()
		}
		if (entry.model?.trim()) {
			state[`planMode${definition.modelKey}`] = entry.model.trim()
			state[`actMode${definition.modelKey}`] = entry.model.trim()
		}
		if (name === "bedrock") {
			state.awsRegion = entry.awsRegion?.trim() || "us-west-2"
		}
		if (name === "vertex") {
			state.vertexProjectId = entry.vertexProjectId?.trim()
			state.vertexRegion = entry.vertexRegion?.trim() || "us-east5"
		}
	}

	if (select) {
		const definition = PROVIDERS[select]
		state.planModeApiProvider = definition.ext
		state.actModeApiProvider = definition.ext
		const selectedModel = model?.trim() || keys[select]?.model?.trim()
		if (selectedModel) {
			state[`planMode${definition.modelKey}`] = selectedModel
			state[`actMode${definition.modelKey}`] = selectedModel
		}
		if (select === "openai-compatible") {
			const info = {
				contextWindow: 128000,
				maxTokens: 8192,
				supportsImages: false,
				supportsPromptCache: true,
				...(price
					? {
							inputPrice: 3,
							outputPrice: 15,
							cacheReadsPrice: 0.3,
							cacheWritesPrice: 3.75,
						}
					: {}),
			}
			state.planModeOpenAiModelInfo = info
			state.actModeOpenAiModelInfo = info
		}
	}
	writeJson(join(dataDir, "globalState.json"), state)

	console.log(`profile   ${profileDir}`)
	console.log(`clineDir  ${join(profileDir, "cline")}`)
	console.log(`providers ${usable.join(", ") || "(none)"}`)
	console.log(`selected  ${select ?? "(unchanged)"}`)
	if (select) {
		const definition = PROVIDERS[select]
		console.log(`model     ${state[`actMode${definition.modelKey}`] ?? "(unset)"}`)
	}
	console.log(`pricing   ${price ? "seeded (in 3 / out 15 / cacheRead 0.3 / cacheWrite 3.75 per 1M)" : "not seeded"}`)
}

function show(profileDir) {
	const dataDir = join(profileDir, "cline", "data")
	const stored = readJson(join(dataDir, "settings", "providers.json"), { providers: {} })
	const state = readJson(join(dataDir, "globalState.json"), {})
	const secrets = readJson(join(dataDir, "secrets.json"), {})

	const activeExt = state.actModeApiProvider
	const definition = Object.values(PROVIDERS).find((entry) => entry.ext === activeExt)
	const modelKey = definition ? `actMode${definition.modelKey}` : undefined

	console.log(`profileDir            ${profileDir}`)
	console.log(`actModeApiProvider    ${activeExt ?? "(unset)"}`)
	console.log(`planModeApiProvider   ${state.planModeApiProvider ?? "(unset)"}`)
	console.log(`mode                  ${state.mode ?? "(unset)"}`)
	console.log(`active model id       ${(modelKey && state[modelKey]) || "(unset)"}   [${modelKey ?? "n/a"}]`)
	if (definition?.baseUrlKey) {
		console.log(`base url              ${state[definition.baseUrlKey] ?? "(unset)"}`)
	}
	if (state.actModeOpenAiModelInfo) {
		const info = state.actModeOpenAiModelInfo
		console.log(
			`openAiModelInfo       contextWindow=${info.contextWindow} maxTokens=${info.maxTokens} ` +
				`inputPrice=${info.inputPrice ?? "(unset)"} outputPrice=${info.outputPrice ?? "(unset)"} ` +
				`cacheReadsPrice=${info.cacheReadsPrice ?? "(unset)"} cacheWritesPrice=${info.cacheWritesPrice ?? "(unset)"} ` +
				`supportsPromptCache=${info.supportsPromptCache}`,
		)
	}
	console.log(`lastUsedProvider      ${stored.lastUsedProvider ?? "(unset)"}`)
	console.log("providers.json entries:")
	for (const [id, entry] of Object.entries(stored.providers ?? {})) {
		const settings = entry.settings ?? {}
		const key = settings.apiKey ? fingerprint(settings.apiKey) : settings.auth ? "oauth" : "(none)"
		console.log(
			`  ${id.padEnd(20)} model=${(settings.model || "(unset)").padEnd(34)} baseUrl=${settings.baseUrl ?? "(default)"} key=${key}`,
		)
	}
	const secretNames = Object.keys(secrets).filter((name) => secrets[name])
	console.log(`secrets.json keys     ${secretNames.length ? secretNames.join(", ") : "(none)"}`)
}

const args = parseArgs(process.argv.slice(2))
const keysPath = typeof args.keys === "string" ? args.keys : "/tmp/qa-keys.json"

if (args.show) {
	if (typeof args["profile-dir"] !== "string") {
		console.error("--show requires --profile-dir")
		process.exit(2)
	}
	show(args["profile-dir"])
	process.exit(0)
}

if (!existsSync(keysPath)) {
	console.error(`key file not found: ${keysPath}`)
	process.exit(2)
}
const keys = JSON.parse(readFileSync(keysPath, "utf8"))

if (args.list) {
	list(keys)
	process.exit(0)
}

if (typeof args["profile-dir"] !== "string") {
	console.error("--profile-dir is required unless --list is used")
	process.exit(2)
}
const select = typeof args.select === "string" ? args.select : undefined
if (select && !PROVIDERS[select]) {
	console.error(`unknown provider: ${select}`)
	process.exit(2)
}
apply({
	keys,
	profileDir: args["profile-dir"],
	select,
	model: typeof args.model === "string" ? args.model : undefined,
	price: Boolean(args.price),
})
