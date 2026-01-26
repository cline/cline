/**
 * Utility to detect and import API keys from competing CLI agents (Codex, OpenCode)
 */

import * as fs from "fs"
import * as os from "os"
import * as path from "path"
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
 * Get the platform-specific data directory for OpenCode
 * - macOS: ~/Library/Application Support/opencode
 * - Windows: %APPDATA%/opencode
 * - Linux: ~/.local/share/opencode (XDG_DATA_HOME)
 */
function getOpenCodeDataDir(): string {
	const platform = os.platform()
	const home = os.homedir()

	if (platform === "darwin") {
		return path.join(home, "Library", "Application Support", "opencode")
	} else if (platform === "win32") {
		return path.join(process.env.APPDATA || path.join(home, "AppData", "Roaming"), "opencode")
	} else {
		// Linux and others - use XDG_DATA_HOME or default
		return path.join(process.env.XDG_DATA_HOME || path.join(home, ".local", "share"), "opencode")
	}
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
	try {
		const authPath = path.join(getOpenCodeDataDir(), "auth.json")
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
 * Map Codex key names to Cline providers
 */
const CODEX_KEY_MAP: Record<string, { provider: string; keyField: string; modelId?: string }> = {
	OPENAI_API_KEY: { provider: "openai-native", keyField: "openAiNativeApiKey", modelId: "gpt-4o" },
	ANTHROPIC_API_KEY: { provider: "anthropic", keyField: "apiKey", modelId: "claude-sonnet-4-20250514" },
}

/**
 * Map OpenCode provider IDs to Cline providers
 */
const OPENCODE_PROVIDER_MAP: Record<string, { provider: string; keyField: string; modelId?: string }> = {
	openai: { provider: "openai-native", keyField: "openAiNativeApiKey", modelId: "gpt-4o" },
	anthropic: { provider: "anthropic", keyField: "apiKey", modelId: "claude-sonnet-4-20250514" },
	gemini: { provider: "gemini", keyField: "geminiApiKey", modelId: "gemini-2.0-flash-001" },
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
		const authPath = path.join(getOpenCodeDataDir(), "auth.json")
		if (!fs.existsSync(authPath)) {
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
