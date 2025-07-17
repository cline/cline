import * as Sentry from "@sentry/browser"
import * as vscode from "vscode"
import { telemetryService } from "../posthog/telemetry/TelemetryService"
import * as pkg from "../../../package.json"
import { ClineError } from "./ClineError"

let telemetryLevel = vscode.workspace.getConfiguration("telemetry").get<string>("telemetryLevel", "all")
let isTelemetryEnabled = ["all", "error"].includes(telemetryLevel)

vscode.workspace.onDidChangeConfiguration(() => {
	telemetryLevel = vscode.workspace.getConfiguration("telemetry").get<string>("telemetryLevel", "all")
	isTelemetryEnabled = ["all", "error"].includes(telemetryLevel)
	ErrorService.toggleEnabled(isTelemetryEnabled)
	if (isTelemetryEnabled) {
		ErrorService.setLevel(telemetryLevel as "error" | "all")
	}
})

const isDev = process.env.IS_DEV === "true"

export class ErrorService {
	private static serviceEnabled: boolean
	private static serviceLevel: string

	static initialize() {
		// Initialize sentry
		Sentry.init({
			dsn: "https://7936780e3f0f0290fcf8d4a395c249b7@o4509028819664896.ingest.us.sentry.io/4509052955983872",
			environment: process.env.NODE_ENV,
			release: `cline@${pkg.version}`,
			integrations: [Sentry.browserTracingIntegration(), Sentry.replayIntegration()],
			beforeSend(event) {
				// TelemetryService keeps track of whether the user has opted in to telemetry/error reporting
				const isUserManuallyOptedIn = telemetryService.isTelemetryEnabled()
				if (isUserManuallyOptedIn && ErrorService.isEnabled() && !isDev) {
					return event
				}
				return null
			},
		})

		ErrorService.toggleEnabled(true)
		ErrorService.setLevel("error")
	}

	static toggleEnabled(state: boolean) {
		if (state === false) {
			ErrorService.serviceEnabled = false
			return
		}
		// If we are trying to enable the service, check that we are allowed to.
		if (isTelemetryEnabled) {
			ErrorService.serviceEnabled = true
		}
	}

	static setLevel(level: "error" | "all") {
		switch (telemetryLevel) {
			case "error": {
				if (level === "error") {
					ErrorService.serviceLevel = level
				}
				break
			}
			default: {
				ErrorService.serviceLevel = level
			}
		}
	}

	static logException(error: Error | ClineError): void {
		// Don't log if telemetry is off
		const isUserManuallyOptedIn = telemetryService.isTelemetryEnabled()
		if (!isUserManuallyOptedIn || !ErrorService.isEnabled()) {
			return
		}
		// Log the error to Sentry
		Sentry.captureException(error)
	}

	static logMessage(message: string, level: "error" | "warning" | "log" | "debug" | "info" = "log"): void {
		// Don't log if telemetry is off
		const isUserManuallyOptedIn = telemetryService.isTelemetryEnabled()
		if (!isUserManuallyOptedIn || !ErrorService.isEnabled()) {
			return
		}
		if (ErrorService.serviceLevel === "error" && level === "error") {
			// Log the message if allowed
			Sentry.captureMessage(message, { level })
			return
		}
		// Log the message if allowed
		Sentry.captureMessage(message, { level })
	}

	static isEnabled(): boolean {
		return ErrorService.serviceEnabled
	}

	static toClineError(rawError: any, modelId?: string, providerId?: string): ClineError {
		return ClineError.transform(rawError, modelId, providerId)
	}
}
