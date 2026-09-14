import { AUTO_LOCALE, createI18nInstance, resolveLocale, type SupportedLocale } from "@cline/i18n"
import * as vscode from "vscode"

const instance = createI18nInstance()

/** Resolves the effective UI locale from the uiLanguage setting ("auto" follows the host display language). */
export function resolveHostLocale(uiLanguage: string | undefined): SupportedLocale {
	// vscode.env.language is a stub (not a string) in the standalone host
	const hostDisplayLanguage = typeof vscode.env?.language === "string" ? vscode.env.language : undefined
	return resolveLocale(!uiLanguage || uiLanguage === AUTO_LOCALE ? hostDisplayLanguage : uiLanguage)
}

/** Points the extension-host translator at the locale implied by the uiLanguage setting. */
export function updateHostLocale(uiLanguage: string | undefined): void {
	const locale = resolveHostLocale(uiLanguage)
	if (instance.language !== locale) {
		instance.changeLanguage(locale)
	}
}

/**
 * Translates an extension-host string (notifications, prompts, status bar).
 * Keys default to the "notifications" namespace; prefix another namespace
 * explicitly ("common:cancel") to override.
 */
export function t(key: string, options?: Record<string, unknown>): string {
	return instance.t(key, { ns: "notifications", ...options }) as string
}
