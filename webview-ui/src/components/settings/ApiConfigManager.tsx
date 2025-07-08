import { memo, useEffect, useRef, useState } from "react"
import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { AlertTriangle } from "lucide-react"

import type { ProviderSettingsEntry, OrganizationAllowList } from "@roo-code/types"

import { useAppTranslation } from "@/i18n/TranslationContext"
import { Button, Input, Dialog, DialogContent, DialogTitle, StandardTooltip, SearchableSelect } from "@/components/ui"
import type { SearchableSelectOption } from "@/components/ui"

interface ApiConfigManagerProps {
	currentApiConfigName?: string
	listApiConfigMeta?: ProviderSettingsEntry[]
	organizationAllowList?: OrganizationAllowList
	onSelectConfig: (configName: string) => void
	onDeleteConfig: (configName: string) => void
	onRenameConfig: (oldName: string, newName: string) => void
	onUpsertConfig: (configName: string) => void
}

const ApiConfigManager = ({
	currentApiConfigName = "",
	listApiConfigMeta = [],
	organizationAllowList,
	onSelectConfig,
	onDeleteConfig,
	onRenameConfig,
	onUpsertConfig,
}: ApiConfigManagerProps) => {
	const { t } = useAppTranslation()

	const [isRenaming, setIsRenaming] = useState(false)
	const [isCreating, setIsCreating] = useState(false)
	const [inputValue, setInputValue] = useState("")
	const [newProfileName, setNewProfileName] = useState("")
	const [error, setError] = useState<string | null>(null)
	const inputRef = useRef<any>(null)
	const newProfileInputRef = useRef<any>(null)

	// Check if a profile is valid based on the organization allow list
	const isProfileValid = (profile: ProviderSettingsEntry): boolean => {
		// If no organization allow list or allowAll is true, all profiles are valid
		if (!organizationAllowList || organizationAllowList.allowAll) {
			return true
		}

		// Check if the provider is allowed
		const provider = profile.apiProvider
		if (!provider) return true

		const providerConfig = organizationAllowList.providers[provider]
		if (!providerConfig) {
			return false
		}

		// If provider allows all models, profile is valid
		return !!providerConfig.allowAll || !!(providerConfig.models && providerConfig.models.length > 0)
	}

	const validateName = (name: string, isNewProfile: boolean): string | null => {
		const trimmed = name.trim()
		if (!trimmed) return t("settings:providers.nameEmpty")

		const nameExists = listApiConfigMeta?.some((config) => config.name.toLowerCase() === trimmed.toLowerCase())

		// For new profiles, any existing name is invalid.
		if (isNewProfile && nameExists) {
			return t("settings:providers.nameExists")
		}

		// For rename, only block if trying to rename to a different existing profile.
		if (!isNewProfile && nameExists && trimmed.toLowerCase() !== currentApiConfigName?.toLowerCase()) {
			return t("settings:providers.nameExists")
		}

		return null
	}

	const resetCreateState = () => {
		setIsCreating(false)
		setNewProfileName("")
		setError(null)
	}

	const resetRenameState = () => {
		setIsRenaming(false)
		setInputValue("")
		setError(null)
	}

	// Focus input when entering rename mode.
	useEffect(() => {
		if (isRenaming) {
			const timeoutId = setTimeout(() => inputRef.current?.focus(), 0)
			return () => clearTimeout(timeoutId)
		}
	}, [isRenaming])

	// Focus input when opening new dialog.
	useEffect(() => {
		if (isCreating) {
			const timeoutId = setTimeout(() => newProfileInputRef.current?.focus(), 0)
			return () => clearTimeout(timeoutId)
		}
	}, [isCreating])

	// Reset state when current profile changes.
	useEffect(() => {
		resetCreateState()
		resetRenameState()
	}, [currentApiConfigName])

	const handleSelectConfig = (configName: string) => {
		if (!configName) return
		onSelectConfig(configName)
	}

	const handleAdd = () => {
		resetCreateState()
		setIsCreating(true)
	}

	const handleStartRename = () => {
		setIsRenaming(true)
		setInputValue(currentApiConfigName || "")
		setError(null)
	}

	const handleCancel = () => {
		resetRenameState()
	}

	const handleSave = () => {
		const trimmedValue = inputValue.trim()
		const error = validateName(trimmedValue, false)

		if (error) {
			setError(error)
			return
		}

		if (isRenaming && currentApiConfigName) {
			if (currentApiConfigName === trimmedValue) {
				resetRenameState()
				return
			}
			onRenameConfig(currentApiConfigName, trimmedValue)
		}

		resetRenameState()
	}

	const handleNewProfileSave = () => {
		const trimmedValue = newProfileName.trim()
		const error = validateName(trimmedValue, true)

		if (error) {
			setError(error)
			return
		}

		onUpsertConfig(trimmedValue)
		resetCreateState()
	}

	const handleDelete = () => {
		if (!currentApiConfigName || !listApiConfigMeta || listApiConfigMeta.length <= 1) return

		// Let the extension handle both deletion and selection.
		onDeleteConfig(currentApiConfigName)
	}

	const isOnlyProfile = listApiConfigMeta?.length === 1

	return (
		<div className="flex flex-col gap-1">
			<label className="block font-medium mb-1">{t("settings:providers.configProfile")}</label>

			{isRenaming ? (
				<div data-testid="rename-form">
					<div className="flex items-center gap-1">
						<VSCodeTextField
							ref={inputRef}
							value={inputValue}
							onInput={(e: unknown) => {
								const target = e as { target: { value: string } }
								setInputValue(target.target.value)
								setError(null)
							}}
							placeholder={t("settings:providers.enterNewName")}
							onKeyDown={({ key }) => {
								if (key === "Enter" && inputValue.trim()) {
									handleSave()
								} else if (key === "Escape") {
									handleCancel()
								}
							}}
							className="grow"
						/>
						<StandardTooltip content={t("settings:common.save")}>
							<Button
								variant="ghost"
								size="icon"
								disabled={!inputValue.trim()}
								onClick={handleSave}
								data-testid="save-rename-button">
								<span className="codicon codicon-check" />
							</Button>
						</StandardTooltip>
						<StandardTooltip content={t("settings:common.cancel")}>
							<Button
								variant="ghost"
								size="icon"
								onClick={handleCancel}
								data-testid="cancel-rename-button">
								<span className="codicon codicon-close" />
							</Button>
						</StandardTooltip>
					</div>
					{error && (
						<div className="text-vscode-descriptionForeground text-sm mt-1" data-testid="error-message">
							{error}
						</div>
					)}
				</div>
			) : (
				<>
					<div className="flex items-center gap-1">
						<SearchableSelect
							value={currentApiConfigName}
							onValueChange={handleSelectConfig}
							options={listApiConfigMeta.map((config) => {
								const valid = isProfileValid(config)
								return {
									value: config.name,
									label: config.name,
									disabled: !valid,
									icon: !valid ? (
										<StandardTooltip content={t("settings:validation.profileInvalid")}>
											<span>
												<AlertTriangle size={16} className="mr-2 text-vscode-errorForeground" />
											</span>
										</StandardTooltip>
									) : undefined,
								} as SearchableSelectOption
							})}
							placeholder={t("settings:common.select")}
							searchPlaceholder={t("settings:providers.searchPlaceholder")}
							emptyMessage={t("settings:providers.noMatchFound")}
							className="grow"
							data-testid="select-component"
						/>
						<StandardTooltip content={t("settings:providers.addProfile")}>
							<Button variant="ghost" size="icon" onClick={handleAdd} data-testid="add-profile-button">
								<span className="codicon codicon-add" />
							</Button>
						</StandardTooltip>
						{currentApiConfigName && (
							<>
								<StandardTooltip content={t("settings:providers.renameProfile")}>
									<Button
										variant="ghost"
										size="icon"
										onClick={handleStartRename}
										data-testid="rename-profile-button">
										<span className="codicon codicon-edit" />
									</Button>
								</StandardTooltip>
								<StandardTooltip
									content={
										isOnlyProfile
											? t("settings:providers.cannotDeleteOnlyProfile")
											: t("settings:providers.deleteProfile")
									}>
									<Button
										variant="ghost"
										size="icon"
										onClick={handleDelete}
										data-testid="delete-profile-button"
										disabled={isOnlyProfile}>
										<span className="codicon codicon-trash" />
									</Button>
								</StandardTooltip>
							</>
						)}
					</div>
					<div className="text-vscode-descriptionForeground text-sm mt-1">
						{t("settings:providers.description")}
					</div>
				</>
			)}

			<Dialog
				open={isCreating}
				onOpenChange={(open: boolean) => {
					if (open) {
						setIsCreating(true)
						setNewProfileName("")
						setError(null)
					} else {
						resetCreateState()
					}
				}}
				aria-labelledby="new-profile-title">
				<DialogContent className="p-4 max-w-sm bg-card">
					<DialogTitle>{t("settings:providers.newProfile")}</DialogTitle>
					<Input
						ref={newProfileInputRef}
						value={newProfileName}
						onInput={(e: unknown) => {
							const target = e as { target: { value: string } }
							setNewProfileName(target.target.value)
							setError(null)
						}}
						placeholder={t("settings:providers.enterProfileName")}
						data-testid="new-profile-input"
						style={{ width: "100%" }}
						onKeyDown={(e: unknown) => {
							const event = e as { key: string }
							if (event.key === "Enter" && newProfileName.trim()) {
								handleNewProfileSave()
							} else if (event.key === "Escape") {
								resetCreateState()
							}
						}}
					/>
					{error && (
						<p className="text-vscode-errorForeground text-sm mt-2" data-testid="error-message">
							{error}
						</p>
					)}
					<div className="flex justify-end gap-2 mt-4">
						<Button variant="secondary" onClick={resetCreateState} data-testid="cancel-new-profile-button">
							{t("settings:common.cancel")}
						</Button>
						<Button
							variant="default"
							disabled={!newProfileName.trim()}
							onClick={handleNewProfileSave}
							data-testid="create-profile-button">
							{t("settings:providers.createProfile")}
						</Button>
					</div>
				</DialogContent>
			</Dialog>
		</div>
	)
}

export default memo(ApiConfigManager)
