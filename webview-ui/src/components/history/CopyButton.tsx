import { useCallback } from "react"

import { useClipboard } from "@/components/ui/hooks"
import { Button } from "@/components/ui"
import { cn } from "@/lib/utils"
import { useAppTranslation } from "@/i18n/TranslationContext"

type CopyButtonProps = {
	itemTask: string
	className?: string
}

/**
 * Strips only history highlight spans from text while preserving other HTML
 * Targets: <span class="history-item-highlight">content</span>
 * @param text - Text that may contain highlight spans
 * @returns Text with highlight spans removed but content preserved
 */
const stripHistoryHighlightSpans = (text: string): string => {
	// Match opening tag, capture content until closing tag
	// The [\s\S]*? pattern matches any character (including newlines) non-greedily,
	// which properly handles content with < characters
	return text.replace(/<span\s+class="history-item-highlight">([\s\S]*?)<\/span>/g, "$1")
}

export const CopyButton = ({ itemTask, className }: CopyButtonProps) => {
	const { isCopied, copy } = useClipboard()
	const { t } = useAppTranslation()

	const onCopy = useCallback(
		(e: React.MouseEvent) => {
			e.stopPropagation()
			if (!isCopied) {
				// Strip only history highlight spans before copying to clipboard
				const cleanText = stripHistoryHighlightSpans(itemTask)
				copy(cleanText)
			}
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
			className={cn("opacity-50 hover:opacity-100", className)}>
			<span className={cn("codicon scale-80", { "codicon-check": isCopied, "codicon-copy": !isCopied })} />
		</Button>
	)
}
