import React, { useState, useEffect, useMemo, useCallback, useRef } from "react"
import {
	VSCodeCheckbox,
	VSCodeRadioGroup,
	VSCodeRadio,
	VSCodeTextArea,
	VSCodeLink,
	VSCodeTextField,
} from "@vscode/webview-ui-toolkit/react"
import { Trans } from "react-i18next"
import { ChevronDown, X, Upload, Download } from "lucide-react"

import { ModeConfig, GroupEntry, PromptComponent, ToolGroup, modeConfigSchema } from "@roo-code/types"

import {
	Mode,
	getRoleDefinition,
	getWhenToUse,
	getDescription,
	getCustomInstructions,
	getAllModes,
	findModeBySlug as findCustomModeBySlug,
} from "@roo/modes"
import { TOOL_GROUPS } from "@roo/tools"

import { vscode } from "@src/utils/vscode"
import { buildDocLink } from "@src/utils/docLinks"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { useExtensionState } from "@src/context/ExtensionStateContext"
import { Tab, TabContent, TabHeader } from "@src/components/common/Tab"
import {
	Button,
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
	StandardTooltip,
} from "@src/components/ui"

// Get all available groups that should show in prompts view
const availableGroups = (Object.keys(TOOL_GROUPS) as ToolGroup[]).filter((group) => !TOOL_GROUPS[group].alwaysAvailable)

type ModeSource = "global" | "project"

type ModesViewProps = {
	onDone: () => void
}

// Helper to get group name regardless of format
function getGroupName(group: GroupEntry): ToolGroup {
	return Array.isArray(group) ? group[0] : group
}

const ModesView = ({ onDone }: ModesViewProps) => {
	const { t } = useAppTranslation()

	const {
		customModePrompts,
		listApiConfigMeta,
		currentApiConfigName,
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

	const [isDialogOpen, setIsDialogOpen] = useState(false)
	const [selectedPromptContent, setSelectedPromptContent] = useState("")
	const [selectedPromptTitle, setSelectedPromptTitle] = useState("")
	const [isToolsEditMode, setIsToolsEditMode] = useState(false)
	const [showConfigMenu, setShowConfigMenu] = useState(false)
	const [isCreateModeDialogOpen, setIsCreateModeDialogOpen] = useState(false)
	const [isSystemPromptDisclosureOpen, setIsSystemPromptDisclosureOpen] = useState(false)
	const [isExporting, setIsExporting] = useState(false)
	const [isImporting, setIsImporting] = useState(false)
	const [showImportDialog, setShowImportDialog] = useState(false)
	const [hasRulesToExport, setHasRulesToExport] = useState<Record<string, boolean>>({})

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
			if (updatedPrompt.description === getDescription(mode)) {
				delete updatedPrompt.description
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
			return findCustomModeBySlug(searchSlug, modes)
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

	// Check if the current mode has rules to export
	const checkRulesDirectory = useCallback((slug: string) => {
		vscode.postMessage({
			type: "checkRulesDirectory",
			slug: slug,
		})
	}, [])

	// Check rules directory when mode changes
	useEffect(() => {
		const currentMode = getCurrentMode()
		if (currentMode?.slug && hasRulesToExport[currentMode.slug] === undefined) {
			checkRulesDirectory(currentMode.slug)
		}
	}, [getCurrentMode, checkRulesDirectory, hasRulesToExport])

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
	const [newModeDescription, setNewModeDescription] = useState("")
	const [newModeRoleDefinition, setNewModeRoleDefinition] = useState("")
	const [newModeWhenToUse, setNewModeWhenToUse] = useState("")
	const [newModeCustomInstructions, setNewModeCustomInstructions] = useState("")
	const [newModeGroups, setNewModeGroups] = useState<GroupEntry[]>(availableGroups)
	const [newModeSource, setNewModeSource] = useState<ModeSource>("global")

	// Field-specific error states
	const [nameError, setNameError] = useState<string>("")
	const [slugError, setSlugError] = useState<string>("")
	const [descriptionError, setDescriptionError] = useState<string>("")
	const [roleDefinitionError, setRoleDefinitionError] = useState<string>("")
	const [groupsError, setGroupsError] = useState<string>("")

	// Helper to reset form state
	const resetFormState = useCallback(() => {
		// Reset form fields
		setNewModeName("")
		setNewModeSlug("")
		setNewModeDescription("")
		setNewModeGroups(availableGroups)
		setNewModeRoleDefinition("")
		setNewModeWhenToUse("")
		setNewModeCustomInstructions("")
		setNewModeSource("global")
		// Reset error states
		setNameError("")
		setSlugError("")
		setDescriptionError("")
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
		setDescriptionError("")
		setRoleDefinitionError("")
		setGroupsError("")

		const source = newModeSource
		const newMode: ModeConfig = {
			slug: newModeSlug,
			name: newModeName,
			description: newModeDescription.trim() || undefined,
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
					case "description":
						setDescriptionError(message)
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
		newModeDescription,
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
			if (message.type === "systemPrompt") {
				if (message.text) {
					setSelectedPromptContent(message.text)
					setSelectedPromptTitle(`System Prompt (${message.mode} mode)`)
					setIsDialogOpen(true)
				}
			} else if (message.type === "exportModeResult") {
				setIsExporting(false)

				if (!message.success) {
					// Show error message
					console.error("Failed to export mode:", message.error)
				}
			} else if (message.type === "importModeResult") {
				setIsImporting(false)
				setShowImportDialog(false)

				if (!message.success) {
					// Only log error if it's not a cancellation
					if (message.error !== "cancelled") {
						console.error("Failed to import mode:", message.error)
					}
				}
			} else if (message.type === "checkRulesDirectoryResult") {
				setHasRulesToExport((prev) => ({
					...prev,
					[message.slug]: message.hasContent,
				}))
			}
		}

		window.addEventListener("message", handler)
		return () => window.removeEventListener("message", handler)
	}, [])

	const handleAgentReset = (
		modeSlug: string,
		type: "roleDefinition" | "description" | "whenToUse" | "customInstructions",
	) => {
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
							<StandardTooltip content={t("prompts:modes.createNewMode")}>
								<Button variant="ghost" size="icon" onClick={openCreateModeDialog}>
									<span className="codicon codicon-add"></span>
								</Button>
							</StandardTooltip>
							<div className="relative inline-block">
								<StandardTooltip content={t("prompts:modes.editModesConfig")}>
									<Button
										variant="ghost"
										size="icon"
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
								</StandardTooltip>
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
						<Trans i18nKey="prompts:modes.createModeHelpText">
							<VSCodeLink
								href={buildDocLink("basic-usage/using-modes", "prompts_view_modes")}
								style={{ display: "inline" }}></VSCodeLink>
							<VSCodeLink
								href={buildDocLink("features/custom-modes", "prompts_view_modes")}
								style={{ display: "inline" }}></VSCodeLink>
						</Trans>
					</div>

					<div className="flex items-center gap-1 mb-3">
						<Popover open={open} onOpenChange={onOpenChange}>
							<PopoverTrigger asChild>
								<Button
									variant="combobox"
									role="combobox"
									aria-expanded={open}
									className="justify-between w-60"
									data-testid="mode-select-trigger">
									<div>{getCurrentMode()?.name || t("prompts:modes.selectMode")}</div>
									<ChevronDown className="opacity-50" />
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
					{/* API Configuration - Moved Here */}
					<div className="mb-3">
						<div className="font-bold mb-1">{t("prompts:apiConfiguration.title")}</div>
						<div className="text-sm text-vscode-descriptionForeground mb-2">
							{t("prompts:apiConfiguration.select")}
						</div>
						<div className="mb-2">
							<Select
								value={currentApiConfigName}
								onValueChange={(value) => {
									vscode.postMessage({
										type: "loadApiConfiguration",
										text: value,
									})
								}}>
								<SelectTrigger className="w-60">
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
						</div>
					</div>
				</div>

				{/* Name section */}
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
									<StandardTooltip content={t("prompts:createModeDialog.deleteMode")}>
										<Button
											variant="ghost"
											size="icon"
											onClick={() => {
												vscode.postMessage({
													type: "deleteCustomMode",
													slug: visualMode,
												})
											}}>
											<span className="codicon codicon-trash"></span>
										</Button>
									</StandardTooltip>
								</div>
							</div>
						</div>
					)}

					{/* Role Definition section */}
					<div className="mb-4">
						<div className="flex justify-between items-center mb-1">
							<div className="font-bold">{t("prompts:roleDefinition.title")}</div>
							{!findModeBySlug(visualMode, customModes) && (
								<StandardTooltip content={t("prompts:roleDefinition.resetToDefault")}>
									<Button
										variant="ghost"
										size="icon"
										onClick={() => {
											const currentMode = getCurrentMode()
											if (currentMode?.slug) {
												handleAgentReset(currentMode.slug, "roleDefinition")
											}
										}}
										data-testid="role-definition-reset">
										<span className="codicon codicon-discard"></span>
									</Button>
								</StandardTooltip>
							)}
						</div>
						<div className="text-sm text-vscode-descriptionForeground mb-2">
							{t("prompts:roleDefinition.description")}
						</div>
						<VSCodeTextArea
							resize="vertical"
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
							className="w-full"
							rows={5}
							data-testid={`${getCurrentMode()?.slug || "code"}-prompt-textarea`}
						/>
					</div>

					{/* Description section */}
					<div className="mb-4">
						<div className="flex justify-between items-center mb-1">
							<div className="font-bold">{t("prompts:description.title")}</div>
							{!findModeBySlug(visualMode, customModes) && (
								<StandardTooltip content={t("prompts:description.resetToDefault")}>
									<Button
										variant="ghost"
										size="icon"
										onClick={() => {
											const currentMode = getCurrentMode()
											if (currentMode?.slug) {
												handleAgentReset(currentMode.slug, "description")
											}
										}}
										data-testid="description-reset">
										<span className="codicon codicon-discard"></span>
									</Button>
								</StandardTooltip>
							)}
						</div>
						<div className="text-sm text-vscode-descriptionForeground mb-2">
							{t("prompts:description.description")}
						</div>
						<VSCodeTextField
							value={(() => {
								const customMode = findModeBySlug(visualMode, customModes)
								const prompt = customModePrompts?.[visualMode] as PromptComponent
								return customMode?.description ?? prompt?.description ?? getDescription(visualMode)
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
										description: value.trim() || undefined,
										source: customMode.source || "global",
									})
								} else {
									// For built-in modes, update the prompts
									updateAgentPrompt(visualMode, {
										description: value.trim() || undefined,
									})
								}
							}}
							className="w-full"
							data-testid={`${getCurrentMode()?.slug || "code"}-description-textfield`}
						/>
					</div>

					{/* When to Use section */}
					<div className="mb-4">
						<div className="flex justify-between items-center mb-1">
							<div className="font-bold">{t("prompts:whenToUse.title")}</div>
							{!findModeBySlug(visualMode, customModes) && (
								<StandardTooltip content={t("prompts:whenToUse.resetToDefault")}>
									<Button
										variant="ghost"
										size="icon"
										onClick={() => {
											const currentMode = getCurrentMode()
											if (currentMode?.slug) {
												handleAgentReset(currentMode.slug, "whenToUse")
											}
										}}
										data-testid="when-to-use-reset">
										<span className="codicon codicon-discard"></span>
									</Button>
								</StandardTooltip>
							)}
						</div>
						<div className="text-sm text-vscode-descriptionForeground mb-2">
							{t("prompts:whenToUse.description")}
						</div>
						<VSCodeTextArea
							resize="vertical"
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
							className="w-full"
							rows={4}
							data-testid={`${getCurrentMode()?.slug || "code"}-when-to-use-textarea`}
						/>
					</div>

					{/* Mode settings */}
					<>
						{/* Show tools for all modes */}
						<div className="mb-4">
							<div className="flex justify-between items-center mb-1">
								<div className="font-bold">{t("prompts:tools.title")}</div>
								{findModeBySlug(visualMode, customModes) && (
									<StandardTooltip
										content={
											isToolsEditMode
												? t("prompts:tools.doneEditing")
												: t("prompts:tools.editTools")
										}>
										<Button
											variant="ghost"
											size="icon"
											onClick={() => setIsToolsEditMode(!isToolsEditMode)}>
											<span
												className={`codicon codicon-${isToolsEditMode ? "check" : "edit"}`}></span>
										</Button>
									</StandardTooltip>
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
								<StandardTooltip content={t("prompts:customInstructions.resetToDefault")}>
									<Button
										variant="ghost"
										size="icon"
										onClick={() => {
											const currentMode = getCurrentMode()
											if (currentMode?.slug) {
												handleAgentReset(currentMode.slug, "customInstructions")
											}
										}}
										data-testid="custom-instructions-reset">
										<span className="codicon codicon-discard"></span>
									</Button>
								</StandardTooltip>
							)}
						</div>
						<div className="text-[13px] text-vscode-descriptionForeground mb-2">
							{t("prompts:customInstructions.description", {
								modeName: getCurrentMode()?.name || "Code",
							})}
						</div>
						<VSCodeTextArea
							resize="vertical"
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
							rows={10}
							className="w-full"
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
					<div className="flex gap-2 mb-4">
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
						<StandardTooltip content={t("prompts:systemPrompt.copy")}>
							<Button
								variant="ghost"
								size="icon"
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
						</StandardTooltip>
					</div>

					{/* Export/Import Mode Buttons */}
					<div className="flex items-center gap-2">
						{/* Export button - visible when any mode is selected */}
						{getCurrentMode() && (
							<Button
								variant="default"
								onClick={() => {
									const currentMode = getCurrentMode()
									if (currentMode?.slug && !isExporting) {
										setIsExporting(true)
										vscode.postMessage({
											type: "exportMode",
											slug: currentMode.slug,
										})
									}
								}}
								disabled={isExporting}
								title={t("prompts:exportMode.title")}
								data-testid="export-mode-button">
								<Upload className="h-4 w-4" />
								{isExporting ? t("prompts:exportMode.exporting") : t("prompts:exportMode.title")}
							</Button>
						)}
						{/* Import button - always visible */}
						<Button
							variant="default"
							onClick={() => setShowImportDialog(true)}
							disabled={isImporting}
							title={t("prompts:modes.importMode")}
							data-testid="import-mode-button">
							<Download className="h-4 w-4" />
							{isImporting ? t("prompts:importMode.importing") : t("prompts:modes.importMode")}
						</Button>
					</div>

					{/* Advanced Features Disclosure */}
					<div className="mt-4">
						<button
							onClick={() => setIsSystemPromptDisclosureOpen(!isSystemPromptDisclosureOpen)}
							className="flex items-center text-xs text-vscode-foreground hover:text-vscode-textLink-foreground focus:outline-none"
							aria-expanded={isSystemPromptDisclosureOpen}>
							<span
								className={`codicon codicon-${isSystemPromptDisclosureOpen ? "chevron-down" : "chevron-right"} mr-1`}></span>
							<span>{t("prompts:advanced.title")}</span>
						</button>

						{isSystemPromptDisclosureOpen && (
							<div className="mt-2 ml-5 space-y-4">
								{/* Override System Prompt Section */}
								<div>
									<h4 className="text-xs font-semibold text-vscode-foreground mb-2">
										Override System Prompt
									</h4>
									<div className="text-xs text-vscode-descriptionForeground">
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
												"1": (
													<VSCodeLink
														href={buildDocLink(
															"features/footgun-prompting",
															"prompts_advanced_system_prompt",
														)}
														style={{ display: "inline" }}></VSCodeLink>
												),
												"2": <strong />,
											}}
										/>
									</div>
								</div>
							</div>
						)}
					</div>
				</div>

				<div className="pb-5">
					<h3 className="text-vscode-foreground mb-3">{t("prompts:globalCustomInstructions.title")}</h3>

					<div className="text-sm text-vscode-descriptionForeground mb-2">
						<Trans i18nKey="prompts:globalCustomInstructions.description">
							<VSCodeLink
								href={buildDocLink(
									"features/custom-instructions#global-custom-instructions",
									"prompts_global_custom_instructions",
								)}
								style={{ display: "inline" }}></VSCodeLink>
						</Trans>
					</div>
					<VSCodeTextArea
						resize="vertical"
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
						className="w-full"
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
									resize="vertical"
									value={newModeRoleDefinition}
									onChange={(e) => {
										setNewModeRoleDefinition((e.target as HTMLTextAreaElement).value)
									}}
									rows={4}
									className="w-full"
								/>
								{roleDefinitionError && (
									<div className="text-xs text-vscode-errorForeground mt-1">
										{roleDefinitionError}
									</div>
								)}
							</div>

							<div className="mb-4">
								<div className="font-bold mb-1">{t("prompts:createModeDialog.description.label")}</div>
								<div className="text-[13px] text-vscode-descriptionForeground mb-2">
									{t("prompts:createModeDialog.description.description")}
								</div>
								<VSCodeTextField
									value={newModeDescription}
									onChange={(e) => {
										setNewModeDescription((e.target as HTMLInputElement).value)
									}}
									className="w-full"
								/>
								{descriptionError && (
									<div className="text-xs text-vscode-errorForeground mt-1">{descriptionError}</div>
								)}
							</div>

							<div className="mb-4">
								<div className="font-bold mb-1">{t("prompts:createModeDialog.whenToUse.label")}</div>
								<div className="text-[13px] text-vscode-descriptionForeground mb-2">
									{t("prompts:createModeDialog.whenToUse.description")}
								</div>
								<VSCodeTextArea
									resize="vertical"
									value={newModeWhenToUse}
									onChange={(e) => {
										setNewModeWhenToUse((e.target as HTMLTextAreaElement).value)
									}}
									rows={3}
									className="w-full"
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
									resize="vertical"
									value={newModeCustomInstructions}
									onChange={(e) => {
										setNewModeCustomInstructions((e.target as HTMLTextAreaElement).value)
									}}
									rows={4}
									className="w-full"
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

			{/* Import Mode Dialog */}
			{showImportDialog && (
				<div className="fixed inset-0 flex items-center justify-center bg-black/50 z-[1000]">
					<div className="bg-vscode-editor-background border border-vscode-editor-lineHighlightBorder rounded-lg shadow-lg p-6 max-w-md w-full">
						<h3 className="text-lg font-semibold mb-4">{t("prompts:modes.importMode")}</h3>
						<p className="text-sm text-vscode-descriptionForeground mb-4">
							{t("prompts:importMode.selectLevel")}
						</p>
						<div className="space-y-3 mb-6">
							<label className="flex items-start gap-2 cursor-pointer">
								<input
									type="radio"
									name="importLevel"
									value="project"
									className="mt-1"
									defaultChecked
								/>
								<div>
									<div className="font-medium">{t("prompts:importMode.project.label")}</div>
									<div className="text-xs text-vscode-descriptionForeground">
										{t("prompts:importMode.project.description")}
									</div>
								</div>
							</label>
							<label className="flex items-start gap-2 cursor-pointer">
								<input type="radio" name="importLevel" value="global" className="mt-1" />
								<div>
									<div className="font-medium">{t("prompts:importMode.global.label")}</div>
									<div className="text-xs text-vscode-descriptionForeground">
										{t("prompts:importMode.global.description")}
									</div>
								</div>
							</label>
						</div>
						<div className="flex justify-end gap-2">
							<Button variant="secondary" onClick={() => setShowImportDialog(false)}>
								{t("prompts:createModeDialog.buttons.cancel")}
							</Button>
							<Button
								variant="default"
								onClick={() => {
									if (!isImporting) {
										const selectedLevel = (
											document.querySelector(
												'input[name="importLevel"]:checked',
											) as HTMLInputElement
										)?.value as "global" | "project"
										setIsImporting(true)
										vscode.postMessage({
											type: "importMode",
											source: selectedLevel || "project",
										})
									}
								}}
								disabled={isImporting}>
								{isImporting ? t("prompts:importMode.importing") : t("prompts:importMode.import")}
							</Button>
						</div>
					</div>
				</div>
			)}
		</Tab>
	)
}

export default ModesView
