import { VSCodeButton, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { useCallback, useEffect, useState } from "react"
import { CustomGatewayConfig } from "../../../../src/shared/api"
import { vscode } from "../../utils/vscode"

interface HealthCheckConfigProps {
	config: CustomGatewayConfig
	onChange: (config: CustomGatewayConfig) => void
}

export const HealthCheckConfig = ({ config, onChange }: HealthCheckConfigProps) => {
	const [healthStatus, setHealthStatus] = useState<{
		status: "healthy" | "degraded" | "unhealthy"
		message?: string
		timestamp?: number
	}>()

	// Listen for health status updates
	useEffect(() => {
		const handler = (event: MessageEvent) => {
			const message = event.data
			if (message.type === "customGatewayHealthStatus") {
				setHealthStatus(message.healthStatus)
			}
		}

		window.addEventListener("message", handler)
		return () => window.removeEventListener("message", handler)
	}, [])

	// Request connection test
	const testConnection = useCallback(() => {
		// Validate minimum required settings
		if (!config.baseUrl) {
			setHealthStatus({
				status: "unhealthy",
				message: "Base URL is required",
				timestamp: Date.now(),
			})
			return
		}

		if (!config.compatibilityMode) {
			setHealthStatus({
				status: "unhealthy",
				message: "Compatibility mode is required",
				timestamp: Date.now(),
			})
			return
		}

		vscode.postMessage({
			type: "customGatewayHealthCheck",
		})
	}, [config])

	return (
		<div style={{ display: "flex", flexDirection: "column", gap: 15 }}>
			<div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
				<VSCodeTextField
					type="text"
					value={String(config.healthCheck?.timeout ?? 10000)}
					style={{ width: 200 }}
					onChange={(e) => {
						const timeout = parseInt((e.target as HTMLInputElement).value)
						onChange({
							...config,
							healthCheck: {
								enabled: config.healthCheck?.enabled ?? true,
								...config.healthCheck,
								timeout: isNaN(timeout) ? 10000 : timeout,
							},
						})
					}}>
					Health Check Timeout (ms)
				</VSCodeTextField>
				<span style={{ fontSize: 12, color: "var(--vscode-descriptionForeground)" }}>Default: 10000ms (10 seconds)</span>
			</div>
			<div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
				<div style={{ display: "flex", alignItems: "center", gap: 10 }}>
					<VSCodeButton onClick={testConnection}>Test Connection</VSCodeButton>
					<span style={{ fontSize: 12, color: "var(--vscode-descriptionForeground)" }}>
						View detailed logs in Output panel (Cmd+Shift+U) &gt; "Cline"
					</span>
				</div>
				{healthStatus && (
					<div
						style={{
							display: "flex",
							alignItems: "center",
							gap: 5,
							fontSize: 12,
							color:
								healthStatus.status === "healthy"
									? "var(--vscode-testing-iconPassed)"
									: healthStatus.status === "degraded"
										? "var(--vscode-testing-iconSkipped)"
										: "var(--vscode-testing-iconFailed)",
						}}>
						<span style={{ fontWeight: 500 }}>Status:</span>
						<span>{healthStatus.status}</span>
						{healthStatus.message && (
							<span style={{ color: "var(--vscode-descriptionForeground)" }}>({healthStatus.message})</span>
						)}
					</div>
				)}
			</div>
		</div>
	)
}

export default HealthCheckConfig
