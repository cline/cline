import { useTranslation } from "react-i18next"
import { Dialog, DialogContent, DialogHeader, Button } from "@/components/ui"
import RooHero from "../welcome/RooHero"
import { CircleDollarSign, FileStack, Router, Share } from "lucide-react"
import { DialogTitle } from "@radix-ui/react-dialog"

interface CloudUpsellDialogProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	onConnect: () => void
}

// Reusable method to render cloud benefits content
export const renderCloudBenefitsContent = (t: any) => {
	return (
		<div className="text-left cursor-default">
			<div className="w-15">
				<RooHero />
			</div>
			<h1 className="text-xl font-bold text-vscode-foreground">{t("cloud:cloudBenefitsTitle")}</h1>
			<div className="text-lg">
				<ul className="text-vscode-descriptionForeground space-y-4 my-8">
					<li className="flex items-start gap-2">
						<Router className="size-4 mt-0.5 shrink-0" />
						{t("cloud:cloudBenefitWalkaway")}
					</li>
					<li className="flex items-start gap-2">
						<Share className="size-4 mt-0.5 shrink-0" />
						{t("cloud:cloudBenefitSharing")}
					</li>
					<li className="flex items-start gap-2">
						<CircleDollarSign className="size-4 mt-0.5 shrink-0" />
						{t("cloud:cloudBenefitMetrics")}
					</li>
					<li className="flex items-start gap-2">
						<FileStack className="size-4 mt-0.5 shrink-0" />
						{t("cloud:cloudBenefitHistory")}
					</li>
				</ul>
			</div>
		</div>
	)
}

export const CloudUpsellDialog = ({ open, onOpenChange, onConnect }: CloudUpsellDialogProps) => {
	const { t } = useTranslation()

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-sm">
				<DialogHeader>
					<DialogTitle>{/* Intentionally empty */}</DialogTitle>
				</DialogHeader>

				<div className="text-left space-y-6">
					{renderCloudBenefitsContent(t)}

					<div className="flex flex-col gap-4">
						<Button onClick={onConnect} className="w-full">
							{t("cloud:connect")}
						</Button>
					</div>
				</div>
			</DialogContent>
		</Dialog>
	)
}
