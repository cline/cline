import { MarketplaceStarRequest } from "@shared/proto/cline/common"
import type { SkillItem } from "@shared/proto/cline/skills"
import { InstallSkillRequest } from "@shared/proto/cline/skills"
import { useState } from "react"
import { SkillsServiceClient } from "@/services/grpc-client"

interface SkillCardProps {
	item: SkillItem
	setError: (error: string | null) => void
	onRecognitionChange?: (skillId: string, starred: boolean, aiHydroStars: number) => void
}

const DOMAIN_COLORS: Record<string, { bg: string; text: string; initial: string }> = {
	"frequency-analysis": { bg: "rgba(14,99,156,0.2)", text: "#4fc3f7", initial: "F" },
	baseflow: { bg: "rgba(6,182,212,0.15)", text: "#06b6d4", initial: "B" },
	modelling: { bg: "rgba(107,33,168,0.2)", text: "#c084fc", initial: "M" },
	interpretation: { bg: "rgba(234,88,12,0.15)", text: "#fb923c", initial: "I" },
	general: { bg: "rgba(75,85,99,0.2)", text: "#9ca3af", initial: "G" },
}

function domainStyle(domain: string) {
	return (
		DOMAIN_COLORS[domain.toLowerCase()] ?? {
			bg: "rgba(0,163,255,0.12)",
			text: "#00A3FF",
			initial: (domain[0] ?? "S").toUpperCase(),
		}
	)
}

function formatCount(n: number): string {
	if (n >= 1000) {
		return (n / 1000).toFixed(1).replace(/\.0$/, "") + "k"
	}
	return String(n)
}

const SkillCard = ({ item, setError, onRecognitionChange }: SkillCardProps) => {
	const [isInstalling, setIsInstalling] = useState(false)
	const [installed, setInstalled] = useState(item.isInstalled)
	const [isStarring, setIsStarring] = useState(false)
	const [starred, setStarred] = useState(item.starredByClient)
	const [aiHydroInstalls, setAiHydroInstalls] = useState(item.aiHydroInstalls || 0)
	const [aiHydroStars, setAiHydroStars] = useState(item.aiHydroStars)

	const handleInstall = async (e: React.MouseEvent) => {
		e.preventDefault()
		e.stopPropagation()
		if (isInstalling || installed) {
			return
		}
		setIsInstalling(true)
		setError(null)
		try {
			const resp = await SkillsServiceClient.installSkill(
				InstallSkillRequest.create({
					skillId: item.skillId,
					skillUrl: item.skillUrl,
					name: item.name,
				}),
			)
			if (resp.success) {
				setInstalled(true)
				setAiHydroInstalls((current) => current + 1)
			} else {
				setError(resp.error ?? "Install failed")
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : "Install failed")
		} finally {
			setIsInstalling(false)
		}
	}

	const handleStar = async (e: React.MouseEvent) => {
		e.preventDefault()
		e.stopPropagation()
		if (isStarring) {
			return
		}
		const nextStarred = !starred
		setIsStarring(true)
		setError(null)
		try {
			const resp = await SkillsServiceClient.starSkill(
				MarketplaceStarRequest.create({
					marketplace: "skills",
					itemId: item.skillId,
					starred: nextStarred,
				}),
			)
			if (resp.error) {
				setError(resp.error)
				return
			}
			setStarred(resp.starred)
			setAiHydroStars(resp.aiHydroStars)
			onRecognitionChange?.(item.skillId, resp.starred, resp.aiHydroStars)
		} catch (err) {
			setError(err instanceof Error ? err.message : "AI-Hydro star update failed")
		} finally {
			setIsStarring(false)
		}
	}

	const ds = domainStyle(item.domain || "general")
	const domainInitial = ds.initial
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
			{/* Header row */}
			<div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
				{/* Gradient icon box */}
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
					{domainInitial}
				</div>

				{/* Name + domain badge */}
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
								maxWidth: 260,
							}}>
							{item.name}
						</span>
						{item.domain && (
							<span
								style={{
									fontSize: 10,
									fontWeight: 600,
									padding: "2px 7px",
									borderRadius: 10,
									background: ds.bg,
									color: ds.text,
									textTransform: "capitalize",
									flexShrink: 0,
								}}>
								{item.domain}
							</span>
						)}
					</div>
					{item.author && (
						<div style={{ fontSize: 11, color: "var(--vscode-descriptionForeground)", marginTop: 2 }}>
							by {item.author}
						</div>
					)}
					{item.authorUrl && (
						<a
							href={item.authorUrl}
							onClick={(e) => e.stopPropagation()}
							rel="noopener noreferrer"
							style={{
								color: cyan,
								display: "inline-block",
								fontSize: 10,
								marginTop: 2,
								textDecoration: "none",
							}}
							target="_blank">
							Profile ↗
						</a>
					)}
				</div>

				<div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end", flexShrink: 0 }}>
					<button
						aria-label={starred ? "Remove your AI-Hydro star" : "Star this skill in AI-Hydro"}
						disabled={isStarring}
						onClick={handleStar}
						style={{
							background: starred ? "rgba(250, 204, 21, 0.16)" : "transparent",
							border: "1px solid var(--vscode-panel-border, rgba(255,255,255,0.16))",
							borderRadius: 4,
							color: starred ? "#facc15" : "var(--vscode-descriptionForeground)",
							cursor: isStarring ? "wait" : "pointer",
							fontSize: 13,
							lineHeight: 1,
							padding: "4px 7px",
						}}
						title={starred ? "Remove your AI-Hydro star" : "Star this skill in AI-Hydro"}
						type="button">
						{starred ? "★" : "☆"}
					</button>
					<button
						disabled={isInstalling || installed}
						onClick={handleInstall}
						style={{
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
			</div>

			{/* Stats row */}
			<div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
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
					<span>{formatCount(aiHydroInstalls)} AI-Hydro installs</span>
				</span>
				<span
					style={{
						display: "flex",
						alignItems: "center",
						gap: 4,
						fontSize: 11,
						color: starred ? "#facc15" : "var(--vscode-descriptionForeground)",
					}}
					title="AI-Hydro user stars">
					<span style={{ fontSize: 12, lineHeight: 1 }}>{starred ? "★" : "☆"}</span>
					<span>{formatCount(aiHydroStars)} AI-Hydro stars</span>
				</span>
				{item.githubStars > 0 && (
					<span
						style={{
							display: "flex",
							alignItems: "center",
							gap: 4,
							fontSize: 11,
							color: "var(--vscode-descriptionForeground)",
						}}>
						<span className="codicon codicon-star" style={{ fontSize: 12 }} />
						<span>{formatCount(item.githubStars)} GitHub stars</span>
					</span>
				)}
				{item.downloadCount > 0 && (
					<span
						style={{
							display: "flex",
							alignItems: "center",
							gap: 4,
							fontSize: 11,
							color: "var(--vscode-descriptionForeground)",
						}}
						title="Catalog-maintained download count">
						<span className="codicon codicon-archive" style={{ fontSize: 12 }} />
						<span>{formatCount(item.downloadCount)} catalog downloads</span>
					</span>
				)}
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

			{/* When to use */}
			{item.whenToUse && (
				<p
					style={{
						margin: 0,
						fontSize: 11,
						color: "var(--vscode-descriptionForeground)",
						fontStyle: "italic",
						overflow: "hidden",
						textOverflow: "ellipsis",
						whiteSpace: "nowrap",
					}}>
					{item.whenToUse}
				</p>
			)}

			{/* Footer: tags + tools_used + github */}
			<div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
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
				{item.toolsUsed.slice(0, 3).map((tool) => (
					<span
						key={tool}
						style={{
							fontSize: 10,
							padding: "2px 7px",
							borderRadius: 10,
							background: "rgba(0,163,255,0.08)",
							color: "#00A3FF",
							fontFamily: "monospace",
						}}>
						{tool}
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

export default SkillCard
