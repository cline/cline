import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"

interface ClineAuthStatusProps {
	message: string | null
}

export const ClineAuthStatus = ({ message }: ClineAuthStatusProps) => {
	const [didCopy, setDidCopy] = useState(false)
	const { t } = useTranslation()

	if (!message) {
		return null
	}

	const codeMatch = message.match(/(?:code(?:\s+in\s+your\s+browser)?\s*:?\s*)([A-Z0-9-]{4,})/i)
	const authCode = codeMatch?.[1]
	const displayMessage = authCode ? t("account:auth.enterCode") : message

	const handleCopy = async () => {
		if (!authCode) {
			return
		}

		try {
			await navigator.clipboard.writeText(authCode)
		} catch {
			const textArea = document.createElement("textarea")
			textArea.value = authCode
			textArea.style.position = "fixed"
			textArea.style.opacity = "0"
			document.body.appendChild(textArea)
			textArea.focus()
			textArea.select()
			document.execCommand("copy")
			document.body.removeChild(textArea)
		}

		setDidCopy(true)
		window.setTimeout(() => setDidCopy(false), 1_500)
	}

	return (
		<div className="rounded border border-neutral-500/30 bg-vscode-editor-background p-3 text-vscode-foreground text-center">
			<div className="text-sm">{displayMessage}</div>
			{authCode ? (
				<div className="mt-2 flex items-center justify-center gap-2">
					<div className="font-mono text-2xl font-semibold tracking-wider">{authCode}</div>
					<Button aria-label={t("account:auth.copyCodeAria")} onClick={handleCopy} size="sm" variant="secondary">
						{didCopy ? t("account:auth.copied") : t("account:auth.copy")}
					</Button>
				</div>
			) : null}
		</div>
	)
}
