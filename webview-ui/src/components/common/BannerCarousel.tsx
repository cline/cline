import { ChevronLeft, ChevronRight, XIcon } from "lucide-react"
import React, { useCallback, useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"

interface BannerAction {
	label: string
	onClick: () => void
	variant?: "primary" | "secondary"
	disabled?: boolean
}

export interface BannerData {
	id: string
	icon?: React.ReactNode
	title: string
	description: string | React.ReactNode
	actions?: BannerAction[]
	onDismiss?: () => void
}

interface BannerCarouselProps {
	banners: BannerData[]
}

export const BannerCarousel: React.FC<BannerCarouselProps> = ({ banners }) => {
	const [currentIndex, setCurrentIndex] = useState(0)
	const [isPaused, setIsPaused] = useState(false)
	const [isTransitioning, setIsTransitioning] = useState(false)
	const autoPlayIntervalRef = useRef<NodeJS.Timeout | null>(null)

	// Compute a safe index that's always within bounds
	const safeCurrentIndex = banners.length === 0 ? 0 : Math.min(currentIndex, banners.length - 1)

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

	return (
		<div
			aria-label="Announcements"
			aria-live="polite"
			aria-roledescription="carousel"
			className="mx-4 mb-4 mt-9"
			onMouseEnter={() => setIsPaused(true)}
			onMouseLeave={() => setIsPaused(false)}
			role="region">
			{/* Card container with unified styling */}
			<div
				className="relative"
				style={{
					backgroundColor: "color-mix(in srgb, var(--vscode-toolbar-hoverBackground) 65%, transparent)",
					borderRadius: "4px",
				}}>
				{/* Dismiss button - only show on last card, dismisses ALL banners */}
				{safeCurrentIndex === banners.length - 1 && currentBanner.onDismiss && (
					<Button
						aria-label="Dismiss all banners"
						className="absolute top-2 right-2 z-10"
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

				{/* Card content with fixed height and fade transition */}
				<div
					className="px-4 pt-4 pb-3"
					style={{
						height: "144px",
						overflow: "hidden",
						opacity: isTransitioning ? 0 : 1,
						transition: "opacity 0.4s ease-in-out",
					}}>
					{/* Title with optional icon */}
					<h3
						className="font-semibold mb-3 flex items-center gap-2"
						style={{
							fontSize: "16px",
							paddingRight: safeCurrentIndex === banners.length - 1 && currentBanner.onDismiss ? "24px" : "0",
						}}>
						{currentBanner.icon}
						{currentBanner.title}
					</h3>

					{/* Description */}
					<div className="text-base mb-4" style={{ color: "var(--vscode-descriptionForeground)" }}>
						{currentBanner.description}
					</div>

					{/* Action buttons */}
					{currentBanner.actions && currentBanner.actions.length > 0 && (
						<div className="flex gap-3 mt-4">
							{currentBanner.actions.map((action, idx) => (
								<Button
									disabled={action.disabled}
									key={idx}
									onClick={action.onClick}
									variant={action.variant === "secondary" ? "secondary" : "default"}>
									{action.label}
								</Button>
							))}
						</div>
					)}
				</div>

				{/* Navigation footer - only show if more than 1 banner */}
				{banners.length > 1 && (
					<div
						className="flex justify-between items-center px-4 py-1"
						style={{
							borderTop: "1px solid rgba(255, 255, 255, 0.1)",
						}}>
						{/* Page indicator */}
						<div className="text-base font-medium" style={{ color: "var(--vscode-descriptionForeground)" }}>
							{safeCurrentIndex + 1}/{banners.length}
						</div>

						{/* Navigation arrows */}
						<div className="flex -mr-3">
							<Button
								aria-label="Previous banner"
								onClick={handlePrevious}
								size="icon"
								style={{
									width: "40px",
									height: "40px",
									padding: "0",
									backgroundColor: "transparent",
								}}
								variant="icon">
								<ChevronLeft style={{ width: "18px", height: "18px" }} />
							</Button>
							<Button
								aria-label="Next banner"
								onClick={handleNext}
								size="icon"
								style={{
									width: "40px",
									height: "40px",
									padding: "0",
									backgroundColor: "transparent",
								}}
								variant="icon">
								<ChevronRight style={{ width: "18px", height: "18px" }} />
							</Button>
						</div>
					</div>
				)}
			</div>
		</div>
	)
}

export default BannerCarousel
