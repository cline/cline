import { useCallback, useEffect, useState } from "react"
import { StringRequest } from "../../../../src/shared/proto/cline/common"
import { StateServiceClient } from "../../services/grpc-client"
import BannerCarousel, { type BannerData } from "./BannerCarousel"

interface RemoteBanner {
	id: string
	titleMd: string
	bodyMd: string
	severity: "info" | "success" | "warning"
	placement: "top" | "bottom"
}

/**
 * Simple component to fetch and display remote banners
 * This is minimal test code - will be deleted after testing
 */
export const RemoteBannerManager: React.FC = () => {
	const [banners, setBanners] = useState<RemoteBanner[]>([])
	const [loading, setLoading] = useState(true)

	// Fetch banners on mount
	useEffect(() => {
		const fetchBanners = async () => {
			try {
				const response = await StateServiceClient.getActiveBanners(StringRequest.create({ value: "false" }))
				if (response.value) {
					const parsed = JSON.parse(response.value) as RemoteBanner[]
					setBanners(parsed)
				}
			} catch (error) {
				console.error("Failed to fetch remote banners:", error)
			} finally {
				setLoading(false)
			}
		}

		fetchBanners()
	}, [])

	// Handle banner dismissal
	const handleDismiss = useCallback(async (bannerId: string) => {
		try {
			await StateServiceClient.dismissBanner(StringRequest.create({ value: bannerId }))
			// Remove dismissed banner from state
			setBanners((prev) => prev.filter((b) => b.id !== bannerId))
		} catch (error) {
			console.error("Failed to dismiss banner:", error)
		}
	}, [])

	// Convert remote banners to BannerData format
	const bannerData: BannerData[] = banners.map((banner) => ({
		id: banner.id,
		title: banner.titleMd,
		description: banner.bodyMd,
		icon: banner.severity === "warning" ? <span>⚠️</span> : banner.severity === "success" ? <span>✅</span> : <span>📢</span>,
		onDismiss: () => handleDismiss(banner.id),
	}))

	if (loading || bannerData.length === 0) {
		return null
	}

	return <BannerCarousel banners={bannerData} />
}
