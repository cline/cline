import { openAiModelInfoSafeDefaults } from "@shared/api"
import { CommitModelSelectionRequest } from "@shared/proto/cline/models"
import { AskResponseRequest } from "@shared/proto/cline/task"
import type { Mode } from "@shared/storage/types"
import { CLINE_PASS_PROVIDER_ID, CLINE_PROVIDER_ID, findUsageBilledModelId } from "@shared/utils/cline"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import React, { useMemo, useState } from "react"
import VSCodeButtonLink from "@/components/common/VSCodeButtonLink"
import { getModeSpecificFields } from "@/components/settings/utils/providerUtils"
import { useApiConfigurationHandlers } from "@/components/settings/utils/useApiConfigurationHandlers"
import { useClineAuth } from "@/context/ClineAuthContext"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useProviderModels } from "@/hooks/useProviderModels"
import { ModelsServiceClient, TaskServiceClient } from "@/services/grpc-client"

interface EntitlementErrorProps {
	message?: string
}

// Relative (no leading slash) so it appends to path-prefixed app URLs (e.g. self-hosted/proxy) instead of resetting to origin.
const CLINE_PASS_SUBSCRIBE_PATH = "dashboard/subscription"

const HEADLINE = "This model requires a ClinePass subscription."

function buildSubscribeUrl(appBaseUrl?: string): string | undefined {
	if (!appBaseUrl) {
		return undefined
	}
	try {
		const base = appBaseUrl.endsWith("/") ? appBaseUrl : `${appBaseUrl}/`
		const url = new URL(CLINE_PASS_SUBSCRIBE_PATH, base)
		url.searchParams.set("personal", "true")
		return url.toString()
	} catch {
		// Malformed appBaseUrl: omit the link rather than crashing the error card.
		return undefined
	}
}

const EntitlementError: React.FC<EntitlementErrorProps> = ({ message }) => {
	const { clineUser } = useClineAuth()
	const { apiConfiguration, mode } = useExtensionState()
	const { models: clineModels } = useProviderModels(CLINE_PROVIDER_ID)
	const { handleModeFieldsChange } = useApiConfigurationHandlers()
	const [isSwitching, setIsSwitching] = useState(false)
	const [didSwitch, setDidSwitch] = useState(false)
	const [switchError, setSwitchError] = useState<string | undefined>()

	const subscribeUrl = buildSubscribeUrl(clineUser?.appBaseUrl)
	const backendDetail = message && message !== HEADLINE ? message : undefined

	const currentMode: Mode = mode ?? "act"
	const modeFields = getModeSpecificFields(apiConfiguration, currentMode)
	// The subscription-gated id normally lives under the cline-pass provider, but
	// it can also be typed into the Cline usage-billing picker by hand.
	const selectedModelId =
		modeFields.apiProvider === CLINE_PASS_PROVIDER_ID
			? modeFields.clinePassModelId
			: modeFields.apiProvider === CLINE_PROVIDER_ID
				? modeFields.clineModelId
				: undefined
	// ClinePass models are also sold per-token on the Cline provider, so an
	// account without the subscription can still run the same model.
	const usageBilledModelId = useMemo(
		() => findUsageBilledModelId(selectedModelId, Object.keys(clineModels ?? {})),
		[selectedModelId, clineModels],
	)

	const handleSwitchToUsageBasedBilling = async () => {
		if (!usageBilledModelId) {
			return
		}
		setIsSwitching(true)
		setSwitchError(undefined)
		try {
			const modelInfo = clineModels?.[usageBilledModelId] ?? {
				...openAiModelInfoSafeDefaults,
				name: usageBilledModelId,
			}

			await ModelsServiceClient.commitModelSelection(
				CommitModelSelectionRequest.create({
					providerId: CLINE_PROVIDER_ID,
					mode: currentMode,
					modelId: usageBilledModelId,
				}),
			)

			await handleModeFieldsChange(
				{
					apiProvider: {
						plan: "planModeApiProvider",
						act: "actModeApiProvider",
					},
					clineModelId: {
						plan: "planModeClineModelId",
						act: "actModeClineModelId",
					},
					clineModelInfo: {
						plan: "planModeClineModelInfo",
						act: "actModeClineModelInfo",
					},
				},
				{
					apiProvider: CLINE_PROVIDER_ID,
					clineModelId: usageBilledModelId,
					clineModelInfo: modelInfo,
				},
				currentMode,
			)
			setDidSwitch(true)
		} catch (error) {
			console.error("Failed to switch to Cline usage-based billing:", error)
			setSwitchError(
				`Failed to switch model. Select ${usageBilledModelId} on Cline Usage-Billing in API Configuration settings.`,
			)
		} finally {
			setIsSwitching(false)
		}
	}

	return (
		<div className="p-2 border-none rounded-md mb-2 bg-(--vscode-textBlockQuote-background)" data-testid="entitlement-error">
			<div className="mb-3">
				<div className="text-error mb-2">{HEADLINE}</div>
				<div className="text-(--vscode-descriptionForeground) text-xs">
					{usageBilledModelId
						? "Subscribe to ClinePass, or run the same model on Cline usage-based billing, then retry your request."
						: "Subscribe to ClinePass to use this model, then retry your request."}
				</div>
				{backendDetail && (
					<div className="text-(--vscode-descriptionForeground) text-xs mt-1 opacity-80 wrap-anywhere">
						{backendDetail}
					</div>
				)}
			</div>

			{usageBilledModelId && (
				<>
					<div className="text-(--vscode-descriptionForeground) text-xs mb-2 wrap-anywhere">
						No subscription needed: {usageBilledModelId} is billed per token against your Cline credits.
					</div>
					<VSCodeButton
						appearance="primary"
						className="w-full mb-2"
						disabled={isSwitching || didSwitch}
						onClick={handleSwitchToUsageBasedBilling}>
						{isSwitching
							? "Switching..."
							: didSwitch
								? "Switched to Usage-Based billing"
								: "Switch to Usage-Based billing"}
					</VSCodeButton>
					{didSwitch && (
						<div className="text-(--vscode-descriptionForeground) text-xs mb-2">
							Retry the request after switching.
						</div>
					)}
					{switchError && <div className="text-error text-xs mb-2">{switchError}</div>}
				</>
			)}

			{subscribeUrl && (
				<VSCodeButtonLink
					appearance={usageBilledModelId ? "secondary" : undefined}
					className="w-full mb-2"
					href={subscribeUrl}>
					<span className="codicon codicon-rocket mr-[6px] text-[14px]" />
					Get ClinePass
				</VSCodeButtonLink>
			)}

			<VSCodeButton
				appearance="secondary"
				className="w-full"
				onClick={async () => {
					try {
						await TaskServiceClient.askResponse(
							AskResponseRequest.create({
								responseType: "yesButtonClicked",
							}),
						)
					} catch (error) {
						console.error("Error invoking action:", error)
					}
				}}>
				<span className="codicon codicon-refresh mr-1.5" />
				Retry Request
			</VSCodeButton>
		</div>
	)
}

export default EntitlementError
