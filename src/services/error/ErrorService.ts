import * as Sentry from "@sentry/browser"
import * as pkg from "../../../package.json"

// Initialize sentry
Sentry.init({
	dsn: "https://7936780e3f0f0290fcf8d4a395c249b7@o4509028819664896.ingest.us.sentry.io/4509052955983872",
	environment: process.env.NODE_ENV,
	release: `cline@${pkg.version}`,
	integrations: [Sentry.browserTracingIntegration(), Sentry.replayIntegration()],
})

export class ErrorService {
	static logException(error: Error): void {
		// Log the error to Sentry
		Sentry.captureException(error)
	}

	static logMessage(message: string, level: "error" | "warning" | "log" | "debug" | "info" = "log"): void {
		// Log a message to Sentry
		Sentry.captureMessage(message, { level })
	}
}
