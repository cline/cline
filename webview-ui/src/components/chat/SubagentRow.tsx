import { ClineMessage, ClineSayTool } from "@shared/ExtensionMessage"
import { Loader2Icon, ScanSearchIcon } from "lucide-react"
import React, { useState } from "react"
import { Button } from "@/components/ui/button"

interface SubagentRowProps {
	message: ClineMessage
	tool: ClineSayTool
	className?: string
}

const SubagentRow: React.FC<SubagentRowProps> = ({ className, message, tool }) => {
	const [isExpanded, setIsExpanded] = useState(false)

	return (
		<div key={message.uid}>
			<div className={className}>
				{message.partial !== false ? (
					<Loader2Icon className="size-2 animate-spin" />
				) : (
					<ScanSearchIcon className="size-2" />
				)}
				<span className="bold">Cline requested help from subagent:</span>
			</div>
			<Button
				className="bg-code-block-background text-description border border-editor-group-border rounded-xs overflow-hidden w-full flex flex-col justify-start items-start text-left"
				key={message.ts}
				onClick={() => setIsExpanded(!isExpanded)}
				variant="ghost">
				{/* Search Agent Query */}
				<span className="w-full break-words whitespace-normal text-left">{tool.filePattern} </span>
				{isExpanded && (
					<div className="w-full flex flex-col gap-1 text-left select-text pt-1 max-h-40 overflow-y-scroll bg-code/20">
						{tool.content?.split("\n")?.map((line) => (
							<div className="w-full">{line}</div>
						))}
					</div>
				)}
			</Button>
		</div>
	)
}

export default SubagentRow
