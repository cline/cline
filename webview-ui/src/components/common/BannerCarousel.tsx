import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { ChevronLeft, ChevronRight, XIcon } from "lucide-react"
import React, { useState } from "react"
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
	onClose: () => void
}

interface BannerCarouselProps {
	banners: BannerData[]
}

export const BannerCarousel: React.FC<BannerCarouselProps> = ({ banners }) => {
	const [currentIndex, setCurrentIndex] = useState(0)
	const [isPaused, setIsPaused] = useState(false)
	const [isTransitioning, setIsTransitioning] = useState(false)
	const autoPlayIntervalRef = React.useRef<NodeJS.Timeout | null>(null)

	if (banners.length === 0) {
		return null
	}

	const transitionToIndex = (newIndex: number) => {
		setIsTransitioning(true)
		setTimeout(() => {
			setCurrentIndex(newIndex)
			setIsTransitioning(false)
		}, 200) // Match half of transition duration
	}

	const handlePrevious = () => {
		const newIndex = currentIndex === 0 ? banners.length - 1 : currentIndex - 1
		transitionToIndex(newIndex)
		setIsPaused(true) // Pause auto-rotation when user manually navigates
	}

	const handleNext = () => {
		const newIndex = currentIndex === banners.length - 1 ? 0 : currentIndex + 1
		transitionToIndex(newIndex)
		setIsPaused(true) // Pause auto-rotation when user manually navigates
	}

	// Auto-rotation effect
	React.useEffect(() => {
		// Only auto-rotate if there's more than one banner and not paused
		if (banners.length <= 1 || isPaused) {
			return
		}

		autoPlayIntervalRef.current = setInterval(() => {
			const newIndex = (currentIndex + 1) % banners.length
			transitionToIndex(newIndex)
		}, 5000) // Rotate every 5 seconds

		return () => {
			if (autoPlayIntervalRef.current) {
				clearInterval(autoPlayIntervalRef.current)
			}
		}
	}, [banners.length, isPaused, currentIndex])

	const currentBanner = banners[currentIndex]

	return (
		<div
			className="mx-4 mb-4"
			onMouseEnter={() => setIsPaused(true)}
			onMouseLeave={() => setIsPaused(false)}
			style={{ marginTop: "36px" }}>
			{/* Card container with unified styling */}
			<div
				className="relative"
				style={{
					backgroundColor: "color-mix(in srgb, var(--vscode-toolbar-hoverBackground) 65%, transparent)",
					borderRadius: "4px",
				}}>
				{/* Close button */}
				<Button className="absolute top-4 right-4 z-10" onClick={currentBanner.onClose} size="icon" variant="icon">
					<XIcon style={{ width: "18px", height: "16px" }} />
				</Button>

				{/* Card content with fixed height and fade transition */}
				<div
					className="px-4 pt-4 pb-3 pr-8"
					style={{
						height: "144px",
						overflow: "hidden",
						opacity: isTransitioning ? 0 : 1,
						transition: "opacity 0.4s ease-in-out",
					}}>
					{/* Title with optional icon */}
					<h3 className="font-semibold mb-3 flex items-center gap-2" style={{ fontSize: "16px" }}>
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
								<VSCodeButton
									appearance={action.variant === "secondary" ? "secondary" : "primary"}
									disabled={action.disabled}
									key={idx}
									onClick={action.onClick}>
									{action.label}
								</VSCodeButton>
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
							{currentIndex + 1}/{banners.length}
						</div>

						{/* Navigation arrows */}
						<div className="flex" style={{ marginRight: "-12px" }}>
							<Button
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
