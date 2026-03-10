const PromptsSubmitCard = () => {
	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				alignItems: "center",
				gap: "12px",
				padding: "15px",
				margin: "20px 0",
				backgroundColor: "var(--vscode-textBlockQuote-background)",
				borderRadius: "6px",
			}}>
			{/* Icon */}
			<i className="codicon codicon-add" style={{ fontSize: "18px" }} />

			{/* Content */}
			<div
				style={{
					display: "flex",
					flexDirection: "column",
					alignItems: "center",
					gap: "4px",
					textAlign: "center",
					maxWidth: "480px",
				}}>
				<h3
					style={{
						margin: 0,
						fontSize: "14px",
						fontWeight: 600,
						color: "var(--vscode-foreground)",
					}}>
					Submit Prompts
				</h3>
				<p style={{ fontSize: "13px", margin: 0, color: "var(--vscode-descriptionForeground)" }}>
					Help others discover great rules, workflows, hooks, and skills by submitting an issue to{" "}
					<a href="https://github.com/cline/prompts">github.com/cline/prompts</a>
				</p>
			</div>
		</div>
	)
}

export default PromptsSubmitCard
