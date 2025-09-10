import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { useState } from "react"
import HeroTooltip from "@/components/common/HeroTooltip"

const CopyTaskButton: React.FC<{
	taskText?: string
}> = ({ taskText }) => {
	const [copied, setCopied] = useState(false)

	const handleCopy = () => {
		if (!taskText) {
			return
		}

		navigator.clipboard.writeText(taskText).then(() => {
			setCopied(true)
			setTimeout(() => setCopied(false), 1500)
		})
	}

	return (
		<HeroTooltip content="Copy Task">
			<VSCodeButton
				appearance="icon"
				aria-label="Copy Task"
				className="flex items-center text-sm font-bold opacity-80 hover:bg-transparent hover:opacity-100"
				onClick={(e) => {
					e.preventDefault()
					e.stopPropagation()
					handleCopy()
				}}>
				<i className={`codicon codicon-${copied ? "check" : "copy"}`} />
			</VSCodeButton>
		</HeroTooltip>
	)
}

export default CopyTaskButton
