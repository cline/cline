import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import { FormEvent } from "react"
import { useExtensionState } from "@src/context/ExtensionStateContext"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { vscode } from "@src/utils/vscode"

const McpEnabledToggle = () => {
	const { mcpEnabled, setMcpEnabled } = useExtensionState()
	const { t } = useAppTranslation()

	const handleChange = (e: Event | FormEvent<HTMLElement>) => {
		const target = ("target" in e ? e.target : null) as HTMLInputElement | null
		if (!target) return
		setMcpEnabled(target.checked)
		vscode.postMessage({ type: "mcpEnabled", bool: target.checked })
	}

	return (
		<div className="mb-5">
			<VSCodeCheckbox checked={mcpEnabled} onChange={handleChange}>
				<span className="font-medium">{t("mcp:enableToggle.title")}</span>
			</VSCodeCheckbox>
			<p className="text-xs mt-[5px] text-vscode-descriptionForeground">{t("mcp:enableToggle.description")}</p>
		</div>
	)
}

export default McpEnabledToggle
