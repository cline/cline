import * as React from "react"
import { Button } from "../ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog"
import { Textarea } from "../ui/textarea"
import { useClipboard } from "../ui/hooks"
import { Check, Copy, X } from "lucide-react"
import { useAppTranslation } from "@/i18n/TranslationContext"

interface HumanRelayDialogProps {
	isOpen: boolean
	onClose: () => void
	requestId: string
	promptText: string
	onSubmit: (requestId: string, text: string) => void
	onCancel: (requestId: string) => void
}

/**
 * Human Relay Dialog Component
 * Displays the prompt text that needs to be copied and provides an input box for the user to paste the AI's response.
 */
export const HumanRelayDialog: React.FC<HumanRelayDialogProps> = ({
	isOpen,
	onClose,
	requestId,
	promptText,
	onSubmit,
	onCancel,
}) => {
	const { t } = useAppTranslation()
	const [response, setResponse] = React.useState("")
	const { copy } = useClipboard()
	const [isCopyClicked, setIsCopyClicked] = React.useState(false)

	// Clear input when dialog opens
	React.useEffect(() => {
		if (isOpen) {
			setResponse("")
			setIsCopyClicked(false)
		}
	}, [isOpen])

	// Copy to clipboard and show success message
	const handleCopy = () => {
		copy(promptText)
		setIsCopyClicked(true)
		setTimeout(() => {
			setIsCopyClicked(false)
		}, 2000)
	}

	// Submit response
	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault()
		if (response.trim()) {
			onSubmit(requestId, response)
			onClose()
		}
	}

	// Cancel operation
	const handleCancel = () => {
		onCancel(requestId)
		onClose()
	}

	return (
		<Dialog open={isOpen} onOpenChange={(open) => !open && handleCancel()}>
			<DialogContent className="sm:max-w-[600px] overflow-y-auto max-h-[80vh]">
				<DialogHeader>
					<DialogTitle>{t("humanRelay:dialogTitle")}</DialogTitle>
					<DialogDescription>{t("humanRelay:dialogDescription")}</DialogDescription>
				</DialogHeader>

				<div className="grid gap-6 py-6">
					<div className="relative">
						<Textarea
							className="min-h-[200px] font-mono text-sm p-4 pr-12 whitespace-pre-wrap"
							value={promptText}
							readOnly
						/>
						<Button variant="ghost" size="icon" className="absolute top-2 right-2" onClick={handleCopy}>
							{isCopyClicked ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
						</Button>
					</div>

					{isCopyClicked && (
						<div className="text-sm text-emerald-500 font-medium">{t("humanRelay:copiedToClipboard")}</div>
					)}

					<div>
						<div className="mb-2 font-medium">{t("humanRelay:aiResponse.label")}</div>
						<Textarea
							placeholder={t("humanRelay:aiResponse.placeholder")}
							value={response}
							onChange={(e) => setResponse(e.target.value)}
							className="min-h-[150px]"
						/>
					</div>
				</div>

				<DialogFooter>
					<Button variant="outline" onClick={handleCancel} className="gap-1">
						<X className="h-4 w-4" />
						{t("humanRelay:actions.cancel")}
					</Button>
					<Button onClick={handleSubmit} disabled={!response.trim()} className="gap-1">
						<Check className="h-4 w-4" />
						{t("humanRelay:actions.submit")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
