import { VSCodeDropdown, VSCodeOption } from "@vscode/webview-ui-toolkit/react"
import { languageOptions, LanguageKey } from "../../../../src/shared/Languages"
import {
	getAsVar,
	VSC_INPUT_BACKGROUND,
	VSC_INPUT_FOREGROUND,
	VSC_INPUT_BORDER,
	VSC_DESCRIPTION_FOREGROUND,
} from "../../utils/vscStyles"

interface PreferredLanguagePickerProps {
	selectedLanguage: LanguageKey | undefined
	onSelectLanguage: (value: LanguageKey) => void
}

const PreferredLanguagePicker: React.FC<PreferredLanguagePickerProps> = ({ selectedLanguage, onSelectLanguage }) => {
	return (
		<div style={{ marginBottom: "20px" }}>
			<div style={{ fontWeight: "bold", marginBottom: "4px" }}>Preferred Language</div>

			<VSCodeDropdown
				value={selectedLanguage}
				onChange={(e) => {
					onSelectLanguage((e.target as HTMLSelectElement).value as LanguageKey)
				}}
				style={{
					width: "100%",
					backgroundColor: getAsVar(VSC_INPUT_BACKGROUND),
					color: getAsVar(VSC_INPUT_FOREGROUND),
					border: `1px solid ${getAsVar(VSC_INPUT_BORDER)}`,
					borderRadius: "2px",
					height: "28px",
				}}>
				{languageOptions.map((language) => (
					<VSCodeOption key={language.key} value={language.key}>
						{language.display}
					</VSCodeOption>
				))}
			</VSCodeDropdown>
			<p
				style={{
					fontSize: "12px",
					marginTop: "5px",
					color: getAsVar(VSC_DESCRIPTION_FOREGROUND),
				}}>
				Select the language that Cline should use for communication.
			</p>
		</div>
	)
}

export default PreferredLanguagePicker
