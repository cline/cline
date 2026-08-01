import { openAiModelInfoSafeDefaults } from "@shared/api"
import { CommitModelSelectionRequest } from "@shared/proto/cline/models"
import { AskResponseRequest } from "@shared/proto/cline/task"
import type { Mode } from "@shared/storage/types"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import type React from "react"
import { useMemo, useState } from "react"
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

const CLINE_PROVIDER_ID = "cline"
const CLINE_PASS_MODEL_PREFIX = "cline-pass/"

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

// ClinePass ids are cline-pass/<model-slug>; the same model is sold per token
// on the Cline provider under its lab prefix (e.g. cline-pass/deepseek-v4-flash
// -> deepseek/deepseek-v4-flash). Mirrors ClineFreeModelLimitError's mapping of
// cline-free/ ids to their paid twins.
function findUsageBilledModelId(modelId: string | undefined, clineModelIds: string[]): string | undefined {
	if (!modelId?.startsWith(CLINE_PASS_MODEL_PREFIX)) {
		return undefined
	}

	const modelSlug = modelId.slice(CLINE_PASS_MODEL_PREFIX.length)
	if (!modelSlug) {
		return undefined
	}

	return clineModelIds.find(
		(candidateId) =>
			!candidateId.startsWith(CLINE_PASS_MODEL_PREFIX) &&
			(candidateId === modelSlug || candidateId.endsWith(`/${modelSlug}`)),
	)
}

const EntitlementError: React.FC<EntitlementErrorProps> = ({ message }) => {
	const { clineUser } = useClineAuth()
	const { apiConfiguration, mode } = useExtensionState()
	const { models: clineModels } = useProviderModels(CLINE_PROVIDER_ID)
	const { handleModeFieldsChange } = useApiConfigurationHandlers()
	const [isSwitching, setIsSwitching] = useState(false)
	// Committing the switch rewrites the very selection the target is derived
	// from, so latch it or the confirmation vanishes as soon as the write lands.
	const [switchedModelId, setSwitchedModelId] = useState<string | undefined>()
	const [switchError, setSwitchError] = useState<string | undefined>()

	const subscribeUrl = buildSubscribeUrl(clineUser?.appBaseUrl)
	const backendDetail = message && message !== HEADLINE ? message : undefined

	const currentMode: Mode = mode ?? "act"
	const modeFields = getModeSpecificFields(apiConfiguration, currentMode)
	// The subscription-gated id normally lives under the cline-pass provider, but
	// it can also be typed into the Cline usage-billing picker by hand.
	const selectedModelId =
		modeFields.apiProvider === "cline-pass"
			? modeFields.clinePassModelId
			: modeFields.apiProvider === CLINE_PROVIDER_ID
				? modeFields.clineModelId
				: undefined
	// ClinePass models are also sold per token on the Cline provider, so an
	// account without the subscription can still run the same model.
	const resolvedModelId = useMemo(
		() => findUsageBilledModelId(selectedModelId, Object.keys(clineModels ?? {})),
		[selectedModelId, clineModels],
	)
	const usageBilledModelId = switchedModelId ?? resolvedModelId
	const didSwitch = switchedModelId !== undefined

	const handleSwitchToUsageBasedBilling = async () => {
		if (!resolvedModelId) {
			return
		}
		setIsSwitching(true)
		setSwitchError(undefined)
		try {
			const modelInfo = clineModels?.[resolvedModelId] ?? {
				...openAiModelInfoSafeDefaults,
				name: resolvedModelId,
			}

			await ModelsServiceClient.commitModelSelection(
				CommitModelSelectionRequest.create({
					providerId: CLINE_PROVIDER_ID,
					mode: currentMode,
					modelId: resolvedModelId,
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
					clineModelId: resolvedModelId,
					clineModelInfo: modelInfo,
				},
				currentMode,
			)
			setSwitchedModelId(resolvedModelId)
		} catch (error) {
			console.error("Failed to switch to Cline usage-based billing:", error)
			setSwitchError(
				`Failed to switch model. Select ${resolvedModelId} on Cline Usage-Billing in API Configuration settings.`,
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
