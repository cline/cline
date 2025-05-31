import HeroTooltip from "@/components/common/HeroTooltip"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { useState } from "react"

const CopyTaskButton: React.FC<{
	taskText?: string
}> = ({ taskText }) => {
	const [copied, setCopied] = useState(false)

	const handleCopy = () => {
		if (!taskText) return

		navigator.clipboard.writeText(taskText).then(() => {
			setCopied(true)
			setTimeout(() => setCopied(false), 1500)
		})
	}

	return (
		<HeroTooltip content="Copy Task">
			<VSCodeButton
				appearance="icon"
				onClick={handleCopy}
				style={{ padding: "0px 0px" }}
				className="p-0"
				aria-label="Copy Task">
				<div className="flex items-center gap-[3px] text-[8px] font-bold opacity-60">
					<i className={`codicon codicon-${copied ? "check" : "copy"}`} />
				</div>
			</VSCodeButton>
		</HeroTooltip>
	)
}

export default CopyTaskButton
