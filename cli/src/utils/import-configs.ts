/**
 * Utility to detect and import API keys from competing CLI agents (Codex, OpenCode)
 */

import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import { anthropicDefaultModelId, geminiDefaultModelId, openAiNativeDefaultModelId } from "@/shared/api"
import providersData from "@/shared/providers/providers.json"

// Import source types
export type ImportSource = "codex" | "opencode"

// Imported key structure
export interface ImportedKey {
	provider: string // Cline provider ID
	keyField: string // Cline API key field name
	key: string // The API key value
	modelId?: string // Optional default model ID
}

// Import result
export interface ImportResult {
	source: ImportSource
	keys: ImportedKey[]
}

// Available import sources that were detected
export interface DetectedSources {
	codex: boolean
	opencode: boolean
}

// Build provider labels map from providers.json (single source of truth)
const providerLabels: Record<string, string> = Object.fromEntries(
	providersData.list.map((p: { value: string; label: string }) => [p.value, p.label]),
)

/**
 * Get possible data directories for OpenCode
 * OpenCode uses XDG_DATA_HOME on all platforms, defaulting to ~/.local/share/opencode
 * Returns array of paths to check (in order of preference)
 */
function getOpenCodeDataDirs(): string[] {
	const home = os.homedir()
	const paths: string[] = []

	// XDG path (used by OpenCode on all platforms)
	if (process.env.XDG_DATA_HOME) {
		paths.push(path.join(process.env.XDG_DATA_HOME, "opencode"))
	}
	paths.push(path.join(home, ".local", "share", "opencode"))

	return paths
}

/**
 * Detect which CLI agents have config files with API keys
 */
export function detectImportSources(): DetectedSources {
	return {
		codex: hasCodexConfig(),
		opencode: hasOpenCodeConfig(),
	}
}

/**
 * Check if Codex config exists with API keys
 */
function hasCodexConfig(): boolean {
	try {
		const authPath = path.join(os.homedir(), ".codex", "auth.json")
		if (!fs.existsSync(authPath)) {
			return false
		}
		const content = fs.readFileSync(authPath, "utf-8")
		const data = JSON.parse(content)
		// Check if there's at least one key
		return Object.keys(data).length > 0
	} catch {
		return false
	}
}

/**
 * Check if OpenCode config exists with API keys
 */
function hasOpenCodeConfig(): boolean {
	for (const dir of getOpenCodeDataDirs()) {
		try {
			const authPath = path.join(dir, "auth.json")
			if (!fs.existsSync(authPath)) {
				continue
			}
			const content = fs.readFileSync(authPath, "utf-8")
			const data = JSON.parse(content)
			// Check if there's at least one key
			if (Object.keys(data).length > 0) {
				return true
			}
		} catch {}
	}
	return false
}

/**
 * Find the OpenCode auth.json path (first existing one)
 */
function findOpenCodeAuthPath(): string | null {
	for (const dir of getOpenCodeDataDirs()) {
		const authPath = path.join(dir, "auth.json")
		if (fs.existsSync(authPath)) {
			return authPath
		}
	}
	return null
}

/**
 * Map Codex key names to Cline providers
 */
const CODEX_KEY_MAP: Record<string, { provider: string; keyField: string; modelId?: string }> = {
	OPENAI_API_KEY: { provider: "openai-native", keyField: "openAiNativeApiKey", modelId: openAiNativeDefaultModelId },
	ANTHROPIC_API_KEY: { provider: "anthropic", keyField: "apiKey", modelId: anthropicDefaultModelId },
}

/**
 * Map OpenCode provider IDs to Cline providers
 */
const OPENCODE_PROVIDER_MAP: Record<string, { provider: string; keyField: string; modelId?: string }> = {
	openai: { provider: "openai-native", keyField: "openAiNativeApiKey", modelId: openAiNativeDefaultModelId },
	anthropic: { provider: "anthropic", keyField: "apiKey", modelId: anthropicDefaultModelId },
	gemini: { provider: "gemini", keyField: "geminiApiKey", modelId: geminiDefaultModelId },
	mistral: { provider: "mistral", keyField: "mistralApiKey" },
	groq: { provider: "groq", keyField: "groqApiKey" },
	deepseek: { provider: "deepseek", keyField: "deepSeekApiKey" },
	xai: { provider: "xai", keyField: "xaiApiKey" },
	openrouter: { provider: "openrouter", keyField: "openRouterApiKey" },
}

/**
 * Import keys from Codex CLI
 */
export function importFromCodex(): ImportResult | null {
	try {
		const authPath = path.join(os.homedir(), ".codex", "auth.json")
		if (!fs.existsSync(authPath)) {
			return null
		}

		const content = fs.readFileSync(authPath, "utf-8")
		const data = JSON.parse(content) as Record<string, string>

		const keys: ImportedKey[] = []

		for (const [envKey, apiKey] of Object.entries(data)) {
			const mapping = CODEX_KEY_MAP[envKey]
			if (mapping && apiKey) {
				keys.push({
					provider: mapping.provider,
					keyField: mapping.keyField,
					key: apiKey,
					modelId: mapping.modelId,
				})
			}
		}

		if (keys.length === 0) {
			return null
		}

		return { source: "codex", keys }
	} catch {
		return null
	}
}

// OpenCode auth entry structure
interface OpenCodeAuthEntry {
	type: "api" | "oauth"
	key?: string
	access?: string
	refresh?: string
	expires?: number
}

/**
 * Import keys from OpenCode CLI
 */
export function importFromOpenCode(): ImportResult | null {
	try {
		const authPath = findOpenCodeAuthPath()
		if (!authPath) {
			return null
		}

		const content = fs.readFileSync(authPath, "utf-8")
		const data = JSON.parse(content) as Record<string, OpenCodeAuthEntry>

		const keys: ImportedKey[] = []

		for (const [providerId, authEntry] of Object.entries(data)) {
			// Only import API type keys (not OAuth)
			if (authEntry.type !== "api" || !authEntry.key) {
				continue
			}

			const mapping = OPENCODE_PROVIDER_MAP[providerId]
			if (mapping) {
				keys.push({
					provider: mapping.provider,
					keyField: mapping.keyField,
					key: authEntry.key,
					modelId: mapping.modelId,
				})
			}
		}

		if (keys.length === 0) {
			return null
		}

		return { source: "opencode", keys }
	} catch {
		return null
	}
}

/**
 * Get human-readable source name
 */
export function getSourceDisplayName(source: ImportSource): string {
	switch (source) {
		case "codex":
			return "OpenAI Codex CLI"
		case "opencode":
			return "OpenCode"
		default:
			return source
	}
}

/**
 * Get provider display name from providers.json
 */
export function getProviderDisplayName(provider: string): string {
	return providerLabels[provider] || provider
}
