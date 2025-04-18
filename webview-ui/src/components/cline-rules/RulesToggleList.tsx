import NewRuleRow from "./NewRuleRow"
import RuleRow from "./RuleRow"

const RulesToggleList = ({
	rules,
	toggleRule,
	listGap = "medium",
	isGlobal,
}: {
	rules: [string, boolean][]
	toggleRule: (rulePath: string, enabled: boolean) => void
	listGap?: "small" | "medium" | "large"
	isGlobal: boolean
}) => {
	const gapClasses = {
		small: "gap-0",
		medium: "gap-2.5",
		large: "gap-5",
	}

	const gapClass = gapClasses[listGap]

	return (
		<div className={`flex flex-col ${gapClass}`}>
			{rules.length > 0 ? (
				<>
					{rules.map(([rulePath, enabled]) => (
						<RuleRow
							key={rulePath}
							rulePath={rulePath}
							enabled={enabled}
							isGlobal={isGlobal}
							toggleRule={toggleRule}
						/>
					))}
					<NewRuleRow isGlobal={isGlobal} />
				</>
			) : (
				<>
					<div className="flex flex-col items-center gap-3 my-3 text-[var(--vscode-descriptionForeground)]">
						No rules found
					</div>
					<NewRuleRow isGlobal={isGlobal} />
				</>
			)}
		</div>
	)
}

export default RulesToggleList
