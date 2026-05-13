import { useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useExtensionState } from "@/context/ExtensionStateContext"
import type { ApiConfiguration } from "../../../../../src/shared/api"
import ApiOptions from "../ApiOptions"
import ProfileManager from "../ProfileManager"
import Section from "../Section"
import { getModeSpecificFields } from "../utils/providerUtils"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

interface ApiConfigurationSectionProps {
	renderSectionHeader?: (tabId: string) => JSX.Element | null
	initialModelTab?: "recommended" | "free"
}

const ApiConfigurationSection = ({ renderSectionHeader, initialModelTab }: ApiConfigurationSectionProps) => {
	const {
		mode,
		apiConfiguration,
		apiConfigProfiles,
		handleCreateProfile,
		handleUpdateProfile,
		handleDeleteProfile,
		handleResetApiConfiguration,
		handleSetApiConfiguration,
	} = useExtensionState()
	const { handleFieldsChange } = useApiConfigurationHandlers()

	const [formMode, setFormMode] = useState<"hidden" | "adding" | "editing">("hidden")
	const [editingProfileId, setEditingProfileId] = useState<string | null>(null)
	const savedConfigRef = useRef<ApiConfiguration | undefined>(undefined)
	const isSavingRef = useRef(false)

	const handleStartAdd = () => {
		savedConfigRef.current = apiConfiguration
		handleResetApiConfiguration(mode)
		setFormMode("adding")
	}

	const handleStartEdit = (profileId: string) => {
		const profile = apiConfigProfiles.find((p) => p.id === profileId)
		if (!profile) return
		savedConfigRef.current = apiConfiguration
		const modeKey = mode === "plan" ? "planConfig" : "actConfig"
		handleSetApiConfiguration({
			...apiConfiguration,
			[modeKey]: {
				...(apiConfiguration as any)?.[modeKey],
				apiProvider: profile.provider,
				modelId: profile.modelId,
				modelInfo: profile.modelInfo,
				thinkingBudgetTokens: profile.thinkingBudgetTokens,
				reasoningEffort: profile.reasoningEffort,
				vsCodeLmModelSelector: profile.vsCodeLmModelSelector,
				awsBedrockCustomSelected: profile.awsBedrockCustomSelected,
				awsBedrockCustomModelBaseId: profile.awsBedrockCustomModelBaseId,
				sapAiCoreDeploymentId: profile.sapAiCoreDeploymentId,
				ocaReasoningEffort: profile.ocaReasoningEffort,
			},
		} as ApiConfiguration)
		setEditingProfileId(profileId)
		setFormMode("editing")
	}

	const handleCancel = () => {
		if (isSavingRef.current) {
			isSavingRef.current = false
			return
		}
		if (savedConfigRef.current) {
			handleFieldsChange(savedConfigRef.current)
		}
		setFormMode("hidden")
		setEditingProfileId(null)
	}

	const handleSave = () => {
		const currentModeConfig = getModeSpecificFields(apiConfiguration, mode)
		if (formMode === "adding") {
			const newId = crypto.randomUUID()
			if (!currentModeConfig?.modelId) return
			handleCreateProfile({
				id: newId,
				provider: currentModeConfig?.apiProvider ?? "openrouter",
				modelId: currentModeConfig.modelId,
				modelInfo: currentModeConfig?.modelInfo,
				thinkingBudgetTokens: currentModeConfig?.thinkingBudgetTokens,
				reasoningEffort: currentModeConfig?.reasoningEffort,
				globalConfig: {},
			})
			// Only sync the other mode on first profile so switching modes shows it
			if (apiConfigProfiles.length === 0) {
				const otherModeKey = mode === "plan" ? "actConfig" : "planConfig"
				handleFieldsChange({
					[otherModeKey]: {
						...(apiConfiguration as any)?.[otherModeKey],
						apiProvider: currentModeConfig?.apiProvider,
						modelId: currentModeConfig.modelId,
						modelInfo: currentModeConfig?.modelInfo,
					},
				} as any)
			} else if (savedConfigRef.current) {
				// Restore current mode's config to pre-dialog state for subsequent profiles
				const modeKey = mode === "plan" ? "planConfig" : "actConfig"
				handleFieldsChange({
					[modeKey]: savedConfigRef.current[modeKey],
				} as any)
			}
		} else if (formMode === "editing" && editingProfileId) {
			if (!currentModeConfig?.modelId) return
			handleUpdateProfile(editingProfileId, {
				provider: currentModeConfig?.apiProvider ?? "openrouter",
				modelId: currentModeConfig.modelId,
				modelInfo: currentModeConfig?.modelInfo,
				thinkingBudgetTokens: currentModeConfig?.thinkingBudgetTokens,
				reasoningEffort: currentModeConfig?.reasoningEffort,
			})
		}
		isSavingRef.current = true
		setFormMode("hidden")
		setEditingProfileId(null)
	}

	const handleDelete = (profileId: string) => {
		if (profileId === editingProfileId && formMode === "editing") {
			setFormMode("hidden")
			setEditingProfileId(null)
		}
		handleDeleteProfile(profileId)
	}

	return (
		<div style={{ width: "100%" }}>
			{renderSectionHeader?.("api-config")}
			<Section>
				<ProfileManager
					currentMode={mode}
					onDelete={handleDelete}
					onStartAdd={handleStartAdd}
					onStartEdit={handleStartEdit}
				/>

				<Dialog
					onOpenChange={(open) => {
						if (!open) handleCancel()
					}}
					open={formMode !== "hidden"}>
					<DialogContent className="max-w-2xl" hideClose>
						<DialogHeader>
							<DialogTitle style={{ fontSize: "14px", fontWeight: 500 }}>
								{formMode === "adding" ? "Add" : "Edit"}
							</DialogTitle>
						</DialogHeader>

						<div className="overflow-y-auto max-h-[60vh]" style={{ scrollbarWidth: "thin" }}>
							<ApiOptions currentMode={mode} initialModelTab={initialModelTab} showModelOptions={true} />
						</div>

						<DialogFooter>
							<Button onClick={handleCancel} size="header" variant="secondary">
								Cancel
							</Button>
							<Button onClick={handleSave} size="header">
								Save
							</Button>
						</DialogFooter>
					</DialogContent>
				</Dialog>
			</Section>
		</div>
	)
}

export default ApiConfigurationSection
