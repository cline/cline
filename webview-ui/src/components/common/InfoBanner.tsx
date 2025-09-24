import { Int64Request } from "@shared/proto/cline/common"
import { useCallback } from "react"
import { StateServiceClient } from "@/services/grpc-client"

export const CURRENT_INFO_BANNER_VERSION = 1

export const InfoBanner: React.FC = () => {
	const handleClose = useCallback(() => {
		const request = Int64Request.create({
			value: CURRENT_INFO_BANNER_VERSION,
		})
		StateServiceClient.updateInfoBannerVersion(request).catch(console.error)
	}, [])

	return (
		<div className="bg-banner-background text-banner-foreground px-3 py-2 flex flex-col gap-1 shrink-0 mb-1 relative text-sm m-4">
			<h3 className="m-0">💡 Try Cline in the Right Sidebar</h3>
			<p className="m-0">
				Keep your code visible while chatting with Cline. Drag the Cline icon to your right sidebar panel for better
				multitasking.
			</p>
			<p className="m-0">
				<a
					className="text-link cursor-pointer underline"
					href="https://docs.cline.bot/features/customization/opening-cline-in-sidebar"
					rel="noopener noreferrer"
					target="_blank">
					See how →
				</a>
			</p>

			{/* Close button */}
			<button
				aria-label="Close info banner"
				className="absolute top-3 right-3 opacity-70 hover:opacity-100 cursor-pointer border-0 bg-transparent p-0 text-inherit"
				onClick={handleClose}
				type="button">
				✕
			</button>
		</div>
	)
}

export default InfoBanner
