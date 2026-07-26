import type { ClineMessage } from "@shared/ExtensionMessage"
import { ToolResultRequest } from "@shared/proto/cline/ui"
import { ChevronDownIcon, ChevronRightIcon, ClipboardIcon } from "lucide-react"
import { memo, useState } from "react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { UiServiceClient } from "@/services/grpc-client"
import CodeBlock from "../common/CodeBlock"

export const ToolResultDisclosure = memo(({ message }: { message: ClineMessage }) => {
	const [expanded, setExpanded] = useState(false)
	const [content, setContent] = useState<string>()
	const [truncated, setTruncated] = useState(message.toolResultTruncated ?? false)
	const [loading, setLoading] = useState(false)
	const [error, setError] = useState<string>()

	if (!message.toolResultId) return null

	const toggle = async () => {
		const next = !expanded
		setExpanded(next)
		if (!next || content !== undefined || loading) return
		setLoading(true)
		setError(undefined)
		try {
			const result = await UiServiceClient.getToolResult(ToolResultRequest.create({ id: message.toolResultId }))
			setContent(result.content)
			setTruncated(result.truncated)
		} catch (loadError) {
			setError(loadError instanceof Error ? loadError.message : String(loadError))
		} finally {
			setLoading(false)
		}
	}

	const copy = async () => {
		const value = content ?? message.toolResultPreview ?? ""
		await navigator.clipboard.writeText(value)
	}

	return (
		<div
			className={cn(
				"mt-2 rounded-sm border border-editor-group-border bg-code",
				message.toolResultIsError && "border-error",
			)}>
			<div className="flex items-center justify-between gap-2 px-2 py-1.5">
				<Button className="h-auto px-0 text-xs" onClick={() => void toggle()} size="sm" variant="text">
					{expanded ? <ChevronDownIcon className="size-3" /> : <ChevronRightIcon className="size-3" />}
					{loading ? "Loading result…" : expanded ? "Hide full result" : "View full result"}
				</Button>
				<Button
					aria-label="Copy tool result"
					className="h-auto p-1"
					onClick={() => void copy()}
					size="icon"
					variant="text">
					<ClipboardIcon className="size-3" />
				</Button>
			</div>
			{message.toolResultIsError && !expanded && message.toolResultPreview && (
				<pre className="m-0 border-t border-editor-group-border px-2 py-1.5 text-xs text-error whitespace-pre-wrap break-words">
					{message.toolResultPreview}
				</pre>
			)}
			{expanded && (
				<div className="border-t border-editor-group-border">
					{error ? (
						<div className="p-2 text-xs text-error">{error}</div>
					) : (
						<CodeBlock forceWrap source={`${"```"}text\n${content ?? ""}\n${"```"}`} />
					)}
					{truncated && (
						<div className="px-2 pb-2 text-xs text-editor-warning-foreground">Retained output was truncated.</div>
					)}
				</div>
			)}
		</div>
	)
})

ToolResultDisclosure.displayName = "ToolResultDisclosure"
