interface TabButtonProps {
	icon: string
	label: string
	isActive: boolean
	onClick: () => void
}

export function TabButton({ icon, label, isActive, onClick }: TabButtonProps) {
	const activeClasses =
		"bg-vscode-editor-background border-b-2 border-vscode-focusBorder text-vscode-editor-foreground"
	const inactiveClasses =
		"bg-transparent border-b-2 border-transparent text-vscode-descriptionForeground hover:text-vscode-editor-foreground hover:bg-vscode-toolbar-hoverBackground"

	return (
		<button
			className={`px-4 py-2 border-none cursor-pointer flex items-center gap-1.5 text-[13px] transition-all duration-200 ease-in-out ${
				isActive ? activeClasses : inactiveClasses
			}`}
			onClick={onClick}>
			<span
				className={`codicon codicon-${icon} text-sm`}
				style={isActive ? { color: "var(--vscode-focusBorder)" } : undefined}></span>
			{label}
		</button>
	)
}
