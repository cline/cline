import { memo } from "react"

interface ModelInfoSupportsItemProps {
	isSupported: boolean
	supportsLabel: string
	doesNotSupportLabel: string
}

const ModelInfoSupportsItem = ({ isSupported, supportsLabel, doesNotSupportLabel }: ModelInfoSupportsItemProps) => (
	<span
		style={{
			fontWeight: 500,
			color: isSupported ? "var(--vscode-charts-green)" : "var(--vscode-errorForeground)",
		}}>
		<i
			className={`codicon codicon-${isSupported ? "check" : "x"}`}
			style={{
				marginRight: 4,
				marginBottom: isSupported ? 1 : -1,
				fontSize: isSupported ? 11 : 13,
				fontWeight: 700,
				display: "inline-block",
				verticalAlign: "bottom",
			}}></i>
		{isSupported ? supportsLabel : doesNotSupportLabel}
	</span>
)

export default memo(ModelInfoSupportsItem)
