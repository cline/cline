const SkillSubmitCard = () => (
	<div
		style={{
			margin: "0 16px 16px",
			border: "1px dashed var(--vscode-panel-border)",
			borderRadius: 6,
			padding: "16px",
			background: "var(--vscode-textBlockQuote-background, rgba(255,255,255,0.03))",
			display: "flex",
			flexDirection: "column",
			alignItems: "center",
			gap: 8,
			textAlign: "center",
		}}>
		<div style={{ display: "flex", alignItems: "center", gap: 8 }}>
			<span className="codicon codicon-github" style={{ fontSize: 18, color: "var(--vscode-descriptionForeground)" }} />
			<span style={{ fontSize: 13, fontWeight: 600, color: "var(--vscode-foreground)" }}>Author a skill?</span>
		</div>
		<p
			style={{
				margin: 0,
				fontSize: 12,
				color: "var(--vscode-descriptionForeground)",
				lineHeight: 1.5,
				maxWidth: 320,
			}}>
			Share a reusable skill with the AI-Hydro community. Submit a pull request with your skill definition file.
		</p>
		<a
			href="https://github.com/AI-Hydro/Skills/issues/new?template=new_skill.md"
			rel="noopener noreferrer"
			style={{
				fontSize: 12,
				color: "var(--vscode-textLink-foreground, #06b6d4)",
				textDecoration: "none",
				marginTop: 2,
			}}
			target="_blank">
			Open issue template on GitHub ↗
		</a>
	</div>
)

export default SkillSubmitCard
