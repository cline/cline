import type { Banner } from "@shared/ClineBanner"
import { XIcon } from "lucide-react"
import { useCallback, useEffect } from "react"
import { useRemark } from "react-remark"
import { Button } from "@/components/ui/button"
import { StateServiceClient } from "@/services/grpc-client"
import { getAsVar, VSC_INACTIVE_SELECTION_BACKGROUND } from "@/utils/vscStyles"

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

	return (
		<div className="flex items-center justify-center w-full">
			<Alert title={titleContent}>
				<AlertDescription>{bodyContent}</AlertDescription>
			</Alert>
		</div>
	)
}

export default ApiBanner
