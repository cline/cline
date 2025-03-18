import { useCallback } from "react"

import { useClipboard } from "@/components/ui/hooks"
import { Button } from "@/components/ui"
import { cn } from "@/lib/utils"
import { useAppTranslation } from "@/i18n/TranslationContext"

type CopyButtonProps = {
	itemTask: string
}

export const CopyButton = ({ itemTask }: CopyButtonProps) => {
	const { isCopied, copy } = useClipboard()
	const { t } = useAppTranslation()

	const onCopy = useCallback(
		(e: React.MouseEvent) => {
			e.stopPropagation()
			const tempDiv = document.createElement("div")
			tempDiv.innerHTML = itemTask
			const text = tempDiv.textContent || tempDiv.innerText || ""
			!isCopied && copy(text)
		},
		[isCopied, copy, itemTask],
	)

	return (
		<Button
			variant="ghost"
			size="icon"
			title={t("history:copyPrompt")}
			onClick={onCopy}
			data-testid="copy-prompt-button"
			className="opacity-50 hover:opacity-100">
			<span className={cn("codicon scale-80", { "codicon-check": isCopied, "codicon-copy": !isCopied })} />
		</Button>
	)
}
