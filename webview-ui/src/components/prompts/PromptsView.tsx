import React, { useState, useEffect, useMemo, useCallback, useRef } from "react"
import { Button } from "@/components/ui/button"
import { VSCodeCheckbox, VSCodeRadioGroup, VSCodeRadio, VSCodeTextArea } from "@vscode/webview-ui-toolkit/react"

import { useExtensionState } from "@src/context/ExtensionStateContext"
import {
	Mode,
	PromptComponent,
	getRoleDefinition,
	getWhenToUse,
	getCustomInstructions,
	getAllModes,
	ModeConfig,
	GroupEntry,
} from "@roo/shared/modes"
import { modeConfigSchema } from "@roo/schemas"
import { supportPrompt, SupportPromptType } from "@roo/shared/support-prompt"

import { TOOL_GROUPS, ToolGroup } from "@roo/shared/tools"
import { vscode } from "@src/utils/vscode"
import { Tab, TabContent, TabHeader } from "../common/Tab"
import i18next from "i18next"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { Trans } from "react-i18next"
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
	Popover,
	PopoverContent,
	PopoverTrigger,
	Command,
	CommandInput,
	CommandList,
	CommandEmpty,
	CommandItem,
	CommandGroup,
	Input,
} from "../ui"
import { ChevronsUpDown, X } from "lucide-react"

// Get all available groups that should show in prompts view
const availableGroups = (Object.keys(TOOL_GROUPS) as ToolGroup[]).filter((group) => !TOOL_GROUPS[group].alwaysAvailable)

type ModeSource = "global" | "project"

type PromptsViewProps = {
	onDone: () => void
}

// Helper to get group name regardless of format
function getGroupName(group: GroupEntry): ToolGroup {
	return Array.isArray(group) ? group[0] : group
}

const PromptsView = ({ onDone }: PromptsViewProps) => {
	const { t } = useAppTranslation()

	const {
		customModePrompts,
		customSupportPrompts,
		listApiConfigMeta,
		currentApiConfigName,
		enhancementApiConfigId,
		setEnhancementApiConfigId,
		mode,
		customInstructions,
		setCustomInstructions,
		customModes,
	} = useExtensionState()

	// Use a local state to track the visually active mode
	// This prevents flickering when switching modes rapidly by:
	// 1. Updating the UI immediately when a mode is clicked
	// 2. Not syncing with the backend mode state (which would cause flickering)
	// 3. Still sending the mode change to the backend for persistence
	const [visualMode, setVisualMode] = useState(mode)

	// Memoize modes to preserve array order
	const modes = useMemo(() => getAllModes(customModes), [customModes])

	const [testPrompt, setTestPrompt] = useState("")
	const [isEnhancing, setIsEnhancing] = useState(false)
	const [isDialogOpen, setIsDialogOpen] = useState(false)
	const [selectedPromptContent, setSelectedPromptContent] = useState("")
	const [selectedPromptTitle, setSelectedPromptTitle] = useState("")
	const [isToolsEditMode, setIsToolsEditMode] = useState(false)
	const [showConfigMenu, setShowConfigMenu] = useState(false)
	const [isCreateModeDialogOpen, setIsCreateModeDialogOpen] = useState(false)
	const [activeSupportOption, setActiveSupportOption] = useState<SupportPromptType>("ENHANCE")
	const [isSystemPromptDisclosureOpen, setIsSystemPromptDisclosureOpen] = useState(false)

	// State for mode selection popover and search
	const [open, setOpen] = useState(false)
	const [searchValue, setSearchValue] = useState("")
	const searchInputRef = useRef<HTMLInputElement>(null)

	// Direct update functions
	const updateAgentPrompt = useCallback(
		(mode: Mode, promptData: PromptComponent) => {
			const existingPrompt = customModePrompts?.[mode] as PromptComponent
			const updatedPrompt = { ...existingPrompt, ...promptData }

			// Only include properties that differ from defaults
			if (updatedPrompt.roleDefinition === getRoleDefinition(mode)) {
				delete updatedPrompt.roleDefinition
			}
			if (updatedPrompt.whenToUse === getWhenToUse(mode)) {
				delete updatedPrompt.whenToUse
			}

			vscode.postMessage({
				type: "updatePrompt",
				promptMode: mode,
				customPrompt: updatedPrompt,
			})
		},
		[customModePrompts],
	)

	const updateCustomMode = useCallback((slug: string, modeConfig: ModeConfig) => {
		const source = modeConfig.source || "global"
		vscode.postMessage({
			type: "updateCustomMode",
			slug,
			modeConfig: {
				...modeConfig,
				source, // Ensure source is set
			},
		})
	}, [])

	// Helper function to find a mode by slug
	const findModeBySlug = useCallback(
		(searchSlug: string, modes: readonly ModeConfig[] | undefined): ModeConfig | undefined => {
			if (!modes) return undefined
			const isModeWithSlug = (mode: ModeConfig): mode is ModeConfig => mode.slug === searchSlug
			return modes.find(isModeWithSlug)
		},
		[],
	)

	const switchMode = useCallback((slug: string) => {
		vscode.postMessage({
			type: "mode",
			text: slug,
		})
	}, [])

	// Handle mode switching with explicit state initialization
	const handleModeSwitch = useCallback(
		(modeConfig: ModeConfig) => {
			if (modeConfig.slug === visualMode) return // Prevent unnecessary updates

			// Immediately update visual state for instant feedback
			setVisualMode(modeConfig.slug)

			// Then send the mode change message to the backend
			switchMode(modeConfig.slug)

			// Exit tools edit mode when switching modes
			setIsToolsEditMode(false)
		},
		[visualMode, switchMode],
	)

	// Handler for popover open state change
	const onOpenChange = useCallback((open: boolean) => {
		setOpen(open)
		// Reset search when closing the popover
		if (!open) {
			setTimeout(() => setSearchValue(""), 100)
		}
	}, [])

	// Handler for clearing search input
	const onClearSearch = useCallback(() => {
		setSearchValue("")
		searchInputRef.current?.focus()
	}, [])

	// Helper function to get current mode's config
	const getCurrentMode = useCallback((): ModeConfig | undefined => {
		const findMode = (m: ModeConfig): boolean => m.slug === visualMode
		return customModes?.find(findMode) || modes.find(findMode)
	}, [visualMode, customModes, modes])

	// Helper function to safely access mode properties
	const getModeProperty = <T extends keyof ModeConfig>(
		mode: ModeConfig | undefined,
		property: T,
	): ModeConfig[T] | undefined => {
		return mode?.[property]
	}

	// State for create mode dialog
	const [newModeName, setNewModeName] = useState("")
	const [newModeSlug, setNewModeSlug] = useState("")
	const [newModeRoleDefinition, setNewModeRoleDefinition] = useState("")
	const [newModeWhenToUse, setNewModeWhenToUse] = useState("")
	const [newModeCustomInstructions, setNewModeCustomInstructions] = useState("")
	const [newModeGroups, setNewModeGroups] = useState<GroupEntry[]>(availableGroups)
	const [newModeSource, setNewModeSource] = useState<ModeSource>("global")

	// Field-specific error states
	const [nameError, setNameError] = useState<string>("")
	const [slugError, setSlugError] = useState<string>("")
	const [roleDefinitionError, setRoleDefinitionError] = useState<string>("")
	const [groupsError, setGroupsError] = useState<string>("")

	// Helper to reset form state
	const resetFormState = useCallback(() => {
		// Reset form fields
		setNewModeName("")
		setNewModeSlug("")
		setNewModeGroups(availableGroups)
		setNewModeRoleDefinition("")
		setNewModeWhenToUse("")
		setNewModeCustomInstructions("")
		setNewModeSource("global")
		// Reset error states
		setNameError("")
		setSlugError("")
		setRoleDefinitionError("")
		setGroupsError("")
	}, [])

	// Reset form fields when dialog opens
	useEffect(() => {
		if (isCreateModeDialogOpen) {
			resetFormState()
		}
	}, [isCreateModeDialogOpen, resetFormState])

	// Helper function to generate a unique slug from a name
	const generateSlug = useCallback((name: string, attempt = 0): string => {
		const baseSlug = name
			.toLowerCase()
			.replace(/[^a-z0-9-]+/g, "-")
			.replace(/^-+|-+$/g, "")
		return attempt === 0 ? baseSlug : `${baseSlug}-${attempt}`
	}, [])

	// Handler for name changes
	const handleNameChange = useCallback(
		(name: string) => {
			setNewModeName(name)
			setNewModeSlug(generateSlug(name))
		},
		[generateSlug],
	)

	const handleCreateMode = useCallback(() => {
		// Clear previous errors
		setNameError("")
		setSlugError("")
		setRoleDefinitionError("")
		setGroupsError("")

		const source = newModeSource
		const newMode: ModeConfig = {
			slug: newModeSlug,
			name: newModeName,
			roleDefinition: newModeRoleDefinition.trim(),
			whenToUse: newModeWhenToUse.trim() || undefined,
			customInstructions: newModeCustomInstructions.trim() || undefined,
			groups: newModeGroups,
			source,
		}

		// Validate the mode against the schema
		const result = modeConfigSchema.safeParse(newMode)

		if (!result.success) {
			// Map Zod errors to specific fields
			result.error.errors.forEach((error) => {
				const field = error.path[0] as string
				const message = error.message

				switch (field) {
					case "name":
						setNameError(message)
						break
					case "slug":
						setSlugError(message)
						break
					case "roleDefinition":
						setRoleDefinitionError(message)
						break
					case "groups":
						setGroupsError(message)
						break
				}
			})
			return
		}

		updateCustomMode(newModeSlug, newMode)
		switchMode(newModeSlug)
		setIsCreateModeDialogOpen(false)
		resetFormState()
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [
		newModeName,
		newModeSlug,
		newModeRoleDefinition,
		newModeWhenToUse, // Add whenToUse dependency
		newModeCustomInstructions,
		newModeGroups,
		newModeSource,
		updateCustomMode,
	])

	const isNameOrSlugTaken = useCallback(
		(name: string, slug: string) => {
			return modes.some((m) => m.slug === slug || m.name === name)
		},
		[modes],
	)

	const openCreateModeDialog = useCallback(() => {
		const baseNamePrefix = "New Custom Mode"
		// Find unique name and slug
		let attempt = 0
		let name = baseNamePrefix
		let slug = generateSlug(name)
		while (isNameOrSlugTaken(name, slug)) {
			attempt++
			name = `${baseNamePrefix} ${attempt + 1}`
			slug = generateSlug(name)
		}
		setNewModeName(name)
		setNewModeSlug(slug)
		setIsCreateModeDialogOpen(true)
	}, [generateSlug, isNameOrSlugTaken])

	// Handler for group checkbox changes
	const handleGroupChange = useCallback(
		(group: ToolGroup, isCustomMode: boolean, customMode: ModeConfig | undefined) =>
			(e: Event | React.FormEvent<HTMLElement>) => {
				if (!isCustomMode) return // Prevent changes to built-in modes
				const target = (e as CustomEvent)?.detail?.target || (e.target as HTMLInputElement)
				const checked = target.checked
				const oldGroups = customMode?.groups || []
				let newGroups: GroupEntry[]
				if (checked) {
					newGroups = [...oldGroups, group]
				} else {
					newGroups = oldGroups.filter((g) => getGroupName(g) !== group)
				}
				if (customMode) {
					const source = customMode.source || "global"
					updateCustomMode(customMode.slug, {
						...customMode,
						groups: newGroups,
						source,
					})
				}
			},
		[updateCustomMode],
	)

	// Handle clicks outside the config menu
	useEffect(() => {
		const handleClickOutside = () => {
			if (showConfigMenu) {
				setShowConfigMenu(false)
			}
		}

		document.addEventListener("click", handleClickOutside)
		return () => document.removeEventListener("click", handleClickOutside)
	}, [showConfigMenu])

	useEffect(() => {
		const handler = (event: MessageEvent) => {
			const message = event.data
			if (message.type === "enhancedPrompt") {
				if (message.text) {
					setTestPrompt(message.text)
				}
				setIsEnhancing(false)
			} else if (message.type === "systemPrompt") {
				if (message.text) {
					setSelectedPromptContent(message.text)
					setSelectedPromptTitle(`System Prompt (${message.mode} mode)`)
					setIsDialogOpen(true)
				}
			}
		}

		window.addEventListener("message", handler)
		return () => window.removeEventListener("message", handler)
	}, [])

	const updateSupportPrompt = (type: SupportPromptType, value: string | undefined) => {
		vscode.postMessage({
			type: "updateSupportPrompt",
			values: {
				[type]: value,
			},
		})
	}

	const handleAgentReset = (modeSlug: string, type: "roleDefinition" | "whenToUse" | "customInstructions") => {
		// Only reset for built-in modes
		const existingPrompt = customModePrompts?.[modeSlug] as PromptComponent
		const updatedPrompt = { ...existingPrompt }
		delete updatedPrompt[type] // Remove the field entirely to ensure it reloads from defaults

		vscode.postMessage({
			type: "updatePrompt",
			promptMode: modeSlug,
			customPrompt: updatedPrompt,
		})
	}

	const handleSupportReset = (type: SupportPromptType) => {
		vscode.postMessage({
			type: "resetSupportPrompt",
			text: type,
		})
	}

	const getSupportPromptValue = (type: SupportPromptType): string => {
		return supportPrompt.get(customSupportPrompts, type)
	}

	const handleTestEnhancement = () => {
		if (!testPrompt.trim()) return

		setIsEnhancing(true)
		vscode.postMessage({
			type: "enhancePrompt",
			text: testPrompt,
		})
	}

	return (
		<Tab>
			<TabHeader className="flex justify-between items-center">
				<h3 className="text-vscode-foreground m-0">{t("prompts:title")}</h3>
				<Button onClick={onDone}>{t("prompts:done")}</Button>
			</TabHeader>

			<TabContent>
				<div>
					<div onClick={(e) => e.stopPropagation()} className="flex justify-between items-center mb-3">
						<h3 className="text-vscode-foreground m-0">{t("prompts:modes.title")}</h3>
						<div className="flex gap-2">
							<Button
								variant="ghost"
								size="icon"
								onClick={openCreateModeDialog}
								title={t("prompts:modes.createNewMode")}>
								<span className="codicon codicon-add"></span>
							</Button>
							<div className="relative inline-block">
								<Button
									variant="ghost"
									size="icon"
									title={t("prompts:modes.editModesConfig")}
									className="flex"
									onClick={(e: React.MouseEvent) => {
										e.preventDefault()
										e.stopPropagation()
										setShowConfigMenu((prev) => !prev)
									}}
									onBlur={() => {
										// Add slight delay to allow menu item clicks to register
										setTimeout(() => setShowConfigMenu(false), 200)
									}}>
									<span className="codicon codicon-json"></span>
								</Button>
								{showConfigMenu && (
									<div
										onClick={(e) => e.stopPropagation()}
										onMouseDown={(e) => e.stopPropagation()}
										className="absolute top-full right-0 w-[200px] mt-1 bg-vscode-editor-background border border-vscode-input-border rounded shadow-md z-[1000]">
										<div
											className="p-2 cursor-pointer text-vscode-foreground text-sm"
											onMouseDown={(e) => {
												e.preventDefault() // Prevent blur
												vscode.postMessage({
													type: "openCustomModesSettings",
												})
												setShowConfigMenu(false)
											}}
											onClick={(e) => e.preventDefault()}>
											{t("prompts:modes.editGlobalModes")}
										</div>
										<div
											className="p-2 cursor-pointer text-vscode-foreground text-sm border-t border-vscode-input-border"
											onMouseDown={(e) => {
												e.preventDefault() // Prevent blur
												vscode.postMessage({
													type: "openFile",
													text: "./.roomodes",
													values: {
														create: true,
														content: JSON.stringify({ customModes: [] }, null, 2),
													},
												})
												setShowConfigMenu(false)
											}}
											onClick={(e) => e.preventDefault()}>
											{t("prompts:modes.editProjectModes")}
										</div>
									</div>
								)}
							</div>
						</div>
					</div>

					<div className="text-sm text-vscode-descriptionForeground mb-3">
						{t("prompts:modes.createModeHelpText")}
					</div>

					<div className="flex items-center gap-1 mb-3">
						<Popover open={open} onOpenChange={onOpenChange}>
							<PopoverTrigger asChild>
								<Button
									variant="combobox"
									role="combobox"
									aria-expanded={open}
									className="grow justify-between"
									data-testid="mode-select-trigger">
									<div>{getCurrentMode()?.name || t("prompts:modes.selectMode")}</div>
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
											placeholder={t("prompts:modes.selectMode")}
											className="h-9 mr-4"
											data-testid="mode-search-input"
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
													{t("prompts:modes.noMatchFound")}
												</div>
											)}
										</CommandEmpty>
										<CommandGroup>
											{modes
												.filter((modeConfig) =>
													searchValue
														? modeConfig.name
																.toLowerCase()
																.includes(searchValue.toLowerCase())
														: true,
												)
												.map((modeConfig) => (
													<CommandItem
														key={modeConfig.slug}
														value={modeConfig.slug}
														onSelect={() => {
															handleModeSwitch(modeConfig)
															setOpen(false)
														}}
														data-testid={`mode-option-${modeConfig.slug}`}>
														<div className="flex items-center justify-between w-full">
															<span
																style={{
																	whiteSpace: "nowrap",
																	overflow: "hidden",
																	textOverflow: "ellipsis",
																	flex: 2,
																	minWidth: 0,
																}}>
																{modeConfig.name}
															</span>
															<span
																className="text-foreground"
																style={{
																	whiteSpace: "nowrap",
																	overflow: "hidden",
																	textOverflow: "ellipsis",
																	direction: "rtl",
																	textAlign: "right",
																	flex: 1,
																	minWidth: 0,
																	marginLeft: "0.5em",
																}}>
																{modeConfig.slug}
															</span>
														</div>
													</CommandItem>
												))}
										</CommandGroup>
									</CommandList>
								</Command>
							</PopoverContent>
						</Popover>
					</div>
				</div>

				<div className="mb-5">
					{/* Only show name and delete for custom modes */}
					{visualMode && findModeBySlug(visualMode, customModes) && (
						<div className="flex gap-3 mb-4">
							<div className="flex-1">
								<div className="font-bold mb-1">{t("prompts:createModeDialog.name.label")}</div>
								<div className="flex gap-2">
									<Input
										type="text"
										value={getModeProperty(findModeBySlug(visualMode, customModes), "name") ?? ""}
										onChange={(e) => {
											const customMode = findModeBySlug(visualMode, customModes)
											if (customMode) {
												updateCustomMode(visualMode, {
													...customMode,
													name: e.target.value,
													source: customMode.source || "global",
												})
											}
										}}
										className="w-full"
									/>
									<Button
										variant="ghost"
										size="icon"
										title={t("prompts:createModeDialog.deleteMode")}
										onClick={() => {
											vscode.postMessage({
												type: "deleteCustomMode",
												slug: visualMode,
											})
										}}>
										<span className="codicon codicon-trash"></span>
									</Button>
								</div>
							</div>
						</div>
					)}
					<div className="mb-4">
						<div className="flex justify-between items-center mb-1">
							<div className="font-bold">{t("prompts:roleDefinition.title")}</div>
							{!findModeBySlug(visualMode, customModes) && (
								<Button
									variant="ghost"
									size="icon"
									onClick={() => {
										const currentMode = getCurrentMode()
										if (currentMode?.slug) {
											handleAgentReset(currentMode.slug, "roleDefinition")
										}
									}}
									title={t("prompts:roleDefinition.resetToDefault")}
									data-testid="role-definition-reset">
									<span className="codicon codicon-discard"></span>
								</Button>
							)}
						</div>
						<div className="text-sm text-vscode-descriptionForeground mb-2">
							{t("prompts:roleDefinition.description")}
						</div>
						<VSCodeTextArea
							value={(() => {
								const customMode = findModeBySlug(visualMode, customModes)
								const prompt = customModePrompts?.[visualMode] as PromptComponent
								return (
									customMode?.roleDefinition ??
									prompt?.roleDefinition ??
									getRoleDefinition(visualMode)
								)
							})()}
							onChange={(e) => {
								const value =
									(e as unknown as CustomEvent)?.detail?.target?.value ||
									((e as any).target as HTMLTextAreaElement).value
								const customMode = findModeBySlug(visualMode, customModes)
								if (customMode) {
									// For custom modes, update the JSON file
									updateCustomMode(visualMode, {
										...customMode,
										roleDefinition: value.trim() || "",
										source: customMode.source || "global",
									})
								} else {
									// For built-in modes, update the prompts
									updateAgentPrompt(visualMode, {
										roleDefinition: value.trim() || undefined,
									})
								}
							}}
							className="resize-y w-full"
							rows={4}
							data-testid={`${getCurrentMode()?.slug || "code"}-prompt-textarea`}
						/>
					</div>

					{/* When to Use section */}
					<div className="mb-4">
						<div className="flex justify-between items-center mb-1">
							<div className="font-bold">{t("prompts:whenToUse.title")}</div>
							{!findModeBySlug(visualMode, customModes) && (
								<Button
									variant="ghost"
									size="icon"
									onClick={() => {
										const currentMode = getCurrentMode()
										if (currentMode?.slug) {
											handleAgentReset(currentMode.slug, "whenToUse")
										}
									}}
									title={t("prompts:whenToUse.resetToDefault")}
									data-testid="when-to-use-reset">
									<span className="codicon codicon-discard"></span>
								</Button>
							)}
						</div>
						<div className="text-sm text-vscode-descriptionForeground mb-2">
							{t("prompts:whenToUse.description")}
						</div>
						<VSCodeTextArea
							value={(() => {
								const customMode = findModeBySlug(visualMode, customModes)
								const prompt = customModePrompts?.[visualMode] as PromptComponent
								return customMode?.whenToUse ?? prompt?.whenToUse ?? getWhenToUse(visualMode)
							})()}
							onChange={(e) => {
								const value =
									(e as unknown as CustomEvent)?.detail?.target?.value ||
									((e as any).target as HTMLTextAreaElement).value
								const customMode = findModeBySlug(visualMode, customModes)
								if (customMode) {
									// For custom modes, update the JSON file
									updateCustomMode(visualMode, {
										...customMode,
										whenToUse: value.trim() || undefined,
										source: customMode.source || "global",
									})
								} else {
									// For built-in modes, update the prompts
									updateAgentPrompt(visualMode, {
										whenToUse: value.trim() || undefined,
									})
								}
							}}
							className="resize-y w-full"
							rows={3}
							data-testid={`${getCurrentMode()?.slug || "code"}-when-to-use-textarea`}
						/>
					</div>

					{/* Mode settings */}
					<>
						<div className="mb-3">
							<div className="font-bold mb-1">{t("prompts:apiConfiguration.title")}</div>
							<div className="mb-2">
								<Select
									value={currentApiConfigName}
									onValueChange={(value) => {
										vscode.postMessage({
											type: "loadApiConfiguration",
											text: value,
										})
									}}>
									<SelectTrigger className="w-full">
										<SelectValue placeholder={t("settings:common.select")} />
									</SelectTrigger>
									<SelectContent>
										{(listApiConfigMeta || []).map((config) => (
											<SelectItem key={config.id} value={config.name}>
												{config.name}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
								<div className="text-xs mt-1.5 text-vscode-descriptionForeground">
									{t("prompts:apiConfiguration.select")}
								</div>
							</div>
						</div>

						{/* Show tools for all modes */}
						<div className="mb-4">
							<div className="flex justify-between items-center mb-1">
								<div className="font-bold">{t("prompts:tools.title")}</div>
								{findModeBySlug(visualMode, customModes) && (
									<Button
										variant="ghost"
										size="icon"
										onClick={() => setIsToolsEditMode(!isToolsEditMode)}
										title={
											isToolsEditMode
												? t("prompts:tools.doneEditing")
												: t("prompts:tools.editTools")
										}>
										<span
											className={`codicon codicon-${isToolsEditMode ? "check" : "edit"}`}></span>
									</Button>
								)}
							</div>
							{!findModeBySlug(visualMode, customModes) && (
								<div className="text-sm text-vscode-descriptionForeground mb-2">
									{t("prompts:tools.builtInModesText")}
								</div>
							)}
							{isToolsEditMode && findModeBySlug(visualMode, customModes) ? (
								<div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-2">
									{availableGroups.map((group) => {
										const currentMode = getCurrentMode()
										const isCustomMode = findModeBySlug(visualMode, customModes)
										const customMode = isCustomMode
										const isGroupEnabled = isCustomMode
											? customMode?.groups?.some((g) => getGroupName(g) === group)
											: currentMode?.groups?.some((g) => getGroupName(g) === group)

										return (
											<VSCodeCheckbox
												key={group}
												checked={isGroupEnabled}
												onChange={handleGroupChange(group, Boolean(isCustomMode), customMode)}
												disabled={!isCustomMode}>
												{t(`prompts:tools.toolNames.${group}`)}
												{group === "edit" && (
													<div className="text-xs text-vscode-descriptionForeground mt-0.5">
														{t("prompts:tools.allowedFiles")}{" "}
														{(() => {
															const currentMode = getCurrentMode()
															const editGroup = currentMode?.groups?.find(
																(g) =>
																	Array.isArray(g) &&
																	g[0] === "edit" &&
																	g[1]?.fileRegex,
															)
															if (!Array.isArray(editGroup)) return t("prompts:allFiles")
															return (
																editGroup[1].description ||
																`/${editGroup[1].fileRegex}/`
															)
														})()}
													</div>
												)}
											</VSCodeCheckbox>
										)
									})}
								</div>
							) : (
								<div className="text-sm text-vscode-foreground mb-2 leading-relaxed">
									{(() => {
										const currentMode = getCurrentMode()
										const enabledGroups = currentMode?.groups || []

										// If there are no enabled groups, display translated "None"
										if (enabledGroups.length === 0) {
											return t("prompts:tools.noTools")
										}

										return enabledGroups
											.map((group) => {
												const groupName = getGroupName(group)
												const displayName = t(`prompts:tools.toolNames.${groupName}`)
												if (Array.isArray(group) && group[1]?.fileRegex) {
													const description =
														group[1].description || `/${group[1].fileRegex}/`
													return `${displayName} (${description})`
												}
												return displayName
											})
											.join(", ")
									})()}
								</div>
							)}
						</div>
					</>

					{/* Role definition for both built-in and custom modes */}
					<div className="mb-2">
						<div className="flex justify-between items-center mb-1">
							<div className="font-bold">{t("prompts:customInstructions.title")}</div>
							{!findModeBySlug(visualMode, customModes) && (
								<Button
									variant="ghost"
									size="icon"
									onClick={() => {
										const currentMode = getCurrentMode()
										if (currentMode?.slug) {
											handleAgentReset(currentMode.slug, "customInstructions")
										}
									}}
									title={t("prompts:customInstructions.resetToDefault")}
									data-testid="custom-instructions-reset">
									<span className="codicon codicon-discard"></span>
								</Button>
							)}
						</div>
						<div className="text-[13px] text-vscode-descriptionForeground mb-2">
							{t("prompts:customInstructions.description", {
								modeName: getCurrentMode()?.name || "Code",
							})}
						</div>
						<VSCodeTextArea
							value={(() => {
								const customMode = findModeBySlug(visualMode, customModes)
								const prompt = customModePrompts?.[visualMode] as PromptComponent
								return (
									customMode?.customInstructions ??
									prompt?.customInstructions ??
									getCustomInstructions(mode, customModes)
								)
							})()}
							onChange={(e) => {
								const value =
									(e as unknown as CustomEvent)?.detail?.target?.value ||
									((e as any).target as HTMLTextAreaElement).value
								const customMode = findModeBySlug(visualMode, customModes)
								if (customMode) {
									// For custom modes, update the JSON file
									updateCustomMode(visualMode, {
										...customMode,
										customInstructions: value.trim() || undefined,
										source: customMode.source || "global",
									})
								} else {
									// For built-in modes, update the prompts
									const existingPrompt = customModePrompts?.[visualMode] as PromptComponent
									updateAgentPrompt(visualMode, {
										...existingPrompt,
										customInstructions: value.trim(),
									})
								}
							}}
							rows={4}
							className="w-full resize-y"
							data-testid={`${getCurrentMode()?.slug || "code"}-custom-instructions-textarea`}
						/>
						<div className="text-xs text-vscode-descriptionForeground mt-1.5">
							<Trans
								i18nKey="prompts:customInstructions.loadFromFile"
								values={{
									mode: getCurrentMode()?.name || "Code",
									slug: getCurrentMode()?.slug || "code",
								}}
								components={{
									span: (
										<span
											className="text-vscode-textLink-foreground cursor-pointer underline"
											onClick={() => {
												const currentMode = getCurrentMode()
												if (!currentMode) return

												// Open or create an empty file
												vscode.postMessage({
													type: "openFile",
													text: `./.roo/rules-${currentMode.slug}/rules.md`,
													values: {
														create: true,
														content: "",
													},
												})
											}}
										/>
									),
								}}
							/>
						</div>
					</div>
				</div>

				<div className="pb-4 border-b border-vscode-input-border">
					<div className="flex gap-2">
						<Button
							variant="default"
							onClick={() => {
								const currentMode = getCurrentMode()
								if (currentMode) {
									vscode.postMessage({
										type: "getSystemPrompt",
										mode: currentMode.slug,
									})
								}
							}}
							data-testid="preview-prompt-button">
							{t("prompts:systemPrompt.preview")}
						</Button>
						<Button
							variant="ghost"
							size="icon"
							title={t("prompts:systemPrompt.copy")}
							onClick={() => {
								const currentMode = getCurrentMode()
								if (currentMode) {
									vscode.postMessage({
										type: "copySystemPrompt",
										mode: currentMode.slug,
									})
								}
							}}
							data-testid="copy-prompt-button">
							<span className="codicon codicon-copy"></span>
						</Button>
					</div>

					{/* Custom System Prompt Disclosure */}
					<div className="mt-4">
						<button
							onClick={() => setIsSystemPromptDisclosureOpen(!isSystemPromptDisclosureOpen)}
							className="flex items-center text-xs text-vscode-foreground hover:text-vscode-textLink-foreground focus:outline-none"
							aria-expanded={isSystemPromptDisclosureOpen}>
							<span
								className={`codicon codicon-${isSystemPromptDisclosureOpen ? "chevron-down" : "chevron-right"} mr-1`}></span>
							<span>{t("prompts:advancedSystemPrompt.title")}</span>
						</button>

						{isSystemPromptDisclosureOpen && (
							<div className="text-xs text-vscode-descriptionForeground mt-2 ml-5">
								<Trans
									i18nKey="prompts:advancedSystemPrompt.description"
									values={{
										slug: getCurrentMode()?.slug || "code",
									}}
									components={{
										span: (
											<span
												className="text-vscode-textLink-foreground cursor-pointer underline"
												onClick={() => {
													const currentMode = getCurrentMode()
													if (!currentMode) return

													vscode.postMessage({
														type: "openFile",
														text: `./.roo/system-prompt-${currentMode.slug}`,
														values: {
															create: true,
															content: "",
														},
													})
												}}
											/>
										),
									}}
								/>
							</div>
						)}
					</div>
				</div>

				<div className="pb-5 border-b border-vscode-input-border">
					<h3 className="text-vscode-foreground mb-3">{t("prompts:globalCustomInstructions.title")}</h3>

					<div className="text-sm text-vscode-descriptionForeground mb-2">
						{t("prompts:globalCustomInstructions.description", {
							language: i18next.language,
						})}
					</div>
					<VSCodeTextArea
						value={customInstructions || ""}
						onChange={(e) => {
							const value =
								(e as unknown as CustomEvent)?.detail?.target?.value ||
								((e as any).target as HTMLTextAreaElement).value
							setCustomInstructions(value || undefined)
							vscode.postMessage({
								type: "customInstructions",
								text: value.trim() || undefined,
							})
						}}
						rows={4}
						className="w-full resize-y"
						data-testid="global-custom-instructions-textarea"
					/>
					<div className="text-xs text-vscode-descriptionForeground mt-1.5">
						<Trans
							i18nKey="prompts:globalCustomInstructions.loadFromFile"
							components={{
								span: (
									<span
										className="text-vscode-textLink-foreground cursor-pointer underline"
										onClick={() =>
											vscode.postMessage({
												type: "openFile",
												text: "./.roo/rules/rules.md",
												values: {
													create: true,
													content: "",
												},
											})
										}
									/>
								),
							}}
						/>
					</div>
				</div>

				<div className="mt-5 pb-15 border-b border-vscode-input-border">
					<h3 className="text-vscode-foreground mb-3">{t("prompts:supportPrompts.title")}</h3>
					<div className="flex gap-4 items-center flex-wrap py-1">
						<Select
							value={activeSupportOption}
							onValueChange={(type) => setActiveSupportOption(type as SupportPromptType)}>
							<SelectTrigger className="w-full" data-testid="support-prompt-select-trigger">
								<SelectValue placeholder={t("settings:common.select")} />
							</SelectTrigger>
							<SelectContent>
								{Object.keys(supportPrompt.default).map((type) => (
									<SelectItem key={type} value={type} data-testid={`${type}-option`}>
										{t(`prompts:supportPrompts.types.${type}.label`)}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>

					{/* Support prompt description */}
					<div className="text-[13px] text-vscode-descriptionForeground my-2 mb-4">
						{t(`prompts:supportPrompts.types.${activeSupportOption}.description`)}
					</div>

					<div key={activeSupportOption}>
						<div className="flex justify-between items-center mb-1">
							<div className="font-bold">{t("prompts:supportPrompts.prompt")}</div>
							<Button
								variant="ghost"
								size="icon"
								onClick={() => handleSupportReset(activeSupportOption)}
								title={t("prompts:supportPrompts.resetPrompt", {
									promptType: activeSupportOption,
								})}>
								<span className="codicon codicon-discard"></span>
							</Button>
						</div>

						<VSCodeTextArea
							value={getSupportPromptValue(activeSupportOption)}
							onChange={(e) => {
								const value =
									(e as unknown as CustomEvent)?.detail?.target?.value ||
									((e as any).target as HTMLTextAreaElement).value
								const trimmedValue = value.trim()
								updateSupportPrompt(activeSupportOption, trimmedValue || undefined)
							}}
							rows={6}
							className="resize-y w-full"
						/>

						{activeSupportOption === "ENHANCE" && (
							<>
								<div>
									<div className="text-vscode-foreground text-[13px] mb-5 mt-1.5"></div>
									<div className="mb-3">
										<div className="mb-2">
											<div className="font-bold mb-1">
												{t("prompts:supportPrompts.enhance.apiConfiguration")}
											</div>
											<div className="text-[13px] text-vscode-descriptionForeground">
												{t("prompts:supportPrompts.enhance.apiConfigDescription")}
											</div>
										</div>
										<Select
											value={enhancementApiConfigId || "-"}
											onValueChange={(value) => {
												// normalise to empty string for empty value
												// because we can't use it directly for the select element
												setEnhancementApiConfigId(value === "-" ? "" : value)
												vscode.postMessage({
													type: "enhancementApiConfigId",
													text: value,
												})
											}}>
											<SelectTrigger data-testid="api-config-select" className="w-full">
												<SelectValue
													placeholder={t("prompts:supportPrompts.enhance.useCurrentConfig")}
												/>
											</SelectTrigger>
											<SelectContent>
												<SelectItem value="-">
													{t("prompts:supportPrompts.enhance.useCurrentConfig")}
												</SelectItem>
												{(listApiConfigMeta || []).map((config) => (
													<SelectItem
														key={config.id}
														value={config.id}
														data-testid={`${config.id}-option`}>
														{config.name}
													</SelectItem>
												))}
											</SelectContent>
										</Select>
									</div>
								</div>

								<div className="mt-4">
									<VSCodeTextArea
										value={testPrompt}
										onChange={(e) => setTestPrompt((e.target as HTMLTextAreaElement).value)}
										placeholder={t("prompts:supportPrompts.enhance.testPromptPlaceholder")}
										rows={3}
										className="w-full resize-y"
										data-testid="test-prompt-textarea"
									/>
									<div className="mt-2 flex justify-start items-center gap-2">
										<Button
											variant="default"
											onClick={handleTestEnhancement}
											disabled={isEnhancing}>
											{t("prompts:supportPrompts.enhance.previewButton")}
										</Button>
									</div>
								</div>
							</>
						)}
					</div>
				</div>
			</TabContent>

			{isCreateModeDialogOpen && (
				<div className="fixed inset-0 flex justify-end bg-black/50 z-[1000]">
					<div className="w-[calc(100vw-100px)] h-full bg-vscode-editor-background shadow-md flex flex-col relative">
						<div className="flex-1 p-5 overflow-y-auto min-h-0">
							<Button
								variant="ghost"
								size="icon"
								onClick={() => setIsCreateModeDialogOpen(false)}
								className="absolute top-5 right-5">
								<span className="codicon codicon-close"></span>
							</Button>
							<h2 className="mb-4">{t("prompts:createModeDialog.title")}</h2>
							<div className="mb-4">
								<div className="font-bold mb-1">{t("prompts:createModeDialog.name.label")}</div>
								<Input
									type="text"
									value={newModeName}
									onChange={(e) => {
										handleNameChange(e.target.value)
									}}
									className="w-full"
								/>
								{nameError && (
									<div className="text-xs text-vscode-errorForeground mt-1">{nameError}</div>
								)}
							</div>
							<div className="mb-4">
								<div className="font-bold mb-1">{t("prompts:createModeDialog.slug.label")}</div>
								<Input
									type="text"
									value={newModeSlug}
									onChange={(e) => {
										setNewModeSlug(e.target.value)
									}}
									className="w-full"
								/>
								<div className="text-xs text-vscode-descriptionForeground mt-1">
									{t("prompts:createModeDialog.slug.description")}
								</div>
								{slugError && (
									<div className="text-xs text-vscode-errorForeground mt-1">{slugError}</div>
								)}
							</div>
							<div className="mb-4">
								<div className="font-bold mb-1">{t("prompts:createModeDialog.saveLocation.label")}</div>
								<div className="text-sm text-vscode-descriptionForeground mb-2">
									{t("prompts:createModeDialog.saveLocation.description")}
								</div>
								<VSCodeRadioGroup
									value={newModeSource}
									onChange={(e: Event | React.FormEvent<HTMLElement>) => {
										const target = ((e as CustomEvent)?.detail?.target ||
											(e.target as HTMLInputElement)) as HTMLInputElement
										setNewModeSource(target.value as ModeSource)
									}}>
									<VSCodeRadio value="global">
										{t("prompts:createModeDialog.saveLocation.global.label")}
										<div className="text-xs text-vscode-descriptionForeground mt-0.5">
											{t("prompts:createModeDialog.saveLocation.global.description")}
										</div>
									</VSCodeRadio>
									<VSCodeRadio value="project">
										{t("prompts:createModeDialog.saveLocation.project.label")}
										<div className="text-xs text-vscode-descriptionForeground mt-0.5">
											{t("prompts:createModeDialog.saveLocation.project.description")}
										</div>
									</VSCodeRadio>
								</VSCodeRadioGroup>
							</div>

							<div style={{ marginBottom: "16px" }}>
								<div style={{ fontWeight: "bold", marginBottom: "4px" }}>
									{t("prompts:createModeDialog.roleDefinition.label")}
								</div>
								<div
									style={{
										fontSize: "13px",
										color: "var(--vscode-descriptionForeground)",
										marginBottom: "8px",
									}}>
									{t("prompts:createModeDialog.roleDefinition.description")}
								</div>
								<VSCodeTextArea
									value={newModeRoleDefinition}
									onChange={(e) => {
										setNewModeRoleDefinition((e.target as HTMLTextAreaElement).value)
									}}
									rows={4}
									className="w-full resize-y"
								/>
								{roleDefinitionError && (
									<div className="text-xs text-vscode-errorForeground mt-1">
										{roleDefinitionError}
									</div>
								)}
							</div>

							<div className="mb-4">
								<div className="font-bold mb-1">{t("prompts:createModeDialog.whenToUse.label")}</div>
								<div className="text-[13px] text-vscode-descriptionForeground mb-2">
									{t("prompts:createModeDialog.whenToUse.description")}
								</div>
								<VSCodeTextArea
									value={newModeWhenToUse}
									onChange={(e) => {
										setNewModeWhenToUse((e.target as HTMLTextAreaElement).value)
									}}
									rows={3}
									className="w-full resize-y"
								/>
							</div>
							<div className="mb-4">
								<div className="font-bold mb-1">{t("prompts:createModeDialog.tools.label")}</div>
								<div className="text-[13px] text-vscode-descriptionForeground mb-2">
									{t("prompts:createModeDialog.tools.description")}
								</div>
								<div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-2">
									{availableGroups.map((group) => (
										<VSCodeCheckbox
											key={group}
											checked={newModeGroups.some((g) => getGroupName(g) === group)}
											onChange={(e: Event | React.FormEvent<HTMLElement>) => {
												const target =
													(e as CustomEvent)?.detail?.target || (e.target as HTMLInputElement)
												const checked = target.checked
												if (checked) {
													setNewModeGroups([...newModeGroups, group])
												} else {
													setNewModeGroups(
														newModeGroups.filter((g) => getGroupName(g) !== group),
													)
												}
											}}>
											{t(`prompts:tools.toolNames.${group}`)}
										</VSCodeCheckbox>
									))}
								</div>
								{groupsError && (
									<div className="text-xs text-vscode-errorForeground mt-1">{groupsError}</div>
								)}
							</div>
							<div className="mb-4">
								<div className="font-bold mb-1">
									{t("prompts:createModeDialog.customInstructions.label")}
								</div>
								<div className="text-[13px] text-vscode-descriptionForeground mb-2">
									{t("prompts:createModeDialog.customInstructions.description")}
								</div>
								<VSCodeTextArea
									value={newModeCustomInstructions}
									onChange={(e) => {
										setNewModeCustomInstructions((e.target as HTMLTextAreaElement).value)
									}}
									rows={4}
									className="w-full resize-y"
								/>
							</div>
						</div>
						<div className="flex justify-end p-3 px-5 gap-2 border-t border-vscode-editor-lineHighlightBorder bg-vscode-editor-background">
							<Button variant="secondary" onClick={() => setIsCreateModeDialogOpen(false)}>
								{t("prompts:createModeDialog.buttons.cancel")}
							</Button>
							<Button variant="default" onClick={handleCreateMode}>
								{t("prompts:createModeDialog.buttons.create")}
							</Button>
						</div>
					</div>
				</div>
			)}

			{isDialogOpen && (
				<div className="fixed inset-0 flex justify-end bg-black/50 z-[1000]">
					<div className="w-[calc(100vw-100px)] h-full bg-vscode-editor-background shadow-md flex flex-col relative">
						<div className="flex-1 p-5 overflow-y-auto min-h-0">
							<Button
								variant="ghost"
								size="icon"
								onClick={() => setIsDialogOpen(false)}
								className="absolute top-5 right-5">
								<span className="codicon codicon-close"></span>
							</Button>
							<h2 className="mb-4">
								{selectedPromptTitle ||
									t("prompts:systemPrompt.title", {
										modeName: getCurrentMode()?.name || "Code",
									})}
							</h2>
							<pre className="p-2 whitespace-pre-wrap break-words font-mono text-vscode-editor-font-size text-vscode-editor-foreground bg-vscode-editor-background border border-vscode-editor-lineHighlightBorder rounded overflow-y-auto">
								{selectedPromptContent}
							</pre>
						</div>
						<div className="flex justify-end p-3 px-5 border-t border-vscode-editor-lineHighlightBorder bg-vscode-editor-background">
							<Button variant="secondary" onClick={() => setIsDialogOpen(false)}>
								{t("prompts:createModeDialog.close")}
							</Button>
						</div>
					</div>
				</div>
			)}
		</Tab>
	)
}

export default PromptsView
