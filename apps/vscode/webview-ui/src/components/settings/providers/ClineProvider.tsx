import { clinePassDefaultModelId, clinePassModels } from "@shared/api"
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
	variant?: "cline" | "cline-pass"
}

/**
 * The Cline provider configuration component
 */
export const ClineProvider = ({
	showModelOptions,
	isPopup,
	currentMode,
	initialModelTab,
	variant = "cline",
}: ClineProviderProps) => {
	const isClinePass = variant === "cline-pass"

	return (
		<div>
			{/* Cline Account Info Card */}
			<div style={{ marginBottom: 14, marginTop: 4 }}>
				<ClineAccountInfoCard />
			</div>

			{showModelOptions && (
				<>
					<ClineModelPicker
						currentMode={currentMode}
						defaultModelId={isClinePass ? clinePassDefaultModelId : undefined}
						initialTab={initialModelTab}
						isPopup={isPopup}
						models={isClinePass ? clinePassModels : undefined}
						showFeaturedModels={!isClinePass}
						showProviderRouting={true}
					/>
				</>
			)}
		</div>
	)
}
