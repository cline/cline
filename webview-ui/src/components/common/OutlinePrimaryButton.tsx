import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"

interface OutlinePrimaryButtonProps extends React.ComponentProps<typeof VSCodeButton> {}

const OutlinePrimaryButton: React.FC<OutlinePrimaryButtonProps> = (props) => {
	return (
		<VSCodeButton
			{...props}
			className={`
				bg-transparent! 
				border-[var(--vscode-button-background)]! 
				border-[1px]!
				border-solid!
				text-[var(--vscode-button-background)]!
				hover:bg-[color-mix(in_srgb,var(--vscode-button-background)_15%,transparent)]! 
				active:bg-[color-mix(in_srgb,var(--vscode-button-background)_25%,transparent)]!
				${props.className || ""}
			`
				.replace(/\s+/g, " ")
				.trim()}
		/>
	)
}

export default OutlinePrimaryButton
