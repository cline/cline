import { createI18nInstance } from "@cline/i18n"

/**
 * The webview's i18next instance. It boots in English and is switched to the
 * resolved locale from extension state by I18nSync in Providers.tsx as soon as
 * the first state message arrives.
 */
export const i18n = createI18nInstance()
