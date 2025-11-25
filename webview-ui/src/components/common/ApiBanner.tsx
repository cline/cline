import { X } from "lucide-react"
import React, { useCallback } from "react"
import { BannerServiceClient } from "@/services/grpc-client"
import type { Banner } from "../../../../src/shared/ExtensionMessage"
import { DismissBannerRequest } from "../../../../src/shared/proto/cline/banners"

interface ApiBannerProps {
	banner: Banner
}

export const ApiBanner: React.FC<ApiBannerProps> = ({ banner }) => {
	const handleDismiss = useCallback(
		async (e: React.MouseEvent) => {
			e.stopPropagation()
			try {
				await BannerServiceClient.DismissBanner(
					DismissBannerRequest.create({
						bannerId: banner.id,
					}),
				)
			} catch (error) {
				console.error("Failed to dismiss banner:", error)
			}
		},
		[banner.id],
	)

	const handleCtaClick = useCallback(() => {
		if (banner.ctaUrl) {
			window.open(banner.ctaUrl, "_blank")
		}
	}, [banner.ctaUrl])

	// Different colors based on severity
	const severityStyles = {
		info: "bg-blue-500/10 border-blue-500/30",
		warning: "bg-yellow-500/10 border-yellow-500/30",
		error: "bg-red-500/10 border-red-500/30",
	}

	const severityClass = severityStyles[banner.severity] || severityStyles.info

	return (
		<div className={`rounded-lg border ${severityClass} p-4 mb-3 relative`} data-testid="api-banner">
			<button
				aria-label="Dismiss banner"
				className="absolute top-2 right-2 p-1 hover:bg-black/10 rounded"
				data-testid="dismiss-banner"
				onClick={handleDismiss}>
				<X size={16} />
			</button>

			<div className="pr-8">
				{banner.titleMd && <div className="font-semibold mb-1">{banner.titleMd}</div>}

				{banner.bodyMd && <div className="text-sm opacity-90">{banner.bodyMd}</div>}

				{banner.ctaText && banner.ctaUrl && (
					<button
						className="mt-2 text-sm underline hover:no-underline"
						data-testid="banner-cta"
						onClick={handleCtaClick}>
						{banner.ctaText}
					</button>
				)}
			</div>
		</div>
	)
}

export default ApiBanner
