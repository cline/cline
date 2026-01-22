import React from "react"

interface FeatureGroupProps {
	title: string
	description?: string
	children: React.ReactNode
	isGridItem?: boolean
}

export const FeatureGroup: React.FC<FeatureGroupProps> = ({ title, description, children, isGridItem = false }) => {
	return (
		<div className={isGridItem ? "" : "mb-6"}>
			{/* Title outside container */}
			<div className={isGridItem ? "mb-2" : "mb-3"}>
				<div
					className="text-base font-medium mb-1"
					style={{
						color: "var(--vscode-foreground)",
					}}>
					{title}
				</div>
			</div>

			{/* Container with lighter background and no border */}
			<div
				className="px-3 py-1 rounded-md"
				style={{
					backgroundColor: "rgba(255, 255, 255, 0.03)",
					border: "none",
				}}>
				<div className={isGridItem ? "space-y-0" : "space-y-4"}>
					{React.Children.toArray(children)
						.filter((child) => child) // Filter out null/undefined/false children
						.map((child, index, array) => {
							const isLast = index === array.length - 1
							const showDivider = array.length > 1 && !isLast
							return (
								<div key={index}>
									<div className="py-2">{child}</div>
									{showDivider && (
										<div
											style={{
												height: "1px",
												borderBottom: "1px solid rgba(128, 128, 128, 0.15)",
												marginTop: "2px",
												marginBottom: "2px",
											}}
										/>
									)}
								</div>
							)
						})}
				</div>
			</div>
		</div>
	)
}
