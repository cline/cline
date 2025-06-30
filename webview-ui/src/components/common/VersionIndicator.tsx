import React from "react"
import { useTranslation } from "react-i18next"
import { Package } from "@roo/package"

interface VersionIndicatorProps {
	onClick: () => void
	className?: string
}

const VersionIndicator: React.FC<VersionIndicatorProps> = ({ onClick, className = "" }) => {
	const { t } = useTranslation()

	return (
		<button
			onClick={onClick}
			className={`text-xs text-vscode-descriptionForeground hover:text-vscode-foreground transition-colors cursor-pointer px-2 py-1 rounded border border-vscode-panel-border hover:border-vscode-focusBorder ${className}`}
			aria-label={t("chat:versionIndicator.ariaLabel", { version: Package.version })}>
			v{Package.version}
		</button>
	)
}

export default VersionIndicator
