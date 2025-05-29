import React from "react"
import { useAppTranslation } from "@/i18n/TranslationContext"

export const ProfileViolationWarning: React.FC = () => {
	const { t } = useAppTranslation()

	return (
		<div className="flex items-center px-4 py-2 mb-2 text-sm rounded bg-vscode-editorWarning-foreground text-vscode-editor-background">
			<div className="flex items-center justify-center w-5 h-5 mr-2">
				<span className="codicon codicon-warning" />
			</div>
			<span>{t("chat:profileViolationWarning")}</span>
		</div>
	)
}

export default ProfileViolationWarning
