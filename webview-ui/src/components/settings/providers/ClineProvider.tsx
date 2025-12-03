import { Mode } from "@shared/storage/types"
import { VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { ClineAccountInfoCard } from "../ClineAccountInfoCard"
import OpenRouterModelPicker from "../OpenRouterModelPicker"

/**
 * Props for the ClineProvider component
 */
interface ClineProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

/**
 * The Cline provider configuration component
 */
export const ClineProvider = ({ showModelOptions, isPopup, currentMode }: ClineProviderProps) => {
	return (
		<div>
			{/* Cline Account Info Card */}
			<div style={{ marginBottom: 14, marginTop: 4 }}>
				<ClineAccountInfoCard />
			</div>

			{/* View Billing & Usage Link */}
			<div style={{ marginBottom: 12 }}>
				<VSCodeLink href="https://openrouter.ai/activity" style={{ fontSize: "12px" }}>
					View Billing & Usage
				</VSCodeLink>
			</div>

			{showModelOptions && (
				<>
					{/* OpenRouter Model Picker - includes Provider Routing in Advanced section */}
					<OpenRouterModelPicker currentMode={currentMode} isPopup={isPopup} showProviderRouting={true} />
				</>
			)}
		</div>
	)
}
