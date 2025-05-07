import { useCallback } from "react"
import { useTranslation, Trans } from "react-i18next"
import { VSCodeLink } from "@vscode/webview-ui-toolkit/react"

export const CommandExecutionError = () => {
	const { t } = useTranslation()

	const onClick = useCallback((e: React.MouseEvent<HTMLAnchorElement>) => {
		e.preventDefault()
		window.postMessage({ type: "action", action: "settingsButtonClicked", values: { section: "terminal" } }, "*")
	}, [])

	return (
		<div className="text-sm bg-vscode-editor-background border border-vscode-border rounded-xs p-2">
			<div className="flex flex-col gap-2">
				<div className="flex items-center">
					<i className="codicon codicon-warning mr-1 text-vscode-editorWarning-foreground" />
					<span className="text-vscode-editorWarning-foreground font-medium">
						{t("chat:shellIntegration.title")}
					</span>
				</div>
				<div>
					<Trans
						i18nKey="chat:shellIntegration.description"
						components={{
							settingsLink: <VSCodeLink href="#" onClick={onClick} className="inline" />,
						}}
					/>
				</div>
				<a href="http://docs.roocode.com/troubleshooting/shell-integration/" className="underline text-inherit">
					{t("chat:shellIntegration.troubleshooting")}
				</a>
			</div>
		</div>
	)
}
