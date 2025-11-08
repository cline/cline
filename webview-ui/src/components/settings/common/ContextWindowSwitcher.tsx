import { VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { useMemo } from "react"
import { useTranslation } from "react-i18next"

interface ContextWindowSwitcherProps {
	selectedModelId: string
	base200kModelId: string
	base1mModelId: string
	onModelChange: (modelId: string) => void
}

/**
 * A shared component for switching between 200K and 1M context window variants of Claude models.
 */
export const ContextWindowSwitcher = ({
	selectedModelId,
	base200kModelId,
	base1mModelId,
	onModelChange,
}: ContextWindowSwitcherProps) => {
	const { t } = useTranslation("common")

	const switcherInfo = useMemo(() => {
		if (selectedModelId === base200kModelId) {
			return {
				current: base200kModelId,
				alternate: base1mModelId,
				linkText: t("api_provider.common.context_window_switcher.switch_to_1m"),
			}
		} else if (selectedModelId === base1mModelId) {
			return {
				current: base1mModelId,
				alternate: base200kModelId,
				linkText: t("api_provider.common.context_window_switcher.switch_to_200k"),
			}
		}
		return null
	}, [selectedModelId, base200kModelId, base1mModelId, t])

	if (!switcherInfo) {
		return null
	}

	return (
		<div style={{ marginBottom: 2 }}>
			<VSCodeLink
				onClick={() => onModelChange(switcherInfo.alternate)}
				style={{
					display: "inline",
					fontSize: "10.5px",
					color: "var(--vscode-textLink-foreground)",
				}}>
				{switcherInfo.linkText}
			</VSCodeLink>
		</div>
	)
}
