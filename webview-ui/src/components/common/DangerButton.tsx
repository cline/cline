import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"

interface DangerButtonProps extends React.ComponentProps<typeof VSCodeButton> {}

const DangerButton: React.FC<DangerButtonProps> = (props) => {
	return (
		<VSCodeButton
			{...props}
			className={`
				bg-[#c42b2b]! 
				border-[#c42b2b]! 
				text-white!
				hover:bg-[#a82424]! 
				hover:border-[#a82424]!
				active:bg-[#8f1f1f]! 
				active:border-[#8f1f1f]!
				${props.className || ""}
			`}
		/>
	)
}

export default DangerButton
