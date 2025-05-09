import React, { useRef } from "react"
import html2canvas from "html2canvas"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"

// Define icon components or import them if they are separate SVGs/components
// For simplicity, using Codicon class names directly in spans for now.
// In a real scenario, these might be actual SVG components.
// const HubotIcon = () => <span className="codicon codicon-hubot text-2xl mr-3"></span>;
// const FlameIcon = () => <span className="codicon codicon-flame text-2xl mr-3"></span>;
// const CloseIcon = () => <span className="codicon codicon-close"></span>;

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
				backgroundColor: "#1E1E1E", // A common dark theme background
				useCORS: true, // Important if user profile images are from external sources
				scale: 2, // Increase scale for better resolution
			})
				.then((canvas) => {
					const image = canvas.toDataURL("image/png")
					const link = document.createElement("a")
					link.href = image
					link.download = "cline-power-user-card.png"
					document.body.appendChild(link)
					link.click()
					document.body.removeChild(link)
				})
				.catch((err) => {
					console.error("Error generating card image:", err)
					// Optionally, inform the user via a toast or message
				})
		}
	}

	const handleShareToTwitter = () => {
		const shareText = `Check out my #ClineAI Power User stats! @cline_ai Proud to be part of the community. #AI #DevTools\n\nDownload your card in the Cline VSCode extension!`
		const twitterUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}`
		window.open(twitterUrl, "_blank")
	}

	if (isLoadingStats) {
		return (
			<div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center p-4 z-[100]">
				<div className="bg-[var(--vscode-sideBar-background)] p-6 rounded-lg shadow-xl text-center">
					Loading Power User Stats...
				</div>
			</div>
		)
	}

	if (!stats) {
		return (
			<div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center p-4 z-[100]">
				<div className="bg-[var(--vscode-sideBar-background)] p-6 rounded-lg shadow-xl text-center">
					Could not load stats. Please try again.
					{onClose && (
						<VSCodeButton appearance="secondary" onClick={onClose} className="mt-4">
							Close
						</VSCodeButton>
					)}
				</div>
			</div>
		)
	}

	return (
		<div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center p-4 z-[100]">
			{" "}
			{/* Increased z-index */}
			<div className="bg-[var(--vscode-sideBar-background)] p-6 rounded-lg shadow-xl max-w-xs w-full">
				{" "}
				{/* max-w-xs for a more compact card */}
				{onClose && (
					<div className="text-right mb-2 -mr-2 -mt-2">
						{" "}
						{/* Adjust positioning for close button */}
						<VSCodeButton appearance="icon" onClick={onClose} title="Close">
							<span className="codicon codicon-close"></span>
						</VSCodeButton>
					</div>
				)}
				<div
					ref={cardRef}
					className="bg-[var(--vscode-editorWidget-background)] p-6 rounded-md text-[var(--vscode-editorWidget-foreground)]">
					<div className="flex justify-between items-start mb-4">
						{" "}
						{/* Reduced margin */}
						<h2 className="text-xl font-bold">AI Power User</h2> {/* Slightly smaller title */}
						<span className="text-xs text-[var(--vscode-descriptionForeground)] pt-1">
							{" "}
							{/* Adjusted alignment and size */}
							{stats.userHandle || "cline_user"}
						</span>
					</div>

					<div className="space-y-4">
						{" "}
						{/* Reduced spacing */}
						<div>
							<p className="text-[10px] text-[var(--vscode-descriptionForeground)] uppercase tracking-wider mb-0.5">
								{" "}
								{/* Smaller text */}
								Most used model
							</p>
							<div className="flex items-center">
								<span className="codicon codicon-hubot text-xl mr-2"></span> {/* Smaller icon */}
								<p className="text-lg font-semibold">{stats.mostUsedModel || "N/A"}</p>{" "}
								{/* Slightly smaller text */}
							</div>
						</div>
						<div>
							<p className="text-[10px] text-[var(--vscode-descriptionForeground)] uppercase tracking-wider mb-0.5">
								Total Tokens Processed
							</p>
							<div className="flex items-center">
								<span className="codicon codicon-flame text-xl mr-2"></span> {/* Smaller icon */}
								<p className="text-lg font-semibold">{formatTokens(stats.totalTokensProcessed)}</p>
							</div>
						</div>
					</div>
				</div>
				<div className="mt-5 flex flex-col space-y-2.5">
					{" "}
					{/* Reduced margin and spacing */}
					<VSCodeButton appearance="primary" onClick={handleDownloadImage} className="w-full">
						Download Card
					</VSCodeButton>
					<VSCodeButton appearance="secondary" onClick={handleShareToTwitter} className="w-full">
						Share on X
					</VSCodeButton>
				</div>
			</div>
		</div>
	)
}

export default PowerUserCard
