import type React from "react"
import { useMemo } from "react"
import Thumbnails from "@/components/common/Thumbnails"
import { highlightText } from "./task-header/Highlights"

interface UserMessageProps {
	text?: string
	files?: string[]
	images?: string[]
	messageTs?: number
	sendMessageFromChatRow?: (text: string, images: string[], files: string[]) => void
}

const UserMessage: React.FC<UserMessageProps> = ({ text, images, files }) => {
	const highlightedText = useMemo(() => highlightText(text), [text])

	return (
		<div
			className="p-2.5 pr-1 my-1 text-badge-foreground rounded-xs"
			style={{
				backgroundColor: "var(--vscode-badge-background)",
				whiteSpace: "pre-line",
				wordWrap: "break-word",
			}}>
			<span className="ph-no-capture text-sm" style={{ display: "block" }}>
				{highlightedText}
			</span>
			{((images && images.length > 0) || (files && files.length > 0)) && (
				<Thumbnails files={files ?? []} images={images ?? []} style={{ marginTop: "8px" }} />
			)}
		</div>
	)
}

export default UserMessage
