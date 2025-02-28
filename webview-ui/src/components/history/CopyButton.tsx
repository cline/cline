import { useCallback } from "react"

import { useClipboard } from "@/components/ui/hooks"
import { Button } from "@/components/ui"
import { cn } from "@/lib/utils"

type CopyButtonProps = {
	itemTask: string
}

export const CopyButton = ({ itemTask }: CopyButtonProps) => {
	const { isCopied, copy } = useClipboard()

	const onCopy = useCallback(
		(e: React.MouseEvent) => {
			e.stopPropagation()
			!isCopied && copy(itemTask)
		},
		[isCopied, copy, itemTask],
	)

	return (
		<Button
			variant="ghost"
			size="icon"
			title="Copy Prompt"
			onClick={onCopy}
			className="opacity-50 hover:opacity-100">
			<span className={cn("codicon scale-80", { "codicon-check": isCopied, "codicon-copy": !isCopied })} />
		</Button>
	)
}
