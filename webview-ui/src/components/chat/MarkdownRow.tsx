import { memo } from "react"
import MarkdownBlock from "../common/MarkdownBlock"

export const MarkdownRow = memo(({ markdown, showCursor }: { markdown?: string; showCursor?: boolean }) => {
	return (
		<div className="wrap-anywhere overflow-hidden [&_p]:mb-0">
			<MarkdownBlock markdown={markdown} showCursor={showCursor} />
		</div>
	)
})

MarkdownRow.displayName = "MarkdownRow"
