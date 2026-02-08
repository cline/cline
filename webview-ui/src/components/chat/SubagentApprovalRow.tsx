import { ClineAskUseSubagents, ClineMessage } from "@shared/ExtensionMessage"
import { NetworkIcon } from "lucide-react"
import { useMemo } from "react"

interface SubagentApprovalRowProps {
	message: ClineMessage
}

function parseSubagentApproval(message: ClineMessage): ClineAskUseSubagents | null {
	if (!message.text) {
		return null
	}

	try {
		const parsed = JSON.parse(message.text) as ClineAskUseSubagents
		if (!Array.isArray(parsed.prompts)) {
			return null
		}
		const prompts = parsed.prompts.map((prompt) => prompt?.trim()).filter((prompt): prompt is string => !!prompt)
		return { prompts }
	} catch {
		return null
	}
}

export default function SubagentApprovalRow({ message }: SubagentApprovalRowProps) {
	const data = useMemo(() => parseSubagentApproval(message), [message])

	if (!data || data.prompts.length === 0) {
		return <div className="text-foreground opacity-80">Subagent approval details are unavailable.</div>
	}

	const singular = data.prompts.length === 1
	const title = singular ? "Cline wants to use a subagent:" : "Cline wants to use subagents:"

	return (
		<div>
			<div className="flex items-center gap-2.5 mb-3">
				<NetworkIcon className="size-2 text-foreground" />
				<span className="font-bold text-foreground">{title}</span>
			</div>
			<div className="bg-code border border-editor-group-border rounded-sm py-2.5 px-3">
				<div className="space-y-2">
					{data.prompts.map((prompt, index) => (
						<div
							className="rounded-xs border border-editor-group-border bg-vscode-editor-background px-2 py-1.5"
							key={index}>
							<div className="text-xs font-semibold text-foreground">Prompt {index + 1}</div>
							<div className="mt-1 text-xs font-editor whitespace-pre-wrap break-words">{prompt}</div>
						</div>
					))}
				</div>
			</div>
		</div>
	)
}
