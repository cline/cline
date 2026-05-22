import { useState } from "react"
import SkillsConfiguredTab from "./SkillsConfiguredTab"
import SkillsMarketplaceTab from "./SkillsMarketplaceTab"

type SkillsTab = "configured" | "marketplace"

interface SkillsViewProps {
	onDone: () => void
}

const SkillsView = ({ onDone }: SkillsViewProps) => {
	const [activeTab, setActiveTab] = useState<SkillsTab>("configured")

	return (
		<div
			style={{
				position: "fixed",
				top: 0,
				left: 0,
				right: 0,
				bottom: 0,
				display: "flex",
				flexDirection: "column",
				background: "var(--vscode-editor-background)",
			}}>
			{/* Header */}
			<div
				style={{
					display: "flex",
					justifyContent: "space-between",
					alignItems: "center",
					padding: "10px 17px 5px 20px",
					flexShrink: 0,
				}}>
				<h3
					style={{
						margin: 0,
						fontSize: 14,
						fontWeight: 600,
						color: "var(--vscode-textLink-foreground, #06b6d4)",
					}}>
					Skills
				</h3>
				<button
					onClick={onDone}
					style={{
						background: "none",
						border: "none",
						cursor: "pointer",
						color: "var(--vscode-foreground)",
						display: "flex",
						alignItems: "center",
						padding: "4px 6px",
						borderRadius: 3,
						fontSize: 12,
						gap: 4,
					}}
					title="Close"
					type="button">
					<span className="codicon codicon-close" style={{ fontSize: 14 }} />
					<span>Done</span>
				</button>
			</div>

			{/* Tab bar */}
			<div
				style={{
					display: "flex",
					gap: 1,
					padding: "0 20px",
					borderBottom: "1px solid var(--vscode-panel-border)",
					flexShrink: 0,
				}}>
				<TabButton isActive={activeTab === "configured"} onClick={() => setActiveTab("configured")}>
					Configured
				</TabButton>
				<TabButton isActive={activeTab === "marketplace"} onClick={() => setActiveTab("marketplace")}>
					Marketplace
				</TabButton>
			</div>

			{/* Tab content */}
			<div style={{ flex: 1, overflow: "auto" }}>
				{activeTab === "configured" && <SkillsConfiguredTab />}
				{activeTab === "marketplace" && <SkillsMarketplaceTab />}
			</div>
		</div>
	)
}

// ---------------------------------------------------------------------------
// Tab button (same pattern as ConnectorsView)
// ---------------------------------------------------------------------------

interface TabButtonProps {
	isActive: boolean
	onClick: () => void
	children: React.ReactNode
}

const TabButton = ({ isActive, onClick, children }: TabButtonProps) => {
	const [hovered, setHovered] = useState(false)

	return (
		<button
			onClick={onClick}
			onMouseEnter={() => setHovered(true)}
			onMouseLeave={() => setHovered(false)}
			style={{
				background: "none",
				border: "none",
				borderBottom: isActive ? "2px solid var(--vscode-foreground)" : "2px solid transparent",
				color: isActive || hovered ? "var(--vscode-foreground)" : "var(--vscode-descriptionForeground)",
				padding: "8px 16px",
				cursor: "pointer",
				fontSize: 13,
				transition: "color 0.2s",
			}}
			type="button">
			{children}
		</button>
	)
}

export default SkillsView
