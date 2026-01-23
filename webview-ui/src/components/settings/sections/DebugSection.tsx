import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { StateServiceClient } from "@/services/grpc-client"
import Section from "../Section"

interface DebugSectionProps {
	onResetState: (resetGlobalState?: boolean) => Promise<void>
	renderSectionHeader: (tabId: string) => JSX.Element | null
}

const DebugSection = ({ onResetState, renderSectionHeader }: DebugSectionProps) => {
	const { t } = useTranslation()
	const { setShowWelcome } = useExtensionState()
	return (
		<div>
			{renderSectionHeader("debug")}
			<Section>
				<Button onClick={() => onResetState()} variant="error">
					{t("debugSection.resetWorkspaceState")}
				</Button>
				<Button onClick={() => onResetState(true)} variant="error">
					{t("debugSection.resetGlobalState")}
				</Button>
				<p className="text-xs mt-[5px] text-(--vscode-descriptionForeground)">
					{t("debugSection.resetGlobalStateDescription")}
				</p>
			</Section>
			<Section>
				<Button
					onClick={async () =>
						await StateServiceClient.setWelcomeViewCompleted({ value: false })
							.catch(() => {})
							.finally(() => setShowWelcome(true))
					}
					variant="secondary">
					{t("debugSection.resetOnboardingState")}
				</Button>
			</Section>
		</div>
	)
}

export default DebugSection
