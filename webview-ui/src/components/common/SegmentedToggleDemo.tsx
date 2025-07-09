import React, { useState } from "react"
import { SegmentedToggle } from "./SegmentedToggle"

/**
 * Demo component to showcase the SegmentedToggle functionality
 * This can be used for testing and development purposes
 */
export const SegmentedToggleDemo: React.FC = () => {
	const [accountType, setAccountType] = useState("")
	const [planType, setPlanType] = useState("basic")

	const accountOptions = [
		{ value: "", label: "Personal" },
		{ value: "cline", label: "Cline" },
		{ value: "enterprise", label: "Enterprise" },
	]

	const planOptions = [
		{ value: "basic", label: "Basic" },
		{ value: "pro", label: "Pro" },
		{ value: "team", label: "Team" },
	]

	return (
		<div className="p-6 space-y-6">
			<div>
				<h3 className="text-[var(--vscode-foreground)] mb-3">Account Type</h3>
				<SegmentedToggle
					options={accountOptions}
					value={accountType}
					onChange={setAccountType}
					className="w-full max-w-md"
				/>
				<p className="text-sm text-[var(--vscode-descriptionForeground)] mt-2">Selected: {accountType || "Personal"}</p>
			</div>

			<div>
				<h3 className="text-[var(--vscode-foreground)] mb-3">Plan Type</h3>
				<SegmentedToggle options={planOptions} value={planType} onChange={setPlanType} className="w-full max-w-md" />
				<p className="text-sm text-[var(--vscode-descriptionForeground)] mt-2">Selected: {planType}</p>
			</div>

			<div>
				<h3 className="text-[var(--vscode-foreground)] mb-3">Disabled State</h3>
				<SegmentedToggle
					options={accountOptions}
					value=""
					onChange={() => {}}
					disabled={true}
					className="w-full max-w-md"
				/>
			</div>
		</div>
	)
}
