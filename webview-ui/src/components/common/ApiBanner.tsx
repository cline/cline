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
		<div
			className="px-4 py-3 flex flex-col shrink-0 mb-1 relative text-sm mt-1.5 m-4 transition-colors border-0 text-left w-auto rounded-sm"
			style={{
				backgroundColor: getAsVar(VSC_INACTIVE_SELECTION_BACKGROUND),
			}}>
			{/* Title */}
			<div className="font-semibold mb-2 [&_p]:m-0 [&_h4]:m-0">{titleContent}</div>

			{/* Body */}
			<div className="[&_p]:m-0">{bodyContent}</div>

			{/* Close button */}
			<Button
				className="absolute top-2.5 right-2"
				data-testid={`api-banner-close-${banner.id}`}
				onClick={handleDismiss}
				size="icon"
				variant="icon">
				<XIcon />
			</Button>
		</div>
	)
}

export default ApiBanner
