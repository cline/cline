import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { useCallback } from "react"
import { PlatformType } from "@/config/platform.config"
import { usePlatform } from "@/context/PlatformContext"
import { StateServiceClient } from "@/services/grpc-client"
export const CURRENT_INFO_BANNER_VERSION = 1
export const InfoBanner: React.FC = () => {
	const handleClose = useCallback((e: React.MouseEvent) => {
		e.preventDefault()
		e.stopPropagation()
		StateServiceClient.updateInfoBannerVersion({ value: CURRENT_INFO_BANNER_VERSION }).catch(console.error)
	}, [])
	if (usePlatform().type === PlatformType.VSCODE) {
		return (
			<a
				className="bg-banner-background px-3 py-2 flex flex-col gap-1 shrink-0 mb-1 relative text-sm m-4 no-underline transition-colors hover:brightness-120"
				href="https://docs.cline.bot/features/customization/opening-cline-in-sidebar"
				rel="noopener noreferrer"
				style={{ color: "var(--vscode-foreground)", outline: "none" }}
				target="_blank">
				<h4 className="m-0" style={{ paddingRight: "18px" }}>
					💡 Cline in the Right Sidebar
				</h4>
				<p className="m-0">
					Keep your files visible when chatting with Cline. Drag the Cline icon to the right sidebar panel for a better
					experience. <span className="text-link cursor-pointer">See how →</span>
				</p>

				{/* Close button */}
				<VSCodeButton
					appearance="icon"
					data-testid="info-banner-close-button"
					onClick={handleClose}
					style={{ position: "absolute", top: "6px", right: "6px" }}>
					<span className="codicon codicon-close"></span>
				</VSCodeButton>
			</a>
		)
	}
	return null
}

export default InfoBanner
