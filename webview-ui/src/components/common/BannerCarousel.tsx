import { ChevronLeft, ChevronRight, XIcon } from "lucide-react"
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRemark } from "react-remark"
import { Button } from "@/components/ui/button"

interface BannerActions {
	label: string
	onClick: () => void
	disabled?: boolean
}

export interface BannerData {
	id: string
	icon?: React.ReactNode
	title: string
	description: string | React.ReactNode
	actions?: BannerActions[]
	onDismiss?: () => void
}

interface BannerCarouselProps {
	banners: BannerData[]
}

interface BannerCardContentProps {
	banner: BannerData
	isActive: boolean
	isTransitioning: boolean
	showDismissButton: boolean
}

const BannerCardContent: React.FC<BannerCardContentProps> = ({ banner, isActive, isTransitioning, showDismissButton }) => {
	const [markdownContent, setMarkdown] = useRemark()

	useEffect(() => {
		setMarkdown(typeof banner.description === "string" ? banner.description : "")
	}, [banner.description, setMarkdown])

	return (
		<div
			className="p-3"
			style={{
				gridArea: "stack",
				opacity: isActive && !isTransitioning ? 1 : 0,
				transition: "opacity 0.4s ease-in-out",
				pointerEvents: isActive ? "auto" : "none",
			}}>
			{/* Title with optional icon */}
			<h3
				className="font-semibold mb-2 flex items-center gap-2 text-base"
				style={{ paddingRight: showDismissButton ? "24px" : "0" }}>
				<span className="shrink-0">{banner.icon}</span>
				{banner.title}
			</h3>

			{/* Description */}
			<div className="text-sm text-description leading-relaxed [&>*:last-child]:mb-0 [&_a]:hover:underline">
				{markdownContent}
			</div>

			{/* Action buttons */}
			{banner.actions?.length ? (
				<div className="flex flex-wrap gap-2 mt-3">
					{banner.actions.map((action) => (
						<Button disabled={action.disabled} key={action.label} onClick={action.onClick} size="sm">
							{action.label}
						</Button>
					))}
				</div>
			) : null}
		</div>
	)
}

export const BannerCarousel: React.FC<BannerCarouselProps> = ({ banners }) => {
	const [currentIndex, setCurrentIndex] = useState(0)
	const [isPaused, setIsPaused] = useState(false)
	const [isTransitioning, setIsTransitioning] = useState(false)
	const autoPlayIntervalRef = useRef<NodeJS.Timeout | null>(null)

	// Compute a safe index that's always within bounds
	const safeCurrentIndex = useMemo(
		() => (banners.length === 0 ? 0 : Math.min(currentIndex, banners.length - 1)),
		[currentIndex, banners.length],
	)

	const transitionToIndex = useCallback((newIndex: number) => {
		setIsTransitioning(true)
		setTimeout(() => {
			setCurrentIndex(newIndex)
			setIsTransitioning(false)
		}, 200) // Match half of transition duration
	}, [])

	const handlePrevious = useCallback(() => {
		const newIndex = currentIndex === 0 ? banners.length - 1 : currentIndex - 1
		transitionToIndex(newIndex)
		setIsPaused(true) // Pause auto-rotation when user manually navigates
	}, [currentIndex, banners.length, transitionToIndex])

	const handleNext = useCallback(() => {
		const newIndex = currentIndex === banners.length - 1 ? 0 : currentIndex + 1
		transitionToIndex(newIndex)
		setIsPaused(true) // Pause auto-rotation when user manually navigates
	}, [currentIndex, banners.length, transitionToIndex])

	// Reset currentIndex when banners change to prevent out-of-bounds access
	useEffect(() => {
		if (currentIndex >= banners.length && banners.length > 0) {
			setCurrentIndex(banners.length - 1)
		}
	}, [banners.length, currentIndex])

	// Auto-rotation effect
	useEffect(() => {
		// Only auto-rotate if there's more than one banner and not paused
		if (banners.length <= 1 || isPaused) {
			return
		}

		autoPlayIntervalRef.current = setInterval(() => {
			setCurrentIndex((prevIndex) => (prevIndex + 1) % banners.length)
		}, 5000) // Rotate every 5 seconds

		return () => {
			if (autoPlayIntervalRef.current) {
				clearInterval(autoPlayIntervalRef.current)
			}
		}
	}, [banners.length, isPaused])

	// Early return AFTER all hooks have been called
	if (banners.length === 0) {
		return null
	}

	// Use the safe index to get the current banner
	const currentBanner = banners[safeCurrentIndex]

	// Safety check: if currentBanner is undefined (shouldn't happen with above logic, but just in case)
	if (!currentBanner) {
		return null
	}

	const showDismissButton = safeCurrentIndex === banners.length - 1 && currentBanner.onDismiss

	return (
		<div
			aria-label="Announcements"
			aria-live="polite"
			aria-roledescription="carousel"
			className="mx-3 mb-3"
			onMouseEnter={() => setIsPaused(true)}
			onMouseLeave={() => setIsPaused(false)}
			role="region">
			{/* Card container */}
			<div className="relative bg-muted rounded-sm">
				{/* Dismiss button - only show on last card, dismisses ALL banners */}
				{showDismissButton && (
					<Button
						aria-label="Dismiss all banners"
						className="absolute top-2.5 right-2 z-10"
						data-testid="banner-dismiss-button"
						onClick={(e) => {
							e.stopPropagation()
							// Dismiss ALL banners, not just the current one
							banners.forEach((banner) => banner.onDismiss?.())
						}}
						size="icon"
						variant="icon">
						<XIcon className="w-4 h-4" />
					</Button>
				)}

				{/* Card content - grid stack makes container size to tallest */}
				<div className="grid" style={{ gridTemplateAreas: "'stack'" }}>
					{banners.map((banner, idx) => {
						const isActive = idx === safeCurrentIndex
						const isLastBanner = idx === banners.length - 1
						const showDismiss = isLastBanner && banner.onDismiss

						return (
							<BannerCardContent
								banner={banner}
								isActive={isActive}
								isTransitioning={isTransitioning}
								key={banner.id}
								showDismissButton={!!showDismiss}
							/>
						)
					})}
				</div>

				{/* Navigation footer - only show if more than 1 banner */}
				{banners.length > 1 && (
					<div className="flex justify-between items-center px-3 py-1.5 border-t border-description/15">
						{/* Page indicator */}
						<div className="text-sm text-description">
							{safeCurrentIndex + 1} / {banners.length}
						</div>

						{/* Navigation arrows */}
						<div className="flex gap-0.5">
							<Button aria-label="Previous banner" onClick={handlePrevious} size="icon" variant="icon">
								<ChevronLeft className="size-4" />
							</Button>
							<Button aria-label="Next banner" onClick={handleNext} size="icon" variant="icon">
								<ChevronRight className="size-4" />
							</Button>
						</div>
					</div>
				)}
			</div>
		</div>
	)
}

export default BannerCarousel
