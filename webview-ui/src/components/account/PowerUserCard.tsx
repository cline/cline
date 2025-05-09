import React, { useRef } from "react"
import html2canvas from "html2canvas"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"

type PowerUserCardProps = {
	stats: {
		userHandle: string | null
		mostUsedModel: string | null
		totalTokensProcessed: number | null
	} | null
	isLoadingStats: boolean
	onClose?: () => void
}

const PowerUserCard: React.FC<PowerUserCardProps> = ({ stats, isLoadingStats, onClose }) => {
	const cardRef = useRef<HTMLDivElement>(null)

	const formatTokens = (tokens: number | null): string => {
		if (tokens === null || isNaN(tokens)) return "N/A"
		if (tokens === 0) return "0"
		if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(2)} Million`
		if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`
		return tokens.toString()
	}

	const handleDownloadImage = () => {
		if (cardRef.current) {
			html2canvas(cardRef.current, {
				backgroundColor: "#1A1D21", // Match card's dark background for screenshot
				useCORS: true,
				scale: 2,
			})
				.then((canvas) => {
					const image = canvas.toDataURL("image/png")
					const link = document.createElement("a")
					link.href = image
					link.download = "cline-ai-power-user-card.png"
					document.body.appendChild(link)
					link.click()
					document.body.removeChild(link)
				})
				.catch((err) => {
					console.error("Error generating card image:", err)
				})
		}
	}

	const handleShareToTwitter = () => {
		const shareText = `Check out my #ClineAI Power User stats! @cline_ai Proud to be part of the community. #AI #DevTools\n\nGenerate your own card in the Cline VSCode extension!`
		const twitterUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}`
		window.open(twitterUrl, "_blank")
	}

	const cardContent = (
		<div ref={cardRef} className="relative bg-[#1A1D21] p-8 rounded-xl shadow-2xl text-white w-full max-w-md mx-auto">
			{onClose && (
				<VSCodeButton
					appearance="icon"
					onClick={onClose}
					title="Close"
					className="absolute top-4 right-4 text-gray-400 hover:text-white">
					<span className="codicon codicon-close"></span>
				</VSCodeButton>
			)}
			<div className="text-center mb-8">
				<h2 className="text-3xl font-bold">AI Power User</h2>
				{stats?.userHandle && <p className="text-sm text-gray-400 mt-1">{stats.userHandle}</p>}
			</div>

			<div className="space-y-6">
				<div>
					<p className="text-xs text-gray-400 uppercase tracking-wider mb-1">Most used model</p>
					<div className="flex items-center">
						<span className="codicon codicon-hubot text-3xl mr-4 text-purple-400"></span>
						<p className="text-2xl font-semibold">{stats?.mostUsedModel || "N/A"}</p>
					</div>
				</div>

				<div>
					<p className="text-xs text-gray-400 uppercase tracking-wider mb-1">Total Tokens Processed</p>
					<div className="flex items-center">
						<span className="codicon codicon-flame text-3xl mr-4 text-orange-400"></span>
						<p className="text-2xl font-semibold">{formatTokens(stats?.totalTokensProcessed ?? 0)}</p>
					</div>
				</div>
			</div>

			{/* Placeholder for the subtle background wave - would typically be an SVG */}
			{/* <div className="absolute bottom-0 left-0 w-full h-24 overflow-hidden">
                <svg viewBox="0 0 500 150" preserveAspectRatio="none" style={{height: "100%", width: "100%;"}}>
                    <path d="M-0.00,49.98 C149.99,150.00 349.20,-49.98 500.00,49.98 L500.00,150.00 L-0.00,150.00 Z" style={{stroke: "none", fill: "rgba(255,255,255,0.05);" }}></path>
                </svg>
            </div> */}
		</div>
	)

	if (isLoadingStats) {
		return (
			<div className="fixed inset-0 bg-[var(--vscode-editor-background)] bg-opacity-80 flex items-center justify-center p-4 z-[100]">
				<div className="bg-[var(--vscode-notifications-background)] p-8 rounded-lg shadow-xl text-center text-[var(--vscode-notifications-foreground)]">
					Loading Power User Stats...
				</div>
			</div>
		)
	}

	if (!stats && !isLoadingStats) {
		// Show error only if not loading and no stats
		return (
			<div className="fixed inset-0 bg-[var(--vscode-editor-background)] bg-opacity-80 flex items-center justify-center p-4 z-[100]">
				<div className="bg-[var(--vscode-notifications-background)] p-8 rounded-lg shadow-xl text-center text-[var(--vscode-notifications-foreground)]">
					Could not load your stats. Please try again later.
					{onClose && (
						<VSCodeButton appearance="secondary" onClick={onClose} className="mt-6">
							Close
						</VSCodeButton>
					)}
				</div>
			</div>
		)
	}

	const handleOverlayClick = (event: React.MouseEvent<HTMLDivElement>) => {
		// Close only if the overlay itself (not its children) is clicked
		if (event.target === event.currentTarget && onClose) {
			onClose()
		}
	}

	return (
		<div
			className="fixed inset-0 bg-[var(--vscode-editor-background)] bg-opacity-80 flex flex-col items-center justify-center p-4 z-[100]"
			onClick={handleOverlayClick} // Add click handler to the overlay
		>
			{/* Stop propagation for clicks on the card content itself and buttons, so they don't trigger overlay click */}
			<div onClick={(e) => e.stopPropagation()}>{cardContent}</div>
			<div
				className="mt-6 flex flex-col sm:flex-row space-y-3 sm:space-y-0 sm:space-x-4 w-full max-w-md"
				onClick={(e) => e.stopPropagation()} // Stop propagation for button container as well
			>
				<VSCodeButton appearance="primary" onClick={handleDownloadImage} className="w-full">
					Download Card
				</VSCodeButton>
				<VSCodeButton appearance="secondary" onClick={handleShareToTwitter} className="w-full">
					Share on X
				</VSCodeButton>
			</div>
		</div>
	)
}

export default PowerUserCard
