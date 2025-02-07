import { VSCodeButton, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { memo, useEffect, useReducer, useRef } from "react"
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

type State = {
	isRenaming: boolean
	isCreating: boolean
	inputValue: string
	newProfileName: string
	error: string | null
}

type Action =
	| { type: "START_RENAME"; payload: string }
	| { type: "CANCEL_EDIT" }
	| { type: "SET_INPUT"; payload: string }
	| { type: "SET_NEW_NAME"; payload: string }
	| { type: "START_CREATE" }
	| { type: "CANCEL_CREATE" }
	| { type: "SET_ERROR"; payload: string | null }
	| { type: "RESET_STATE" }

const initialState: State = {
	isRenaming: false,
	isCreating: false,
	inputValue: "",
	newProfileName: "",
	error: null,
}

const reducer = (state: State, action: Action): State => {
	switch (action.type) {
		case "START_RENAME":
			return {
				...state,
				isRenaming: true,
				inputValue: action.payload,
				error: null,
			}
		case "CANCEL_EDIT":
			return {
				...state,
				isRenaming: false,
				inputValue: "",
				error: null,
			}
		case "SET_INPUT":
			return {
				...state,
				inputValue: action.payload,
				error: null,
			}
		case "SET_NEW_NAME":
			return {
				...state,
				newProfileName: action.payload,
				error: null,
			}
		case "START_CREATE":
			return {
				...state,
				isCreating: true,
				newProfileName: "",
				error: null,
			}
		case "CANCEL_CREATE":
			return {
				...state,
				isCreating: false,
				newProfileName: "",
				error: null,
			}
		case "SET_ERROR":
			return {
				...state,
				error: action.payload,
			}
		case "RESET_STATE":
			return initialState
		default:
			return state
	}
}

const ApiConfigManager = ({
	currentApiConfigName = "",
	listApiConfigMeta = [],
	onSelectConfig,
	onDeleteConfig,
	onRenameConfig,
	onUpsertConfig,
}: ApiConfigManagerProps) => {
	const [state, dispatch] = useReducer(reducer, initialState)
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

	// Focus input when entering rename mode
	useEffect(() => {
		if (state.isRenaming) {
			const timeoutId = setTimeout(() => inputRef.current?.focus(), 0)
			return () => clearTimeout(timeoutId)
		}
	}, [state.isRenaming])

	// Focus input when opening new dialog
	useEffect(() => {
		if (state.isCreating) {
			const timeoutId = setTimeout(() => newProfileInputRef.current?.focus(), 0)
			return () => clearTimeout(timeoutId)
		}
	}, [state.isCreating])

	// Reset state when current profile changes
	useEffect(() => {
		dispatch({ type: "RESET_STATE" })
	}, [currentApiConfigName])

	const handleAdd = () => {
		dispatch({ type: "START_CREATE" })
	}

	const handleStartRename = () => {
		dispatch({ type: "START_RENAME", payload: currentApiConfigName || "" })
	}

	const handleCancel = () => {
		dispatch({ type: "CANCEL_EDIT" })
	}

	const handleSave = () => {
		const trimmedValue = state.inputValue.trim()
		const error = validateName(trimmedValue, false)

		if (error) {
			dispatch({ type: "SET_ERROR", payload: error })
			return
		}

		if (state.isRenaming && currentApiConfigName) {
			if (currentApiConfigName === trimmedValue) {
				dispatch({ type: "CANCEL_EDIT" })
				return
			}
			onRenameConfig(currentApiConfigName, trimmedValue)
		}

		dispatch({ type: "CANCEL_EDIT" })
	}

	const handleNewProfileSave = () => {
		const trimmedValue = state.newProfileName.trim()
		const error = validateName(trimmedValue, true)

		if (error) {
			dispatch({ type: "SET_ERROR", payload: error })
			return
		}

		onUpsertConfig(trimmedValue)
		dispatch({ type: "CANCEL_CREATE" })
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

				{state.isRenaming ? (
					<div
						data-testid="rename-form"
						style={{ display: "flex", gap: "4px", alignItems: "center", flexDirection: "column" }}>
						<div style={{ display: "flex", gap: "4px", alignItems: "center", width: "100%" }}>
							<VSCodeTextField
								ref={inputRef}
								value={state.inputValue}
								onInput={(e: unknown) => {
									const target = e as { target: { value: string } }
									dispatch({ type: "SET_INPUT", payload: target.target.value })
								}}
								placeholder="Enter new name"
								style={{ flexGrow: 1 }}
								onKeyDown={(e: unknown) => {
									const event = e as { key: string }
									if (event.key === "Enter" && state.inputValue.trim()) {
										handleSave()
									} else if (event.key === "Escape") {
										handleCancel()
									}
								}}
							/>
							<VSCodeButton
								appearance="icon"
								disabled={!state.inputValue.trim()}
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
						{state.error && (
							<p className="text-red-500 text-sm mt-2" data-testid="error-message">
								{state.error}
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
					open={state.isCreating}
					onOpenChange={(open: boolean) => dispatch({ type: open ? "START_CREATE" : "CANCEL_CREATE" })}
					aria-labelledby="new-profile-title">
					<DialogContent className="p-4 max-w-sm">
						<h2 id="new-profile-title" className="text-lg font-semibold mb-4">
							New Configuration Profile
						</h2>
						<button
							className="absolute right-4 top-4"
							aria-label="Close dialog"
							onClick={() => dispatch({ type: "CANCEL_CREATE" })}>
							<span className="codicon codicon-close" />
						</button>
						<VSCodeTextField
							ref={newProfileInputRef}
							value={state.newProfileName}
							onInput={(e: unknown) => {
								const target = e as { target: { value: string } }
								dispatch({ type: "SET_NEW_NAME", payload: target.target.value })
							}}
							placeholder="Enter profile name"
							style={{ width: "100%" }}
							onKeyDown={(e: unknown) => {
								const event = e as { key: string }
								if (event.key === "Enter" && state.newProfileName.trim()) {
									handleNewProfileSave()
								} else if (event.key === "Escape") {
									dispatch({ type: "CANCEL_CREATE" })
								}
							}}
						/>
						{state.error && (
							<p className="text-red-500 text-sm mt-2" data-testid="error-message">
								{state.error}
							</p>
						)}
						<div className="flex justify-end gap-2 mt-4">
							<VSCodeButton appearance="secondary" onClick={() => dispatch({ type: "CANCEL_CREATE" })}>
								Cancel
							</VSCodeButton>
							<VSCodeButton
								appearance="primary"
								disabled={!state.newProfileName.trim()}
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
