import { OPENAI_REASONING_EFFORTS, type OpenaiReasoningEffortOption } from "@shared/reasoning"
import { VSCodeDropdown, VSCodeOption } from "@vscode/webview-ui-toolkit/react"
import { DROPDOWN_Z_INDEX, DropdownContainer } from "../ApiOptions"

interface ReasoningEffortDropdownProps {
	value: OpenaiReasoningEffortOption
	onChange: (value: OpenaiReasoningEffortOption) => void
	zIndex?: number
}

export const ReasoningEffortDropdown = ({ value, onChange, zIndex = DROPDOWN_Z_INDEX - 100 }: ReasoningEffortDropdownProps) => {
	return (
		<div style={{ marginTop: "10px" }}>
			<label htmlFor="reasoning-effort-dropdown">
				<span style={{ fontWeight: 500 }}>Reasoning Effort</span>
			</label>
			<DropdownContainer className="dropdown-container" zIndex={zIndex}>
				<VSCodeDropdown
					id="reasoning-effort-dropdown"
					onChange={(e: any) => {
						const selectedValue = e.target.value as OpenaiReasoningEffortOption
						if (OPENAI_REASONING_EFFORTS.includes(selectedValue)) {
							onChange(selectedValue)
						}
					}}
					style={{ minWidth: 130, marginTop: 3 }}
					value={value}>
					{OPENAI_REASONING_EFFORTS.map((effort) => (
						<VSCodeOption key={effort} value={effort}>
							{effort.charAt(0).toUpperCase() + effort.slice(1)}
						</VSCodeOption>
					))}
				</VSCodeDropdown>
			</DropdownContainer>
			<p
				style={{
					fontSize: "12px",
					marginTop: 3,
					marginBottom: "10px",
					color: "var(--vscode-descriptionForeground)",
				}}>
				Controls the amount of structured reasoning requested for this model. Higher effort may increase quality and
				latency.
			</p>
		</div>
	)
}
