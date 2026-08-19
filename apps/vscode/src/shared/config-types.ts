/**
 * Shared configuration types that can be safely imported by both the extension and webview.
 * This file should not contain any Node.js-specific imports or runtime code.
 */

export enum Environment {
	production = "production",
	staging = "staging",
	local = "local",
	selfHosted = "selfHosted",
}

export interface EnvironmentConfig {
	environment: Environment
	appBaseUrl: string
	apiBaseUrl: string
	mcpBaseUrl: string
}
