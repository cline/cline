import type { ApiProvider } from "@shared/api"
import type { Mode } from "@shared/storage/types"
import styled from "styled-components"
import VSCodeButtonLink from "@/components/common/VSCodeButtonLink"
import { useClineAuth } from "@/context/ClineAuthContext"
import { buildClinePassSubscriptionUrl } from "@/utils/clinePassSubscription"
import { ClineAccountInfoCard } from "../ClineAccountInfoCard"
import ClineModelPicker from "../ClineModelPicker"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"
import { ClinePassProvider } from "./ClinePassProvider"

/**
 * Props for the ClineProvider component
 */
export interface ClineProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
	initialModelTab?: "recommended" | "free"
	isClinePassEnabled?: boolean
	selectedProvider?: ApiProvider
}

type ClineBillingRoute = "cline" | "cline-pass"

/**
 * The Cline provider configuration component
 */
export const ClineProvider = ({
	showModelOptions,
	isPopup,
	currentMode,
	initialModelTab,
	isClinePassEnabled,
	selectedProvider,
}: ClineProviderProps) => {
	const { handleModeFieldChange } = useApiConfigurationHandlers()
	const { clineUser } = useClineAuth()
	const activeRoute: ClineBillingRoute = selectedProvider === "cline-pass" && isClinePassEnabled ? "cline-pass" : "cline"
	const clinePassSubscribeUrl = clineUser ? buildClinePassSubscriptionUrl(clineUser.appBaseUrl) : undefined

	const handleRouteChange = async (route: ClineBillingRoute) => {
		if (route === activeRoute) {
			return
		}

		await handleModeFieldChange({ plan: "planModeApiProvider", act: "actModeApiProvider" }, route, currentMode)
	}

	return (
		<div>
			{isClinePassEnabled && (
				<RouteContainer>
					<RouteStatus>
						{activeRoute === "cline-pass" ? (
							<>
								ClinePass is a low cost subscription plan including usage of the best open weights models, plus
								Cline's free models.{" "}
								<RouteLink
									href="#"
									onClick={(event) => {
										event.preventDefault()
										handleRouteChange("cline").catch((error) => console.error("Failed to switch to Cline:", error))
									}}>
									Switch to Cline Usage-Billing for the full model catalog.
								</RouteLink>
							</>
						) : (
							<>
								Usage-Billing models bill to your Cline account balance.{" "}
								<RouteLink
									href="#"
									onClick={(event) => {
										event.preventDefault()
										handleRouteChange("cline-pass").catch((error) =>
											console.error("Failed to switch to ClinePass:", error),
										)
									}}>
									Switch to ClinePass provider to access subscription.
								</RouteLink>
							</>
						)}
					</RouteStatus>
					<RouteActions>
						{activeRoute === "cline" && <ClineAccountInfoCard />}
						{activeRoute === "cline-pass" && (
							clinePassSubscribeUrl ? (
								<VSCodeButtonLink appearance="secondary" href={clinePassSubscribeUrl}>
									Manage ClinePass or See Usage
								</VSCodeButtonLink>
							) : (
								<ClineAccountInfoCard />
							)
						)}
					</RouteActions>
				</RouteContainer>
			)}
			{!isClinePassEnabled && (
				<StandaloneRouteActions>
					<ClineAccountInfoCard />
				</StandaloneRouteActions>
			)}

			{showModelOptions && (
				activeRoute === "cline-pass" ? (
					<ClinePassProvider
						currentMode={currentMode}
						isPopup={isPopup}
						showAccountCard={false}
						showModelOptions={showModelOptions}
					/>
				) : (
					<ClineModelPicker
						currentMode={currentMode}
						initialTab={initialModelTab}
						isClinePassEnabled={isClinePassEnabled}
						isPopup={isPopup}
						showProviderRouting={true}
					/>
				)
			)}
		</div>
	)
}

const RouteContainer = styled.div`
	margin-bottom: 10px;
`

const RouteStatus = styled.div`
	font-size: 11px;
	line-height: 1.35;
	color: var(--vscode-descriptionForeground);
`

const RouteLink = styled.a`
	color: var(--vscode-textLink-foreground);
	font: inherit;
	line-height: inherit;
	cursor: pointer !important;
	text-decoration: none;

	&:hover {
		color: var(--vscode-textLink-activeForeground, var(--vscode-textLink-foreground));
		cursor: pointer !important;
		text-decoration: underline;
	}
`

const RouteActions = styled.div`
	display: flex;
	flex-direction: column;
	align-items: flex-start;
	gap: 6px;
	margin-top: 8px;
`

const StandaloneRouteActions = styled(RouteActions)`
	margin: 4px 0 14px;
`
