import type { LearningModuleItem } from "@shared/proto/cline/html_preview"
import { InstallModuleRequest } from "@shared/proto/cline/html_preview"
import { useState } from "react"
import { HtmlPreviewServiceClient } from "@/services/grpc-client"

interface LearningModuleCardProps {
	item: LearningModuleItem
	setError: (error: string | null) => void
}

const LEVEL_COLORS: Record<string, { bg: string; text: string }> = {
	intro: { bg: "rgba(40,167,69,0.18)", text: "#28a745" },
	beginner: { bg: "rgba(40,167,69,0.18)", text: "#28a745" },
	intermediate: { bg: "rgba(255,193,7,0.18)", text: "#e0a800" },
	advanced: { bg: "rgba(220,53,69,0.18)", text: "#dc3545" },
}

function levelStyle(level: string) {
	return LEVEL_COLORS[level.toLowerCase()] ?? { bg: "rgba(0,184,212,0.14)", text: "var(--vscode-textLink-foreground, #06b6d4)" }
}

function formatCount(n: number): string {
	if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "k"
	return String(n)
}

const LearningModuleCard = ({ item, setError }: LearningModuleCardProps) => {
	const [isInstalling, setIsInstalling] = useState(false)
	const [installed, setInstalled] = useState(item.isInstalled)

	const handleInstall = async (e: React.MouseEvent) => {
		e.preventDefault()
		e.stopPropagation()
		if (isInstalling || installed) return
		setIsInstalling(true)
		setError(null)
		try {
			const resp = await HtmlPreviewServiceClient.installModule(
				InstallModuleRequest.create({
					moduleId: item.moduleId,
					downloadUrl: item.downloadUrl,
					title: item.title,
				}),
			)
			if (resp.success) {
				setInstalled(true)
			} else {
				setError(resp.error ?? "Install failed")
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : "Install failed")
		} finally {
			setIsInstalling(false)
		}
	}

	const lvl = levelStyle(item.level)
	const topicInitial = (item.topic || item.title || "?")[0]?.toUpperCase() ?? "?"
	const cyan = "var(--vscode-textLink-foreground, #06b6d4)"

	return (
		<div
			style={{
				padding: "14px 16px",
				display: "flex",
				flexDirection: "column",
				gap: 10,
				borderBottom: "1px solid var(--vscode-panel-border, rgba(255,255,255,0.1))",
				background: "var(--vscode-editor-background)",
				position: "relative",
			}}>
			{/* Featured badge */}
			{item.isFeatured && (
				<span
					style={{
						position: "absolute",
						top: 10,
						right: 12,
						fontSize: 10,
						fontWeight: 700,
						padding: "2px 8px",
						borderRadius: 10,
						background: "linear-gradient(135deg, #00A3FF 0%, #00DDFF 100%)",
						color: "#0a0a15",
						letterSpacing: "0.04em",
						pointerEvents: "none",
					}}>
					Featured ⭐
				</span>
			)}

			{/* Header row */}
			<div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
				{/* Gradient placeholder */}
				<div
					style={{
						width: 44,
						height: 44,
						borderRadius: 6,
						flexShrink: 0,
						background: `linear-gradient(135deg, #0e639c 0%, #06b6d4 100%)`,
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						fontSize: 20,
						fontWeight: 700,
						color: "#fff",
					}}>
					{topicInitial}
				</div>

				{/* Title + author + badges */}
				<div style={{ flex: 1, minWidth: 0 }}>
					<div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
						<span
							style={{
								fontSize: 13,
								fontWeight: 600,
								color: "var(--vscode-foreground)",
								overflow: "hidden",
								textOverflow: "ellipsis",
								whiteSpace: "nowrap",
								maxWidth: item.isFeatured ? 160 : 220,
							}}>
							{item.title}
						</span>
						<span
							style={{
								fontSize: 10,
								fontWeight: 600,
								padding: "2px 7px",
								borderRadius: 10,
								background: lvl.bg,
								color: lvl.text,
								textTransform: "capitalize",
								flexShrink: 0,
							}}>
							{item.level || "intro"}
						</span>
					</div>
					<div style={{ fontSize: 11, color: "var(--vscode-descriptionForeground)", marginTop: 2 }}>
						{item.author && (
							<span>
								by{" "}
								{item.authorUrl ? (
									<a
										href={item.authorUrl}
										onClick={(e) => e.stopPropagation()}
										rel="noopener noreferrer"
										style={{ color: cyan, textDecoration: "none" }}
										target="_blank">
										{item.author}
									</a>
								) : (
									item.author
								)}
							</span>
						)}
						{item.estimatedMinutes > 0 && (
							<span style={{ marginLeft: item.author ? 8 : 0 }}>· {item.estimatedMinutes} min</span>
						)}
					</div>
				</div>

				{/* Install button */}
				<button
					disabled={isInstalling || installed}
					onClick={handleInstall}
					style={{
						flexShrink: 0,
						marginTop: item.isFeatured ? 18 : 0,
						padding: "5px 12px",
						fontSize: 11,
						fontWeight: 600,
						background: installed
							? "rgba(40,167,69,0.12)"
							: isInstalling
								? "rgba(0,0,0,0.12)"
								: "var(--vscode-button-background, #0e639c)",
						color: installed
							? "#28a745"
							: isInstalling
								? "var(--vscode-descriptionForeground)"
								: "var(--vscode-button-foreground, #fff)",
						border: installed ? "1px solid rgba(40,167,69,0.4)" : "none",
						borderRadius: 4,
						cursor: installed || isInstalling ? "default" : "pointer",
					}}
					type="button">
					{installed ? "✓ Installed" : isInstalling ? "Installing…" : "Install"}
				</button>
			</div>

			{/* Stats row: AI-Hydro recognition + community reactions + downloads */}
			<div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
				{item.aiHydroInstalls > 0 && (
					<span
						style={{
							display: "flex",
							alignItems: "center",
							gap: 4,
							fontSize: 11,
							color: "var(--vscode-descriptionForeground)",
						}}
						title="AI-Hydro installs">
						<span className="codicon codicon-cloud-download" style={{ fontSize: 12 }} />
						<span>{formatCount(item.aiHydroInstalls)} AI-Hydro installs</span>
					</span>
				)}
				{item.aiHydroStars > 0 && (
					<span
						style={{
							display: "flex",
							alignItems: "center",
							gap: 4,
							fontSize: 11,
							color: "var(--vscode-descriptionForeground)",
						}}
						title="AI-Hydro user stars">
						<span className="codicon codicon-star-full" style={{ fontSize: 12 }} />
						<span>{formatCount(item.aiHydroStars)} AI-Hydro stars</span>
					</span>
				)}
				{item.githubReactions > 0 && (
					<a
						href={item.discussionUrl || item.githubUrl}
						onClick={(e) => e.stopPropagation()}
						rel="noopener noreferrer"
						style={{
							display: "flex",
							alignItems: "center",
							gap: 4,
							fontSize: 11,
							color: "var(--vscode-descriptionForeground)",
							textDecoration: "none",
						}}
						target="_blank"
						title="Community reactions on GitHub">
						<span className="codicon codicon-thumbsup" style={{ fontSize: 12 }} />
						<span>{formatCount(item.githubReactions)} community</span>
					</a>
				)}
				<span
					style={{
						display: "flex",
						alignItems: "center",
						gap: 4,
						fontSize: 11,
						color: "var(--vscode-descriptionForeground)",
					}}>
					<span className="codicon codicon-cloud-download" style={{ fontSize: 12 }} />
					<span>{item.downloadCount > 0 ? formatCount(item.downloadCount) : "0"} catalog downloads</span>
				</span>
			</div>

			{/* Description */}
			{item.description && (
				<p
					style={{
						margin: 0,
						fontSize: 12,
						color: "var(--vscode-foreground)",
						opacity: 0.8,
						lineHeight: 1.5,
						display: "-webkit-box",
						WebkitLineClamp: 2,
						WebkitBoxOrient: "vertical",
						overflow: "hidden",
					}}>
					{item.description}
				</p>
			)}

			{/* Footer: topic + tags + github */}
			<div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
				{item.topic && (
					<span
						style={{
							fontSize: 10,
							padding: "2px 7px",
							borderRadius: 10,
							background: "rgba(0,184,212,0.12)",
							color: cyan,
							fontWeight: 500,
						}}>
						{item.topic}
					</span>
				)}
				{item.tags.slice(0, 3).map((tag) => (
					<span
						key={tag}
						style={{
							fontSize: 10,
							padding: "2px 7px",
							borderRadius: 10,
							background: "var(--vscode-textBlockQuote-background, rgba(255,255,255,0.05))",
							color: "var(--vscode-descriptionForeground)",
						}}>
						{tag}
					</span>
				))}
				{item.githubUrl && (
					<a
						href={item.githubUrl}
						onClick={(e) => e.stopPropagation()}
						rel="noopener noreferrer"
						style={{ marginLeft: "auto", fontSize: 10, color: cyan, textDecoration: "none" }}
						target="_blank">
						GitHub ↗
					</a>
				)}
				{item.citationUrl && (
					<a
						href={item.citationUrl}
						onClick={(e) => e.stopPropagation()}
						rel="noopener noreferrer"
						style={{ fontSize: 10, color: cyan, textDecoration: "none" }}
						target="_blank">
						Cite ↗
					</a>
				)}
			</div>
		</div>
	)
}

export default LearningModuleCard
