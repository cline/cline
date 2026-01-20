import React from "react"

interface FeatureGroupProps {
	title: string
	description?: string
	children: React.ReactNode
	isGridItem?: boolean
}

export const FeatureGroup: React.FC<FeatureGroupProps> = ({ title, description, children, isGridItem = false }) => {
	return (
		<div
			className={`p-4 rounded-md ${isGridItem ? "" : "mb-6"}`}
			style={{
				border: "1px solid var(--vscode-widget-border)",
				backgroundColor: "transparent",
			}}>
			<div className={isGridItem ? "mb-2" : "mb-3"}>
				<div
					className={`font-medium uppercase tracking-wide ${isGridItem ? "text-[10px] mb-1" : "text-xs mb-1"}`}
					style={{
						color: "var(--vscode-descriptionForeground)",
						letterSpacing: "0.5px",
					}}>
					{title}
				</div>
				{description && (
					<div
						className={`text-[11px] leading-snug ${isGridItem ? "hidden lg:block" : ""}`}
						style={{ color: "var(--vscode-descriptionForeground)" }}>
						{description}
					</div>
				)}
			</div>
			<div className={isGridItem ? "space-y-2" : "space-y-4"}>{children}</div>
		</div>
	)
}
