import PreferredLanguageSetting from "../PreferredLanguageSetting"
import Section from "../Section"

interface GeneralSettingsSectionProps {
	renderSectionHeader: (tabId: string) => JSX.Element | null
}

const GeneralSettingsSection = ({ renderSectionHeader }: GeneralSettingsSectionProps) => {
	return (
		<div>
			{renderSectionHeader("general")}
			<Section>
				<PreferredLanguageSetting />
			</Section>
		</div>
	)
}

export default GeneralSettingsSection
