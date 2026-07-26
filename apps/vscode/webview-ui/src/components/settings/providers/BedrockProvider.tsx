import { type ApiConfiguration, BEDROCK_DEFAULT_REGION } from "@shared/api"
import { type BedrockTarget, bedrockTargetKey } from "@shared/bedrock-startup"
import { EmptyRequest } from "@shared/proto/bedrock_coder/common"
import { BedrockTargetSelectionRequest } from "@shared/proto/bedrock_coder/models"
import type { Mode } from "@shared/storage/types"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { useEffect, useMemo, useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ModelsServiceClient } from "@/services/grpc-client"
import { DebouncedTextField } from "../common/DebouncedTextField"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

interface BedrockProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

function TargetOption({ target, failed }: { target: BedrockTarget; failed: boolean }) {
	const targetType =
		target.kind === "inference-profile"
			? `${target.profileType === "APPLICATION" ? "Application" : "System-defined"} profile`
			: "Foundation model"
	const details = [targetType, target.providerName, target.baseModelId, target.streaming ? "streaming" : undefined]
		.filter(Boolean)
		.join(" · ")
	return (
		<option value={bedrockTargetKey(target)}>
			{target.displayName} — {target.invocationId}
			{details ? ` · ${details}` : ""}
			{failed ? " · probe failed" : ""}
		</option>
	)
}

export const BedrockProvider = ({ showModelOptions }: BedrockProviderProps) => {
	const { apiConfiguration, bedrockStartup } = useExtensionState()
	const { handleFieldChange } = useApiConfigurationHandlers()
	const [now, setNow] = useState(Date.now())
	const config = apiConfiguration ?? {}

	useEffect(() => {
		if (!bedrockStartup?.progress.cancellable) return
		const timer = window.setInterval(() => setNow(Date.now()), 1_000)
		return () => window.clearInterval(timer)
	}, [bedrockStartup?.progress.cancellable])

	const saveConnection = <K extends keyof ApiConfiguration>(field: K, value: ApiConfiguration[K]) => {
		void handleFieldChange(field, value)
	}
	const foundationModels = useMemo(
		() => bedrockStartup?.targets.filter((target) => target.kind === "foundation-model") ?? [],
		[bedrockStartup?.targets],
	)
	const inferenceProfiles = useMemo(
		() => bedrockStartup?.targets.filter((target) => target.kind === "inference-profile") ?? [],
		[bedrockStartup?.targets],
	)
	const elapsedSeconds = bedrockStartup ? Math.max(0, Math.floor((now - bedrockStartup.progress.startedAt) / 1_000)) : 0

	const selectTarget = (value: string) => {
		const target = bedrockStartup?.targets.find((candidate) => bedrockTargetKey(candidate) === value)
		if (!target) return
		void ModelsServiceClient.selectBedrockTarget(
			BedrockTargetSelectionRequest.create({
				kind: target.kind,
				invocationId: target.invocationId,
			}),
		)
	}

	return (
		<div className="flex flex-col gap-3">
			<div>
				<h3 className="m-0">AWS Bedrock startup</h3>
				<p className="text-description m-0 mt-1">
					Credentials come from the extension environment or the selected AWS profile. SSO authentication stays external
					to the extension.
				</p>
			</div>

			<DebouncedTextField
				initialValue={config.awsRegion || BEDROCK_DEFAULT_REGION}
				onChange={(value) => saveConnection("awsRegion", value)}
				placeholder={BEDROCK_DEFAULT_REGION}
				style={{ width: "100%" }}>
				AWS region
			</DebouncedTextField>

			<DebouncedTextField
				initialValue={config.awsProfile || ""}
				onChange={(value) => saveConnection("awsProfile", value || undefined)}
				placeholder="Optional, e.g. engineering-sso"
				style={{ width: "100%" }}>
				AWS profile (optional)
			</DebouncedTextField>

			<DebouncedTextField
				initialValue={config.awsBedrockEndpoint || ""}
				onChange={(value) => saveConnection("awsBedrockEndpoint", value || undefined)}
				placeholder="Optional Bedrock Runtime HTTPS endpoint"
				style={{ width: "100%" }}>
				Runtime endpoint (optional)
			</DebouncedTextField>

			<DebouncedTextField
				initialValue={config.awsBedrockCaBundlePath || ""}
				onChange={(value) => saveConnection("awsBedrockCaBundlePath", value || undefined)}
				placeholder="Optional absolute or workspace-relative PEM path"
				style={{ width: "100%" }}>
				CA bundle path (optional)
			</DebouncedTextField>

			<details>
				<summary className="cursor-pointer text-description">Advanced custom endpoint</summary>
				<div className="mt-2">
					<DebouncedTextField
						initialValue={config.awsBedrockControlPlaneEndpoint || ""}
						onChange={(value) => saveConnection("awsBedrockControlPlaneEndpoint", value || undefined)}
						placeholder="Optional Bedrock control-plane HTTPS endpoint"
						style={{ width: "100%" }}>
						Control-plane endpoint (optional)
					</DebouncedTextField>
					<p className="text-xs text-description mt-1 mb-0">
						Do not reuse a Runtime/VPC endpoint here. AWS exposes separate Bedrock control-plane and Runtime services.
					</p>
				</div>
			</details>

			<div className="rounded border border-solid border-(--vscode-panel-border) p-3 flex flex-col gap-2">
				<div className="flex justify-between gap-2">
					<strong>{bedrockStartup?.progress.label ?? "Starting Bedrock validation"}</strong>
					<span className="text-description">{elapsedSeconds}s</span>
				</div>
				{bedrockStartup && (
					<div className="text-xs text-description">
						{bedrockStartup.connectionSummary.region} · {bedrockStartup.connectionSummary.profile}
						{bedrockStartup.maskedAccountId ? ` · account ${bedrockStartup.maskedAccountId}` : ""}
						{bedrockStartup.discoveryFromCache ? " · session cache" : ""}
					</div>
				)}

				{showModelOptions && (foundationModels.length > 0 || inferenceProfiles.length > 0) && (
					<label className="flex flex-col gap-1">
						<span>Invocable destination</span>
						<select
							className="w-full bg-(--vscode-dropdown-background) text-(--vscode-dropdown-foreground) border border-solid border-(--vscode-dropdown-border) p-1"
							onChange={(event) => selectTarget(event.target.value)}
							value={bedrockStartup?.selectedTarget ? bedrockTargetKey(bedrockStartup.selectedTarget) : ""}>
							<option disabled value="">
								Choose a destination
							</option>
							{foundationModels.length > 0 && (
								<optgroup label="Foundation models">
									{foundationModels.map((target) => (
										<TargetOption
											failed={Boolean(bedrockStartup?.probeFailures[bedrockTargetKey(target)])}
											key={bedrockTargetKey(target)}
											target={target}
										/>
									))}
								</optgroup>
							)}
							{inferenceProfiles.length > 0 && (
								<optgroup label="Inference profiles">
									{inferenceProfiles.map((target) => (
										<TargetOption
											failed={Boolean(bedrockStartup?.probeFailures[bedrockTargetKey(target)])}
											key={bedrockTargetKey(target)}
											target={target}
										/>
									))}
								</optgroup>
							)}
						</select>
					</label>
				)}

				{bedrockStartup?.selectedTarget && (
					<div className="text-xs">
						<div>
							{bedrockStartup.selectedTarget.kind === "inference-profile"
								? `${bedrockStartup.selectedTarget.profileType} profile`
								: "Foundation model"}
							{" · streaming text"}
						</div>
						<code className="break-all">{bedrockStartup.selectedTarget.invocationId}</code>
					</div>
				)}

				{bedrockStartup?.notice && <p className="text-xs text-description m-0">{bedrockStartup.notice}</p>}
				{bedrockStartup?.error && (
					<div className="text-xs text-error">
						<div>{bedrockStartup.error.message}</div>
						<div>
							{[
								bedrockStartup.error.service,
								bedrockStartup.error.operation,
								bedrockStartup.error.awsCode,
								bedrockStartup.error.httpStatus,
								bedrockStartup.error.requestId,
							]
								.filter((value) => value !== undefined)
								.join(" · ")}
						</div>
						{bedrockStartup.error.suggestion && <div>{bedrockStartup.error.suggestion}</div>}
					</div>
				)}

				<p className="text-xs text-description m-0">
					The selected destination is probed once through the production streaming runtime with a harmless tool
					definition. This may incur a very small Bedrock charge.
				</p>

				<div className="flex flex-wrap gap-2">
					<VSCodeButton
						appearance="secondary"
						onClick={() => void ModelsServiceClient.retryBedrockStartup(EmptyRequest.create())}>
						Retry
					</VSCodeButton>
					<VSCodeButton
						appearance="secondary"
						onClick={() => void ModelsServiceClient.refreshBedrockDiscovery(EmptyRequest.create())}>
						Refresh
					</VSCodeButton>
					{bedrockStartup?.progress.cancellable && (
						<VSCodeButton
							appearance="secondary"
							onClick={() => void ModelsServiceClient.cancelBedrockStartup(EmptyRequest.create())}>
							Cancel
						</VSCodeButton>
					)}
					<VSCodeButton
						appearance="secondary"
						onClick={() => void ModelsServiceClient.copyBedrockDiagnostics(EmptyRequest.create())}>
						Copy diagnostics
					</VSCodeButton>
					<VSCodeButton
						appearance="secondary"
						onClick={() => void ModelsServiceClient.openBedrockDiagnosticLog(EmptyRequest.create())}>
						Open log
					</VSCodeButton>
				</div>
			</div>

			<p className="text-xs text-description m-0">
				Required IAM actions: bedrock:ListFoundationModels, bedrock:ListInferenceProfiles, bedrock:GetInferenceProfile,
				bedrock:InvokeModel, and bedrock:InvokeModelWithResponseStream.
			</p>
		</div>
	)
}
