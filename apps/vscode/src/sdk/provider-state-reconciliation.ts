// Keeps the extension's provider selection and the SDK's providers.json in
// agreement.
//
// Provider state lives in two stores:
//
//   Store A — `<dataDir>/settings/providers.json`, owned by the SDK's
//     ProviderSettingsManager. Holds per-provider credentials plus the
//     `lastUsedProvider` pointer the CLI and the SDK runtime select on.
//   Store B — `<dataDir>/globalState.json`, owned by StateManager. Holds
//     `{plan,act}ModeApiProvider` plus the per-provider model id slots, and is
//     what the VS Code UI renders and what the session factory builds requests
//     from.
//
// Nothing used to reconcile them. `{plan,act}ModeApiProvider` carry a
// `DEFAULT_API_PROVIDER` ("openrouter") default that StateManager materializes
// while hydrating its cache, so "the user never chose a provider" was
// indistinguishable from "the user chose OpenRouter". A user configured
// entirely through the SDK/CLI therefore landed on OpenRouter, and — because
// credential resolution falls back to providers.json — an OpenRouter key
// stored there was picked up and billed for a provider the user had not
// selected. In the other direction, `lastUsedProvider` never moved when the
// provider was switched in the VS Code UI, so it went stale and pointed the
// CLI (and the session factory's fallback) at an abandoned provider.

import { Logger } from "@shared/services/Logger"
import type { GlobalStateAndSettings } from "@shared/storage/state-keys"
import type { StorageContext } from "@shared/storage/storage-context"
import { StateManager } from "@/core/storage/StateManager"
import { toLegacyApiProvider } from "@/shared/model-catalog/provider-helpers"
import { getProviderModelIdKey } from "@/shared/storage/provider-keys"
import { toSdkProviderId } from "./model-catalog/sdk-provider-id"
import { getProviderSettingsManager } from "./provider-migration"

const MODES = ["plan", "act"] as const

/**
 * VS Code LM stores its selection as a structured LanguageModelChatSelector,
 * not a model id string, so a providers.json `model` value cannot be adopted
 * into its state slot.
 */
const PROVIDERS_WITHOUT_MODEL_ID_SLOT = new Set(["vscode-lm"])

/** Minimal StateManager surface these helpers need, so tests can supply a fake. */
export interface ProviderSelectionStateWriter {
	setGlobalStateBatch(updates: Partial<GlobalStateAndSettings>): void
}

/**
 * Read a provider selection as it is actually persisted on disk, bypassing the
 * defaults StateManager applies while hydrating its cache. This is the only way
 * to tell an explicit OpenRouter selection apart from an absent one.
 */
function readPersistedProvider(storage: StorageContext, mode: (typeof MODES)[number]): string | undefined {
	const value = storage.globalState.get(`${mode}ModeApiProvider`)
	return typeof value === "string" && value.trim() ? value.trim() : undefined
}

/**
 * Adopt providers.json's `lastUsedProvider` into globalState when the
 * extension has no persisted provider selection of its own.
 *
 * Run once at startup, before the webview renders, so the UI, the settings
 * form and outbound requests all agree on the provider the user actually
 * configured instead of silently falling back to `DEFAULT_API_PROVIDER`.
 *
 * @returns the adopted legacy provider id, or undefined when nothing was adopted
 */
export function adoptSdkProviderSelection(storage: StorageContext, state: ProviderSelectionStateWriter): string | undefined {
	try {
		// Any persisted selection means Store B is authoritative — leave it alone.
		if (MODES.some((mode) => readPersistedProvider(storage, mode))) {
			return undefined
		}

		const manager = getProviderSettingsManager(storage.dataDir)
		const lastUsedProvider = manager.read().lastUsedProvider?.trim()
		if (!lastUsedProvider) {
			return undefined
		}

		// A dangling pointer (no entry, or an entry the auth layer cannot
		// resolve) is not a selection worth adopting — leave onboarding to run.
		const settings = manager.getProviderSettings(lastUsedProvider)
		if (!settings) {
			return undefined
		}

		const legacyProvider = toLegacyApiProvider(lastUsedProvider)
		const model = settings.model?.trim()
		const updates: Record<string, unknown> = {}
		for (const mode of MODES) {
			updates[`${mode}ModeApiProvider`] = legacyProvider
			if (model && !PROVIDERS_WITHOUT_MODEL_ID_SLOT.has(legacyProvider)) {
				updates[getProviderModelIdKey(legacyProvider, mode)] = model
			}
		}

		state.setGlobalStateBatch(updates as Partial<GlobalStateAndSettings>)
		Logger.log(
			`[ProviderStateReconciliation] Adopted provider selection from providers.json: ${legacyProvider}${
				model ? `/${model}` : ""
			}`,
		)
		return legacyProvider
	} catch (error) {
		Logger.warn("[ProviderStateReconciliation] Failed to adopt provider selection from providers.json:", error)
		return undefined
	}
}

/**
 * Point providers.json's `lastUsedProvider` at `providerId`.
 *
 * Skipped when providers.json has nothing stored for the provider: the pointer
 * would then resolve to no settings, which would strand the CLI on a provider
 * it cannot build a request for. The credential write that creates the entry
 * syncs again, so the selection converges as soon as it is usable.
 */
export function syncLastUsedProvider(providerId: string | undefined, dataDir?: string): void {
	const selected = providerId?.trim()
	if (!selected) {
		return
	}

	try {
		const manager = getProviderSettingsManager(dataDir)
		const sdkProviderId = toSdkProviderId(selected)
		const stored = manager.read()
		if (stored.lastUsedProvider === sdkProviderId) {
			return
		}
		if (!manager.getProviderSettings(sdkProviderId)) {
			return
		}

		manager.write({ ...stored, lastUsedProvider: sdkProviderId })
		Logger.log(`[ProviderStateReconciliation] providers.json lastUsedProvider -> ${sdkProviderId}`)
	} catch (error) {
		Logger.warn("[ProviderStateReconciliation] Failed to update providers.json lastUsedProvider:", error)
	}
}

/**
 * Mirror the provider currently selected for the active mode into
 * providers.json. Call after any write that changes the selection or creates
 * the selected provider's credentials.
 */
export function syncLastUsedProviderFromState(): void {
	try {
		const stateManager = StateManager.get()
		const mode = stateManager.getGlobalSettingsKey("mode") === "plan" ? "plan" : "act"
		const apiConfiguration = stateManager.getApiConfiguration()
		syncLastUsedProvider(mode === "plan" ? apiConfiguration.planModeApiProvider : apiConfiguration.actModeApiProvider)
	} catch (error) {
		Logger.warn("[ProviderStateReconciliation] Failed to read the active provider selection:", error)
	}
}
