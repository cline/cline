import { Mode } from "@shared/storage/types"
import { BeadsmithAccountInfoCard } from "../BeadsmithAccountInfoCard"
import OpenRouterModelPicker from "../OpenRouterModelPicker"

/**
 * Props for the ClineProvider component
 */
interface BeadsmithProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
	initialModelTab?: "recommended" | "free"
}

/**
 * The Beadsmith provider configuration component
 */
export const BeadsmithProvider = ({ showModelOptions, isPopup, currentMode, initialModelTab }: BeadsmithProviderProps) => {
	return (
		<div>
			{/* Beadsmith Account Info Card */}
			<div style={{ marginBottom: 14, marginTop: 4 }}>
				<BeadsmithAccountInfoCard />
			</div>

			{showModelOptions && (
				<>
					{/* OpenRouter Model Picker - includes Provider Routing in Advanced section */}
					<OpenRouterModelPicker
						currentMode={currentMode}
						initialTab={initialModelTab}
						isPopup={isPopup}
						showProviderRouting={true}
					/>
				</>
			)}
		</div>
	)
}
