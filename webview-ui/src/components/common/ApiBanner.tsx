import type { Banner } from "@shared/ClineBanner"
import { XIcon } from "lucide-react"
import { useCallback, useEffect } from "react"
import { useRemark } from "react-remark"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { StateServiceClient } from "@/services/grpc-client"

interface ApiBannerProps {
	banner: Banner
}

export const ApiBanner: React.FC<ApiBannerProps> = ({ banner }) => {
	const [titleContent, setTitleMarkdown] = useRemark()
	const [bodyContent, setBodyMarkdown] = useRemark()

	useEffect(() => {
		setTitleMarkdown(banner.titleMd || "")
	}, [banner.titleMd, setTitleMarkdown])

	useEffect(() => {
		setBodyMarkdown(banner.bodyMd || "")
	}, [banner.bodyMd, setBodyMarkdown])

	const handleDismiss = useCallback(
		(e: React.MouseEvent) => {
			e.preventDefault()
			e.stopPropagation()
			StateServiceClient.dismissBanner({ value: banner.id }).catch(console.error)
		},
		[banner.id],
	)

	const getAlertVariant = () => {
		switch (banner.severity) {
			case "warning":
				return "warning"
			case "success":
			case "info":
			default:
				return "default"
		}
	}

	return (
		<div className="flex items-center justify-center w-full px-4 mb-3">
			<Alert className="relative w-full" variant={getAlertVariant()}>
				<AlertTitle className="[&_p]:m-0 [&_h4]:m-0 pr-8">{titleContent}</AlertTitle>
				<AlertDescription className="[&_p]:m-0">{bodyContent}</AlertDescription>
				{/* Close button */}
				<Button
					className="absolute top-2.5 right-2"
					data-testid={`api-banner-close-${banner.id}`}
					onClick={handleDismiss}
					size="icon"
					variant="ghost">
					<XIcon className="h-4 w-4" />
				</Button>
			</Alert>
		</div>
	)
}

export default ApiBanner
