import { memo, useEffect, useRef, useState } from "react"
import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { ChevronsUpDown, Check, X } from "lucide-react"

import { ApiConfigMeta } from "../../../../src/shared/ExtensionMessage"

import { useAppTranslation } from "@/i18n/TranslationContext"
import { cn } from "@/lib/utils"
import {
	Button,
	Input,
	Dialog,
	DialogContent,
	DialogTitle,
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui"

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
	const { t } = useAppTranslation()

	const [isRenaming, setIsRenaming] = useState(false)
	const [isCreating, setIsCreating] = useState(false)
	const [inputValue, setInputValue] = useState("")
	const [newProfileName, setNewProfileName] = useState("")
	const [error, setError] = useState<string | null>(null)
	const [open, setOpen] = useState(false)
	const [searchValue, setSearchValue] = useState("")
	const inputRef = useRef<any>(null)
	const newProfileInputRef = useRef<any>(null)
	const searchInputRef = useRef<HTMLInputElement>(null)

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
		// Reset search value when current profile changes
		setTimeout(() => setSearchValue(""), 100)
	}, [currentApiConfigName])

	const onOpenChange = (open: boolean) => {
		setOpen(open)

		// Reset search when closing the popover
		if (!open) {
			setTimeout(() => setSearchValue(""), 100)
		}
	}

	const onClearSearch = () => {
		setSearchValue("")
		searchInputRef.current?.focus()
	}

	const handleSelectConfig = (configName: string) => {
		if (!configName) return

		setOpen(false)
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
						<Button
							variant="ghost"
							size="icon"
							disabled={!inputValue.trim()}
							onClick={handleSave}
							title={t("settings:common.save")}
							data-testid="save-rename-button">
							<span className="codicon codicon-check" />
						</Button>
						<Button
							variant="ghost"
							size="icon"
							onClick={handleCancel}
							title={t("settings:common.cancel")}
							data-testid="cancel-rename-button">
							<span className="codicon codicon-close" />
						</Button>
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
						<Popover open={open} onOpenChange={onOpenChange}>
							<PopoverTrigger asChild>
								<Button
									variant="combobox"
									role="combobox"
									aria-expanded={open}
									className="grow justify-between"
									// Use select-component data-testid for test compatibility
									data-testid="select-component">
									<div>{currentApiConfigName || t("settings:common.select")}</div>
									<ChevronsUpDown className="opacity-50" />
								</Button>
							</PopoverTrigger>
							<PopoverContent className="p-0 w-[var(--radix-popover-trigger-width)]">
								<Command>
									<div className="relative">
										<CommandInput
											ref={searchInputRef}
											value={searchValue}
											onValueChange={setSearchValue}
											placeholder={t("settings:providers.searchPlaceholder")}
											className="h-9 mr-4"
											data-testid="profile-search-input"
										/>
										{searchValue.length > 0 && (
											<div className="absolute right-2 top-0 bottom-0 flex items-center justify-center">
												<X
													className="text-vscode-input-foreground opacity-50 hover:opacity-100 size-4 p-0.5 cursor-pointer"
													onClick={onClearSearch}
												/>
											</div>
										)}
									</div>
									<CommandList>
										<CommandEmpty>
											{searchValue && (
												<div className="py-2 px-1 text-sm">
													{t("settings:providers.noMatchFound")}
												</div>
											)}
										</CommandEmpty>
										<CommandGroup>
											{listApiConfigMeta
												.filter((config) =>
													searchValue
														? config.name.toLowerCase().includes(searchValue.toLowerCase())
														: true,
												)
												.map((config) => (
													<CommandItem
														key={config.name}
														value={config.name}
														onSelect={handleSelectConfig}
														data-testid={`profile-option-${config.name}`}>
														{config.name}
														<Check
															className={cn(
																"size-4 p-0.5 ml-auto",
																config.name === currentApiConfigName
																	? "opacity-100"
																	: "opacity-0",
															)}
														/>
													</CommandItem>
												))}
										</CommandGroup>
									</CommandList>
								</Command>
							</PopoverContent>
						</Popover>
						<Button
							variant="ghost"
							size="icon"
							onClick={handleAdd}
							title={t("settings:providers.addProfile")}
							data-testid="add-profile-button">
							<span className="codicon codicon-add" />
						</Button>
						{currentApiConfigName && (
							<>
								<Button
									variant="ghost"
									size="icon"
									onClick={handleStartRename}
									title={t("settings:providers.renameProfile")}
									data-testid="rename-profile-button">
									<span className="codicon codicon-edit" />
								</Button>
								<Button
									variant="ghost"
									size="icon"
									onClick={handleDelete}
									title={
										isOnlyProfile
											? t("settings:providers.cannotDeleteOnlyProfile")
											: t("settings:providers.deleteProfile")
									}
									data-testid="delete-profile-button"
									disabled={isOnlyProfile}>
									<span className="codicon codicon-trash" />
								</Button>
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
						<p className="text-red-500 text-sm mt-2" data-testid="error-message">
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
