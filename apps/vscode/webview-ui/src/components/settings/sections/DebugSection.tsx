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
	const { setShowWelcome } = useExtensionState()
	const { t } = useTranslation()
	return (
		<div>
			{renderSectionHeader("debug")}
			<Section>
				<Button onClick={() => onResetState()} variant="error">
					{t("settings:debug.resetWorkspaceState")}
				</Button>
				<Button onClick={() => onResetState(true)} variant="error">
					{t("settings:debug.resetGlobalState")}
				</Button>
				<p className="text-xs mt-[5px] text-(--vscode-descriptionForeground)">
					{t("settings:debug.resetGlobalStateDescription")}
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
					{t("settings:debug.resetOnboardingState")}
				</Button>
			</Section>
		</div>
	)
}

export default DebugSection
