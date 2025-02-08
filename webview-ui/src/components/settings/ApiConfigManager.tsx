import { VSCodeButton, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { memo, useEffect, useRef, useState } from "react"
import { ApiConfigMeta } from "../../../../src/shared/ExtensionMessage"
import { Dropdown } from "vscrui"
import type { DropdownOption } from "vscrui"
import { Dialog, DialogContent } from "../ui/dialog"

interface ApiConfigManagerProps {
	currentApiConfigName?: string
	listApiConfigMeta?: ApiConfigMeta[]
	onSelectConfig: (configName: string) => void
	onDeleteConfig: (configName: string) => void
	onRenameConfig: (oldName: string, newName: string) => void
	onUpsertConfig: (configName: string) => void
}

const ApiConfigManager = ({
	currentApiConfigName = "",
	listApiConfigMeta = [],
	onSelectConfig,
	onDeleteConfig,
	onRenameConfig,
	onUpsertConfig,
}: ApiConfigManagerProps) => {
	const [isRenaming, setIsRenaming] = useState(false)
	const [isCreating, setIsCreating] = useState(false)
	const [inputValue, setInputValue] = useState("")
	const [newProfileName, setNewProfileName] = useState("")
	const [error, setError] = useState<string | null>(null)
	const inputRef = useRef<any>(null)
	const newProfileInputRef = useRef<any>(null)

	const validateName = (name: string, isNewProfile: boolean): string | null => {
		const trimmed = name.trim()
		if (!trimmed) return "Name cannot be empty"

		const nameExists = listApiConfigMeta?.some((config) => config.name.toLowerCase() === trimmed.toLowerCase())

		// For new profiles, any existing name is invalid
		if (isNewProfile && nameExists) {
			return "A profile with this name already exists"
		}

		// For rename, only block if trying to rename to a different existing profile
		if (!isNewProfile && nameExists && trimmed.toLowerCase() !== currentApiConfigName?.toLowerCase()) {
			return "A profile with this name already exists"
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

	// Focus input when entering rename mode
	useEffect(() => {
		if (isRenaming) {
			const timeoutId = setTimeout(() => inputRef.current?.focus(), 0)
			return () => clearTimeout(timeoutId)
		}
	}, [isRenaming])

	// Focus input when opening new dialog
	useEffect(() => {
		if (isCreating) {
			const timeoutId = setTimeout(() => newProfileInputRef.current?.focus(), 0)
			return () => clearTimeout(timeoutId)
		}
	}, [isCreating])

	// Reset state when current profile changes
	useEffect(() => {
		resetCreateState()
		resetRenameState()
	}, [currentApiConfigName])

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

		// Let the extension handle both deletion and selection
		onDeleteConfig(currentApiConfigName)
	}

	const isOnlyProfile = listApiConfigMeta?.length === 1

	return (
		<div style={{ marginBottom: 5 }}>
			<div
				style={{
					display: "flex",
					flexDirection: "column",
					gap: "2px",
				}}>
				<label htmlFor="config-profile">
					<span style={{ fontWeight: "500" }}>Configuration Profile</span>
				</label>

				{isRenaming ? (
					<div
						data-testid="rename-form"
						style={{ display: "flex", gap: "4px", alignItems: "center", flexDirection: "column" }}>
						<div style={{ display: "flex", gap: "4px", alignItems: "center", width: "100%" }}>
							<VSCodeTextField
								ref={inputRef}
								value={inputValue}
								onInput={(e: unknown) => {
									const target = e as { target: { value: string } }
									setInputValue(target.target.value)
									setError(null)
								}}
								placeholder="Enter new name"
								style={{ flexGrow: 1 }}
								onKeyDown={(e: unknown) => {
									const event = e as { key: string }
									if (event.key === "Enter" && inputValue.trim()) {
										handleSave()
									} else if (event.key === "Escape") {
										handleCancel()
									}
								}}
							/>
							<VSCodeButton
								appearance="icon"
								disabled={!inputValue.trim()}
								onClick={handleSave}
								title="Save"
								style={{
									padding: 0,
									margin: 0,
									height: "28px",
									width: "28px",
									minWidth: "28px",
								}}>
								<span className="codicon codicon-check" />
							</VSCodeButton>
							<VSCodeButton
								appearance="icon"
								onClick={handleCancel}
								title="Cancel"
								style={{
									padding: 0,
									margin: 0,
									height: "28px",
									width: "28px",
									minWidth: "28px",
								}}>
								<span className="codicon codicon-close" />
							</VSCodeButton>
						</div>
						{error && (
							<p className="text-red-500 text-sm mt-2" data-testid="error-message">
								{error}
							</p>
						)}
					</div>
				) : (
					<>
						<div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
							<Dropdown
								id="config-profile"
								value={currentApiConfigName}
								onChange={(value: unknown) => {
									onSelectConfig((value as DropdownOption).value)
								}}
								style={{
									minWidth: 130,
									zIndex: 1002,
								}}
								role="combobox"
								options={listApiConfigMeta.map((config) => ({
									value: config.name,
									label: config.name,
								}))}
							/>
							<VSCodeButton
								appearance="icon"
								onClick={handleAdd}
								title="Add profile"
								style={{
									padding: 0,
									margin: 0,
									height: "28px",
									width: "28px",
									minWidth: "28px",
								}}>
								<span className="codicon codicon-add" />
							</VSCodeButton>
							{currentApiConfigName && (
								<>
									<VSCodeButton
										appearance="icon"
										onClick={handleStartRename}
										title="Rename profile"
										style={{
											padding: 0,
											margin: 0,
											height: "28px",
											width: "28px",
											minWidth: "28px",
										}}>
										<span className="codicon codicon-edit" />
									</VSCodeButton>
									<VSCodeButton
										appearance="icon"
										onClick={handleDelete}
										title={isOnlyProfile ? "Cannot delete the only profile" : "Delete profile"}
										disabled={isOnlyProfile}
										style={{
											padding: 0,
											margin: 0,
											height: "28px",
											width: "28px",
											minWidth: "28px",
										}}>
										<span className="codicon codicon-trash" />
									</VSCodeButton>
								</>
							)}
						</div>
						<p
							style={{
								fontSize: "12px",
								margin: "5px 0 12px",
								color: "var(--vscode-descriptionForeground)",
							}}>
							Save different API configurations to quickly switch between providers and settings
						</p>
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
					<DialogContent className="p-4 max-w-sm">
						<h2 id="new-profile-title" className="text-lg font-semibold mb-4">
							New Configuration Profile
						</h2>
						<button className="absolute right-4 top-4" aria-label="Close dialog" onClick={resetCreateState}>
							<span className="codicon codicon-close" />
						</button>
						<VSCodeTextField
							ref={newProfileInputRef}
							value={newProfileName}
							onInput={(e: unknown) => {
								const target = e as { target: { value: string } }
								setNewProfileName(target.target.value)
								setError(null)
							}}
							placeholder="Enter profile name"
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
							<p className="text-red-500 text-sm mt-2" data-testid="error-message">
								{error}
							</p>
						)}
						<div className="flex justify-end gap-2 mt-4">
							<VSCodeButton appearance="secondary" onClick={resetCreateState}>
								Cancel
							</VSCodeButton>
							<VSCodeButton
								appearance="primary"
								disabled={!newProfileName.trim()}
								onClick={handleNewProfileSave}>
								Create Profile
							</VSCodeButton>
						</div>
					</DialogContent>
				</Dialog>
			</div>
		</div>
	)
}

export default memo(ApiConfigManager)
