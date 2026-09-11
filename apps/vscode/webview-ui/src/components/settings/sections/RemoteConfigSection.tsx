import { EmptyRequest } from "@shared/proto/index.cline"
import { VSCodeButton, VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { useEffect, useRef, useState } from "react"
import { Trans, useTranslation } from "react-i18next"
import { RemoteConfigToggle } from "@/components/account/RemoteConfigToggle"
import { useClineAuth } from "@/context/ClineAuthContext"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { StateServiceClient } from "@/services/grpc-client"
import Section from "../Section"

interface RemoteConfigSectionProps {
	renderSectionHeader: (tabId: string) => JSX.Element | null
}

function BaseRemoteConfigSection({ renderSectionHeader, children }: React.PropsWithChildren<RemoteConfigSectionProps>) {
	return (
		<div>
			{renderSectionHeader("remote-config")}
			<Section>{children}</Section>
		</div>
	)
}

const AUTOMATIC_DELAY_MS = 30000

function RefreshButton() {
	const { t } = useTranslation()
	const [isLoading, setIsLoading] = useState(false)
	const [error, setError] = useState<string>()
	const [retryIn, setRetryIn] = useState<number | null>(null)
	const intervalRef = useRef<NodeJS.Timeout>()

	useEffect(() => {
		return () => {
			if (intervalRef.current) {
				clearInterval(intervalRef.current)
			}
		}
	}, [])

	const onRefresh = () => {
		setIsLoading(true)
		setError(undefined)
		StateServiceClient.refreshRemoteConfig(EmptyRequest.create())
			.catch((refreshError) => {
				setError(refreshError instanceof Error ? refreshError.message : t("settings:remoteConfig.refreshFailed"))
			})
			.finally(() => {
				setIsLoading(false)
				setRetryIn(AUTOMATIC_DELAY_MS / 1000)

				intervalRef.current = setInterval(() => {
					setRetryIn((old) => {
						if (old && old > 0) return old - 1

						intervalRef.current && clearInterval(intervalRef.current)
						return null
					})
				}, 1000)
			})
	}

	return (
		<div>
			<VSCodeButton
				className={`w-full rounded-xs ${isLoading ? "animate-pulse" : ""}`}
				disabled={isLoading || (retryIn !== null && retryIn > 0)}
				onClick={() => onRefresh()}>
				{t("settings:remoteConfig.refresh")}{" "}
				{retryIn && retryIn > 0 && <>{t("settings:remoteConfig.retryIn", { count: retryIn })}</>}
			</VSCodeButton>
			{error && (
				<div className="text-xs text-vscode-errorForeground mt-2" role="alert">
					{t("settings:remoteConfig.refreshError", { error })}
				</div>
			)}
		</div>
	)
}

interface SettingRowProps {
	label: string
	value: string | number | boolean | undefined | null
	isSecret?: boolean
}

function SettingRow({ label, value, isSecret }: SettingRowProps) {
	const { t } = useTranslation()
	const displayValue = (() => {
		if (value === undefined || value === null) {
			return <span className="text-description italic">{t("settings:remoteConfig.notConfigured")}</span>
		}
		if (typeof value === "boolean") {
			return value ? (
				<span className="text-green-500">{t("settings:remoteConfig.enabled")}</span>
			) : (
				<span className="text-description">{t("settings:remoteConfig.disabled")}</span>
			)
		}
		if (isSecret && typeof value === "string" && value.length > 0) {
			return <span className="font-mono text-xs">{"•".repeat(Math.min(value.length, 20))}</span>
		}
		return <span className="font-mono text-xs break-all">{String(value)}</span>
	})()

	const isLongValue = typeof value === "string" && value.length > 25
	if (isLongValue) {
		return (
			<div className="flex flex-col gap-1 py-1.5 border-b border-vscode-widget-border last:border-b-0">
				<span className="text-description text-xs">{label}</span>
				<div className="pl-2 overflow-hidden text-right">{displayValue}</div>
			</div>
		)
	}

	return (
		<div className="flex justify-between items-center py-1.5 border-b border-vscode-widget-border last:border-b-0 gap-2">
			<span className="text-description text-xs shrink-0">{label}</span>
			<span className="text-right overflow-hidden text-ellipsis">{displayValue}</span>
		</div>
	)
}

interface TestButtonProps {
	label: string
	onClick: () => Promise<void>
	disabled?: boolean
	successMessage?: string
}

function TestButton({ label, onClick, disabled, successMessage }: TestButtonProps) {
	const { t } = useTranslation()
	const [isLoading, setIsLoading] = useState(false)
	const [result, setResult] = useState<{ success: boolean; message: string } | null>(null)
	const timeoutRef = useRef<NodeJS.Timeout>()

	useEffect(() => {
		return () => {
			if (timeoutRef.current) {
				clearTimeout(timeoutRef.current)
			}
		}
	}, [])

	const handleClick = async () => {
		setIsLoading(true)
		setResult(null)
		try {
			await onClick()
			setResult({ success: true, message: successMessage || t("settings:remoteConfig.success") })
		} catch (error) {
			setResult({ success: false, message: error instanceof Error ? error.message : t("settings:remoteConfig.failed") })
		} finally {
			setIsLoading(false)
			timeoutRef.current = setTimeout(() => setResult(null), 5000)
		}
	}

	return (
		<div className="flex items-center gap-2">
			<VSCodeButton
				appearance="secondary"
				className={isLoading ? "animate-pulse" : ""}
				disabled={disabled || isLoading}
				onClick={handleClick}>
				{isLoading ? t("settings:remoteConfig.testing") : label}
			</VSCodeButton>
			{result && <span className={`text-xs ${result.success ? "text-green-500" : "text-red-500"}`}>{result.message}</span>}
		</div>
	)
}

function OtelSettingsSection() {
	const { t } = useTranslation()
	const { remoteConfigSettings } = useExtensionState()

	const otelEnabled = remoteConfigSettings?.openTelemetryEnabled
	const hasOtelConfig =
		otelEnabled !== undefined ||
		remoteConfigSettings?.openTelemetryOtlpEndpoint !== undefined ||
		remoteConfigSettings?.openTelemetryMetricsExporter !== undefined ||
		remoteConfigSettings?.openTelemetryLogsExporter !== undefined

	if (!hasOtelConfig) {
		return null
	}

	const handleTestOtel = async () => {
		const response = await StateServiceClient.testOtelConnection(EmptyRequest.create({}))
		if (!response.success) {
			throw new Error(response.error || t("settings:remoteConfig.testFailed"))
		}
	}

	return (
		<div className="mb-4">
			<h4 className="text-sm font-medium mb-2 flex items-center gap-2">
				<i className="codicon codicon-pulse" />
				{t("settings:remoteConfig.otel.title")}
			</h4>
			<div className="bg-vscode-textBlockQuote-background rounded p-3 mb-2">
				<SettingRow label={t("settings:remoteConfig.enabled")} value={otelEnabled} />
				<SettingRow
					label={t("settings:remoteConfig.otel.metricsExporter")}
					value={remoteConfigSettings?.openTelemetryMetricsExporter}
				/>
				<SettingRow
					label={t("settings:remoteConfig.otel.logsExporter")}
					value={remoteConfigSettings?.openTelemetryLogsExporter}
				/>
				<SettingRow
					label={t("settings:remoteConfig.otel.otlpProtocol")}
					value={remoteConfigSettings?.openTelemetryOtlpProtocol}
				/>
				<SettingRow
					label={t("settings:remoteConfig.otel.otlpEndpoint")}
					value={remoteConfigSettings?.openTelemetryOtlpEndpoint}
				/>
				{remoteConfigSettings?.openTelemetryOtlpMetricsEndpoint && (
					<SettingRow
						label={t("settings:remoteConfig.otel.metricsEndpoint")}
						value={remoteConfigSettings?.openTelemetryOtlpMetricsEndpoint}
					/>
				)}
				{remoteConfigSettings?.openTelemetryOtlpLogsEndpoint && (
					<SettingRow
						label={t("settings:remoteConfig.otel.logsEndpoint")}
						value={remoteConfigSettings?.openTelemetryOtlpLogsEndpoint}
					/>
				)}
				{remoteConfigSettings?.openTelemetryOtlpHeaders && (
					<SettingRow
						label={t("settings:remoteConfig.otel.otlpHeaders")}
						value={t("settings:remoteConfig.otel.headerCount", {
							count: Object.keys(remoteConfigSettings.openTelemetryOtlpHeaders).length,
						})}
					/>
				)}
				{remoteConfigSettings?.openTelemetryMetricExportInterval && (
					<SettingRow
						label={t("settings:remoteConfig.otel.metricExportInterval")}
						value={`${remoteConfigSettings.openTelemetryMetricExportInterval}ms`}
					/>
				)}
				{remoteConfigSettings?.openTelemetryOtlpInsecure !== undefined && (
					<SettingRow
						label={t("settings:remoteConfig.otel.otlpInsecure")}
						value={remoteConfigSettings?.openTelemetryOtlpInsecure}
					/>
				)}
				{remoteConfigSettings?.openTelemetryLogBatchSize && (
					<SettingRow
						label={t("settings:remoteConfig.otel.logBatchSize")}
						value={remoteConfigSettings?.openTelemetryLogBatchSize}
					/>
				)}
				{remoteConfigSettings?.openTelemetryLogBatchTimeout && (
					<SettingRow
						label={t("settings:remoteConfig.otel.logBatchTimeout")}
						value={`${remoteConfigSettings.openTelemetryLogBatchTimeout}ms`}
					/>
				)}
				{remoteConfigSettings?.openTelemetryLogMaxQueueSize && (
					<SettingRow
						label={t("settings:remoteConfig.otel.logMaxQueueSize")}
						value={remoteConfigSettings?.openTelemetryLogMaxQueueSize}
					/>
				)}
			</div>

			{otelEnabled && (
				<div className="flex gap-2 flex-wrap">
					<TestButton
						disabled={!remoteConfigSettings?.openTelemetryMetricsExporter}
						label={t("settings:remoteConfig.test")}
						onClick={handleTestOtel}
						successMessage={t("settings:remoteConfig.otel.flushSuccess")}
					/>
				</div>
			)}
		</div>
	)
}

function PromptUploadingSection() {
	const { t } = useTranslation()
	const { remoteConfigSettings } = useExtensionState()

	const blobStoreConfig = remoteConfigSettings?.blobStoreConfig
	if (!blobStoreConfig) {
		return null
	}

	const handleTestPromptUploading = async () => {
		const response = await StateServiceClient.testPromptUploading(EmptyRequest.create({}))
		if (!response.success) {
			throw new Error(response.error || t("settings:remoteConfig.testFailed"))
		}
	}

	return (
		<div className="mb-4">
			<h4 className="text-sm font-medium mb-2 flex items-center gap-2">
				<i className="codicon codicon-cloud-upload" />
				{t("settings:remoteConfig.promptUpload.title")}
			</h4>
			<div className="bg-vscode-textBlockQuote-background rounded p-3 mb-2">
				<SettingRow
					label={t("settings:remoteConfig.promptUpload.storageType")}
					value={blobStoreConfig.adapterType?.toUpperCase()}
				/>
				<SettingRow label={t("settings:remoteConfig.promptUpload.bucket")} value={blobStoreConfig.bucket} />
				<SettingRow label={t("settings:remoteConfig.promptUpload.region")} value={blobStoreConfig.region} />
				{blobStoreConfig.endpoint && (
					<SettingRow label={t("settings:remoteConfig.promptUpload.endpoint")} value={blobStoreConfig.endpoint} />
				)}
				{blobStoreConfig.accountId && (
					<SettingRow label={t("settings:remoteConfig.promptUpload.accountId")} value={blobStoreConfig.accountId} />
				)}
				<SettingRow
					isSecret
					label={t("settings:remoteConfig.promptUpload.accessKeyId")}
					value={blobStoreConfig.accessKeyId}
				/>
				<SettingRow
					isSecret
					label={t("settings:remoteConfig.promptUpload.secretAccessKey")}
					value={blobStoreConfig.secretAccessKey}
				/>
				{blobStoreConfig.intervalMs && (
					<SettingRow
						label={t("settings:remoteConfig.promptUpload.syncInterval")}
						value={`${blobStoreConfig.intervalMs}ms`}
					/>
				)}
				{blobStoreConfig.batchSize && (
					<SettingRow label={t("settings:remoteConfig.promptUpload.batchSize")} value={blobStoreConfig.batchSize} />
				)}
				{blobStoreConfig.maxRetries && (
					<SettingRow label={t("settings:remoteConfig.promptUpload.maxRetries")} value={blobStoreConfig.maxRetries} />
				)}
				{blobStoreConfig.maxQueueSize && (
					<SettingRow
						label={t("settings:remoteConfig.promptUpload.maxQueueSize")}
						value={blobStoreConfig.maxQueueSize}
					/>
				)}
				<SettingRow
					label={t("settings:remoteConfig.promptUpload.backfillEnabled")}
					value={blobStoreConfig.backfillEnabled}
				/>
			</div>

			<TestButton label={t("settings:remoteConfig.promptUpload.testUpload")} onClick={handleTestPromptUploading} />
		</div>
	)
}

export function RemoteConfigSection({ renderSectionHeader }: RemoteConfigSectionProps) {
	const { t } = useTranslation()
	const { remoteConfigSettings, optOutOfRemoteConfig, remoteConfigAvailable } = useExtensionState()
	const { activeOrganization } = useClineAuth()

	if (optOutOfRemoteConfig && remoteConfigAvailable) {
		return (
			<BaseRemoteConfigSection renderSectionHeader={renderSectionHeader}>
				<div className="flex flex-col justify-center gap-4">
					<h3>{t("settings:remoteConfig.optedOut")}</h3>

					<RemoteConfigToggle activeOrganization={activeOrganization} />
				</div>
			</BaseRemoteConfigSection>
		)
	}

	if (!remoteConfigSettings || Object.keys(remoteConfigSettings).length === 0) {
		return (
			<BaseRemoteConfigSection renderSectionHeader={renderSectionHeader}>
				<div className="flex flex-col justify-center gap-4">
					<h3>
						<Trans
							components={{
								dashboardLink: <VSCodeLink href="https://app.cline.bot/dashboard/organization?tab=settings" />,
							}}
							i18nKey="settings:remoteConfig.notSetup"
						/>
					</h3>

					<RefreshButton />
				</div>
			</BaseRemoteConfigSection>
		)
	}

	return (
		<BaseRemoteConfigSection renderSectionHeader={renderSectionHeader}>
			<div className="flex flex-col gap-2">
				<p className="text-description text-xs mb-2">{t("settings:remoteConfig.managedNote")}</p>

				<OtelSettingsSection />
				<PromptUploadingSection />

				<div className="mt-2">
					<RefreshButton />
				</div>
			</div>
		</BaseRemoteConfigSection>
	)
}
