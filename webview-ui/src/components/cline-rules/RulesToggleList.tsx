import RuleRow from "./RuleRow"

const RulesToggleList = ({
	rules,
	toggleRule,
	isGlobal,
	listGap = "medium",
}: {
	rules: [string, boolean][]
	toggleRule: (rulePath: string, enabled: boolean) => void
	isGlobal: boolean
	listGap?: "small" | "medium" | "large"
}) => {
	const gapClasses = {
		small: "gap-0",
		medium: "gap-2.5",
		large: "gap-5",
	}

	const gapClass = gapClasses[listGap]

	return rules.length > 0 ? (
		<div className={`flex flex-col ${gapClass}`}>
			{rules.map(([rulePath, enabled]) => (
				<RuleRow key={rulePath} rulePath={rulePath} enabled={enabled} isGlobal={isGlobal} toggleRule={toggleRule} />
			))}
		</div>
	) : (
		<div className="flex flex-col items-center gap-3 my-5 text-[var(--vscode-descriptionForeground)]">No rules found</div>
	)
}

export default RulesToggleList
