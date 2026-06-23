import { Mode } from "@shared/storage/types"
import { ClineAccountInfoCard } from "../ClineAccountInfoCard"
import ClineModelPicker from "../ClineModelPicker"

/**
 * Props for the ClineProvider component
 */
interface ClineProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
	initialModelTab?: "recommended" | "free"
	isClinePassEnabled?: boolean
}

/**
 * The Cline provider configuration component
 */
export const ClineProvider = ({
	showModelOptions,
	isPopup,
	currentMode,
	initialModelTab,
	isClinePassEnabled,
}: ClineProviderProps) => {
	return (
		<div>
			{/* Cline Account Info Card */}
			<div style={{ marginBottom: 14, marginTop: 4 }}>
				<ClineAccountInfoCard />
			</div>

			{showModelOptions && (
				<ClineModelPicker
					currentMode={currentMode}
					initialTab={initialModelTab}
					isClinePassEnabled={isClinePassEnabled}
					isPopup={isPopup}
					showProviderRouting={true}
				/>
			)}
		</div>
	)
}
