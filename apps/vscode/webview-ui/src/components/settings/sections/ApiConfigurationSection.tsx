import { useExtensionState } from "@/context/ExtensionStateContext"
import ApiOptions from "../ApiOptions"
import Section from "../Section"

interface ApiConfigurationSectionProps {
	renderSectionHeader?: (tabId: string) => JSX.Element | null
	initialModelTab?: "recommended" | "free"
}

const ApiConfigurationSection = ({ renderSectionHeader, initialModelTab }: ApiConfigurationSectionProps) => {
	const { mode } = useExtensionState()
	return (
		<div>
			{renderSectionHeader?.("api-config")}
			<Section>
				<ApiOptions currentMode={mode} initialModelTab={initialModelTab} showModelOptions={true} />
			</Section>
		</div>
	)
}

export default ApiConfigurationSection
