import React, { useState, useEffect, useMemo, useCallback } from "react"
import {
	VSCodeButton,
	VSCodeTextArea,
	VSCodeDropdown,
	VSCodeOption,
	VSCodeTextField,
	VSCodeCheckbox,
	VSCodeRadioGroup,
	VSCodeRadio,
} from "@vscode/webview-ui-toolkit/react"
import { useExtensionState } from "../../context/ExtensionStateContext"
import {
	Mode,
	PromptComponent,
	getRoleDefinition,
	getCustomInstructions,
	getAllModes,
	ModeConfig,
	GroupEntry,
} from "../../../../src/shared/modes"
import { CustomModeSchema } from "../../../../src/core/config/CustomModesSchema"
import {
	supportPrompt,
	SupportPromptType,
	supportPromptLabels,
	supportPromptDescriptions,
} from "../../../../src/shared/support-prompt"

import { TOOL_GROUPS, GROUP_DISPLAY_NAMES, ToolGroup } from "../../../../src/shared/tool-groups"
import { vscode } from "../../utils/vscode"

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
		preferredLanguage,
		setPreferredLanguage,
		customModes,
	} = useExtensionState()

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
	const [activeSupportTab, setActiveSupportTab] = useState<SupportPromptType>("ENHANCE")

	// Direct update functions
	const updateAgentPrompt = useCallback(
		(mode: Mode, promptData: PromptComponent) => {
			const existingPrompt = customModePrompts?.[mode] as PromptComponent
			const updatedPrompt = { ...existingPrompt, ...promptData }

			// Only include properties that differ from defaults
			if (updatedPrompt.roleDefinition === getRoleDefinition(mode)) {
				delete updatedPrompt.roleDefinition
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
			if (modeConfig.slug === mode) return // Prevent unnecessary updates

			// First switch the mode
			switchMode(modeConfig.slug)

			// Exit tools edit mode when switching modes
			setIsToolsEditMode(false)
		},
		[mode, switchMode, setIsToolsEditMode],
	)

	// Helper function to get current mode's config
	const getCurrentMode = useCallback((): ModeConfig | undefined => {
		const findMode = (m: ModeConfig): boolean => m.slug === mode
		return customModes?.find(findMode) || modes.find(findMode)
	}, [mode, customModes, modes])

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
			customInstructions: newModeCustomInstructions.trim() || undefined,
			groups: newModeGroups,
			source,
		}

		// Validate the mode against the schema
		const result = CustomModeSchema.safeParse(newMode)
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
		const handleClickOutside = (event: MouseEvent) => {
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

	const handleAgentReset = (modeSlug: string, type: "roleDefinition" | "customInstructions") => {
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
		<div className="fixed inset-0 flex flex-col">
			<div className="flex justify-between items-center px-5 py-2.5">
				<h3 className="text-vscode-foreground m-0">Prompts</h3>
				<VSCodeButton onClick={onDone}>Done</VSCodeButton>
			</div>

			<div className="flex-1 overflow-auto px-5">
				<div className="pb-5 border-b border-vscode-input-border">
					<div className="mb-5">
						<div className="font-bold mb-1">Preferred Language</div>
						<select
							value={preferredLanguage}
							onChange={(e) => {
								setPreferredLanguage(e.target.value)
								vscode.postMessage({
									type: "preferredLanguage",
									text: e.target.value,
								})
							}}
							className="w-full px-2 py-1 h-7 bg-vscode-input-background text-vscode-input-foreground border border-vscode-input-border rounded">
							<option value="English">English</option>
							<option value="Arabic">Arabic - العربية</option>
							<option value="Brazilian Portuguese">Portuguese - Português (Brasil)</option>
							<option value="Czech">Czech - Čeština</option>
							<option value="French">French - Français</option>
							<option value="German">German - Deutsch</option>
							<option value="Hindi">Hindi - हिन्दी</option>
							<option value="Hungarian">Hungarian - Magyar</option>
							<option value="Italian">Italian - Italiano</option>
							<option value="Japanese">Japanese - 日本語</option>
							<option value="Korean">Korean - 한국어</option>
							<option value="Polish">Polish - Polski</option>
							<option value="Portuguese">Portuguese - Português (Portugal)</option>
							<option value="Russian">Russian - Русский</option>
							<option value="Simplified Chinese">Simplified Chinese - 简体中文</option>
							<option value="Spanish">Spanish - Español</option>
							<option value="Traditional Chinese">Traditional Chinese - 繁體中文</option>
							<option value="Turkish">Turkish - Türkçe</option>
						</select>
						<p className="text-xs mt-1.5 text-vscode-descriptionForeground">
							Select the language that Cline should use for communication.
						</p>
					</div>

					<div className="font-bold mb-1">Custom Instructions for All Modes</div>
					<div className="text-sm text-vscode-descriptionForeground mb-2">
						These instructions apply to all modes. They provide a base set of behaviors that can be enhanced
						by mode-specific instructions below.
					</div>
					<VSCodeTextArea
						value={customInstructions ?? ""}
						onChange={(e) => {
							const value =
								(e as CustomEvent)?.detail?.target?.value ||
								((e as any).target as HTMLTextAreaElement).value
							setCustomInstructions(value || undefined)
							vscode.postMessage({
								type: "customInstructions",
								text: value.trim() || undefined,
							})
						}}
						rows={4}
						resize="vertical"
						className="w-full"
						data-testid="global-custom-instructions-textarea"
					/>
					<div className="text-xs text-vscode-descriptionForeground mt-1.5 mb-10">
						Instructions can also be loaded from{" "}
						<span
							className="text-vscode-textLink-foreground cursor-pointer underline"
							onClick={() =>
								vscode.postMessage({
									type: "openFile",
									text: "./.clinerules",
									values: {
										create: true,
										content: "",
									},
								})
							}>
							.clinerules
						</span>{" "}
						in your workspace.
					</div>
				</div>

				<div className="mt-5">
					<div onClick={(e) => e.stopPropagation()} className="flex justify-between items-center mb-3">
						<h3 className="text-vscode-foreground m-0">Modes</h3>
						<div className="flex gap-2">
							<VSCodeButton appearance="icon" onClick={openCreateModeDialog} title="Create new mode">
								<span className="codicon codicon-add"></span>
							</VSCodeButton>
							<div className="relative inline-block">
								<VSCodeButton
									appearance="icon"
									title="Edit modes configuration"
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
								</VSCodeButton>
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
											Edit Global Modes
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
											Edit Project Modes (.roomodes)
										</div>
									</div>
								)}
							</div>
						</div>
					</div>

					<div className="text-sm text-vscode-descriptionForeground mb-3">
						Hit the + to create a new custom mode, or just ask Roo in chat to create one for you!
					</div>

					<div className="flex gap-2 items-center mb-3 flex-wrap py-1">
						{modes.map((modeConfig) => {
							const isActive = mode === modeConfig.slug
							return (
								<button
									key={modeConfig.slug}
									data-testid={`${modeConfig.slug}-tab`}
									data-active={isActive ? "true" : "false"}
									onClick={() => handleModeSwitch(modeConfig)}
									className={`px-2 py-1 border-none rounded cursor-pointer font-bold ${
										isActive
											? "bg-vscode-button-background text-vscode-button-foreground opacity-100"
											: "bg-transparent text-vscode-foreground opacity-80"
									}`}>
									{modeConfig.name}
								</button>
							)
						})}
					</div>
				</div>

				<div style={{ marginBottom: "20px" }}>
					{/* Only show name and delete for custom modes */}
					{mode && findModeBySlug(mode, customModes) && (
						<div className="flex gap-3 mb-4">
							<div className="flex-1">
								<div className="font-bold mb-1">Name</div>
								<div className="flex gap-2">
									<VSCodeTextField
										value={getModeProperty(findModeBySlug(mode, customModes), "name") ?? ""}
										onChange={(e: Event | React.FormEvent<HTMLElement>) => {
											const target =
												(e as CustomEvent)?.detail?.target ||
												((e as any).target as HTMLInputElement)
											const customMode = findModeBySlug(mode, customModes)
											if (customMode) {
												updateCustomMode(mode, {
													...customMode,
													name: target.value,
													source: customMode.source || "global",
												})
											}
										}}
										className="w-full"
									/>
									<VSCodeButton
										appearance="icon"
										title="Delete mode"
										onClick={() => {
											vscode.postMessage({
												type: "deleteCustomMode",
												slug: mode,
											})
										}}>
										<span className="codicon codicon-trash"></span>
									</VSCodeButton>
								</div>
							</div>
						</div>
					)}
					<div style={{ marginBottom: "16px" }}>
						<div className="flex justify-between items-center mb-1">
							<div className="font-bold">Role Definition</div>
							{!findModeBySlug(mode, customModes) && (
								<VSCodeButton
									appearance="icon"
									onClick={() => {
										const currentMode = getCurrentMode()
										if (currentMode?.slug) {
											handleAgentReset(currentMode.slug, "roleDefinition")
										}
									}}
									title="Reset to default"
									data-testid="role-definition-reset">
									<span className="codicon codicon-discard"></span>
								</VSCodeButton>
							)}
						</div>
						<div className="text-sm text-vscode-descriptionForeground mb-2">
							Define Roo's expertise and personality for this mode. This description shapes how Roo
							presents itself and approaches tasks.
						</div>
						<VSCodeTextArea
							value={(() => {
								const customMode = findModeBySlug(mode, customModes)
								const prompt = customModePrompts?.[mode] as PromptComponent
								return customMode?.roleDefinition ?? prompt?.roleDefinition ?? getRoleDefinition(mode)
							})()}
							onChange={(e) => {
								const value =
									(e as CustomEvent)?.detail?.target?.value ||
									((e as any).target as HTMLTextAreaElement).value
								const customMode = findModeBySlug(mode, customModes)
								if (customMode) {
									// For custom modes, update the JSON file
									updateCustomMode(mode, {
										...customMode,
										roleDefinition: value.trim() || "",
										source: customMode.source || "global",
									})
								} else {
									// For built-in modes, update the prompts
									updateAgentPrompt(mode, {
										roleDefinition: value.trim() || undefined,
									})
								}
							}}
							rows={4}
							resize="vertical"
							style={{ width: "100%" }}
							data-testid={`${getCurrentMode()?.slug || "code"}-prompt-textarea`}
						/>
					</div>
					{/* Mode settings */}
					<>
						<div style={{ marginBottom: "12px" }}>
							<div style={{ fontWeight: "bold", marginBottom: "4px" }}>API Configuration</div>
							<div style={{ marginBottom: "8px" }}>
								<VSCodeDropdown
									value={currentApiConfigName || ""}
									onChange={(e: any) => {
										const value = e.detail?.target?.value || e.target?.value
										vscode.postMessage({
											type: "loadApiConfiguration",
											text: value,
										})
									}}
									className="w-full">
									{(listApiConfigMeta || []).map((config) => (
										<VSCodeOption key={config.id} value={config.name}>
											{config.name}
										</VSCodeOption>
									))}
								</VSCodeDropdown>
								<div className="text-xs mt-1.5 text-vscode-descriptionForeground">
									Select which API configuration to use for this mode
								</div>
							</div>
						</div>

						{/* Show tools for all modes */}
						<div className="mb-4">
							<div className="flex justify-between items-center mb-1">
								<div className="font-bold">Available Tools</div>
								{findModeBySlug(mode, customModes) && (
									<VSCodeButton
										appearance="icon"
										onClick={() => setIsToolsEditMode(!isToolsEditMode)}
										title={isToolsEditMode ? "Done editing" : "Edit tools"}>
										<span
											className={`codicon codicon-${isToolsEditMode ? "check" : "edit"}`}></span>
									</VSCodeButton>
								)}
							</div>
							{!findModeBySlug(mode, customModes) && (
								<div className="text-sm text-vscode-descriptionForeground mb-2">
									Tools for built-in modes cannot be modified
								</div>
							)}
							{isToolsEditMode && findModeBySlug(mode, customModes) ? (
								<div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-2">
									{availableGroups.map((group) => {
										const currentMode = getCurrentMode()
										const isCustomMode = findModeBySlug(mode, customModes)
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
												{GROUP_DISPLAY_NAMES[group]}
												{group === "edit" && (
													<div className="text-xs text-vscode-descriptionForeground mt-0.5">
														Allowed files:{" "}
														{(() => {
															const currentMode = getCurrentMode()
															const editGroup = currentMode?.groups?.find(
																(g) =>
																	Array.isArray(g) &&
																	g[0] === "edit" &&
																	g[1]?.fileRegex,
															)
															if (!Array.isArray(editGroup)) return "all files"
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
										return enabledGroups
											.map((group) => {
												const groupName = getGroupName(group)
												const displayName = GROUP_DISPLAY_NAMES[groupName]
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
					<div style={{ marginBottom: "8px" }}>
						<div
							style={{
								display: "flex",
								justifyContent: "space-between",
								alignItems: "center",
								marginBottom: "4px",
							}}>
							<div style={{ fontWeight: "bold" }}>Mode-specific Custom Instructions (optional)</div>
							{!findModeBySlug(mode, customModes) && (
								<VSCodeButton
									appearance="icon"
									onClick={() => {
										const currentMode = getCurrentMode()
										if (currentMode?.slug) {
											handleAgentReset(currentMode.slug, "customInstructions")
										}
									}}
									title="Reset to default"
									data-testid="custom-instructions-reset">
									<span className="codicon codicon-discard"></span>
								</VSCodeButton>
							)}
						</div>
						<div
							style={{
								fontSize: "13px",
								color: "var(--vscode-descriptionForeground)",
								marginBottom: "8px",
							}}>
							Add behavioral guidelines specific to {getCurrentMode()?.name || "Code"} mode.
						</div>
						<VSCodeTextArea
							value={(() => {
								const customMode = findModeBySlug(mode, customModes)
								const prompt = customModePrompts?.[mode] as PromptComponent
								return (
									customMode?.customInstructions ??
									prompt?.customInstructions ??
									getCustomInstructions(mode, customModes)
								)
							})()}
							onChange={(e) => {
								const value =
									(e as CustomEvent)?.detail?.target?.value ||
									((e as any).target as HTMLTextAreaElement).value
								const customMode = findModeBySlug(mode, customModes)
								if (customMode) {
									// For custom modes, update the JSON file
									updateCustomMode(mode, {
										...customMode,
										customInstructions: value.trim() || undefined,
										source: customMode.source || "global",
									})
								} else {
									// For built-in modes, update the prompts
									const existingPrompt = customModePrompts?.[mode] as PromptComponent
									updateAgentPrompt(mode, {
										...existingPrompt,
										customInstructions: value.trim(),
									})
								}
							}}
							rows={4}
							resize="vertical"
							style={{ width: "100%" }}
							data-testid={`${getCurrentMode()?.slug || "code"}-custom-instructions-textarea`}
						/>
						<div
							style={{
								fontSize: "12px",
								color: "var(--vscode-descriptionForeground)",
								marginTop: "5px",
							}}>
							Custom instructions specific to {getCurrentMode()?.name || "Code"} mode can also be loaded
							from{" "}
							<span
								style={{
									color: "var(--vscode-textLink-foreground)",
									cursor: "pointer",
									textDecoration: "underline",
								}}
								onClick={() => {
									const currentMode = getCurrentMode()
									if (!currentMode) return

									// Open or create an empty file
									vscode.postMessage({
										type: "openFile",
										text: `./.clinerules-${currentMode.slug}`,
										values: {
											create: true,
											content: "",
										},
									})
								}}>
								.clinerules-{getCurrentMode()?.slug || "code"}
							</span>{" "}
							in your workspace.
						</div>
					</div>
				</div>
				<div
					style={{
						paddingBottom: "40px",
						marginBottom: "20px",
						borderBottom: "1px solid var(--vscode-input-border)",
					}}>
					<div style={{ display: "flex", gap: "8px" }}>
						<VSCodeButton
							appearance="primary"
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
							Preview System Prompt
						</VSCodeButton>
						<VSCodeButton
							appearance="icon"
							title="Copy system prompt to clipboard"
							onClick={() => {
								vscode.postMessage({
									type: "copySystemPrompt",
									text: selectedPromptContent,
								})
							}}
							data-testid="copy-prompt-button">
							<span className="codicon codicon-copy"></span>
						</VSCodeButton>
					</div>
				</div>

				<div
					style={{
						marginTop: "20px",
						paddingBottom: "60px",
						borderBottom: "1px solid var(--vscode-input-border)",
					}}>
					<h3 style={{ color: "var(--vscode-foreground)", marginBottom: "12px" }}>Support Prompts</h3>
					<div
						style={{
							display: "flex",
							gap: "8px",
							alignItems: "center",
							marginBottom: "12px",
							flexWrap: "wrap",
							padding: "4px 0",
						}}>
						{Object.keys(supportPrompt.default).map((type) => (
							<button
								key={type}
								data-testid={`${type}-tab`}
								data-active={activeSupportTab === type ? "true" : "false"}
								onClick={() => setActiveSupportTab(type as SupportPromptType)}
								style={{
									padding: "4px 8px",
									border: "none",
									background: activeSupportTab === type ? "var(--vscode-button-background)" : "none",
									color:
										activeSupportTab === type
											? "var(--vscode-button-foreground)"
											: "var(--vscode-foreground)",
									cursor: "pointer",
									opacity: activeSupportTab === type ? 1 : 0.8,
									borderRadius: "3px",
									fontWeight: "bold",
								}}>
								{supportPromptLabels[type as SupportPromptType]}
							</button>
						))}
					</div>

					{/* Support prompt description */}
					<div
						style={{
							fontSize: "13px",
							color: "var(--vscode-descriptionForeground)",
							margin: "8px 0 16px",
						}}>
						{supportPromptDescriptions[activeSupportTab]}
					</div>

					{/* Show active tab content */}
					<div key={activeSupportTab}>
						<div
							style={{
								display: "flex",
								justifyContent: "space-between",
								alignItems: "center",
								marginBottom: "4px",
							}}>
							<div style={{ fontWeight: "bold" }}>Prompt</div>
							<VSCodeButton
								appearance="icon"
								onClick={() => handleSupportReset(activeSupportTab)}
								title={`Reset ${activeSupportTab} prompt to default`}>
								<span className="codicon codicon-discard"></span>
							</VSCodeButton>
						</div>

						<VSCodeTextArea
							value={getSupportPromptValue(activeSupportTab)}
							onChange={(e) => {
								const value =
									(e as CustomEvent)?.detail?.target?.value ||
									((e as any).target as HTMLTextAreaElement).value
								const trimmedValue = value.trim()
								updateSupportPrompt(activeSupportTab, trimmedValue || undefined)
							}}
							rows={6}
							resize="vertical"
							style={{ width: "100%" }}
						/>

						{activeSupportTab === "ENHANCE" && (
							<>
								<div>
									<div
										style={{
											color: "var(--vscode-foreground)",
											fontSize: "13px",
											marginBottom: "20px",
											marginTop: "5px",
										}}></div>
									<div style={{ marginBottom: "12px" }}>
										<div style={{ marginBottom: "8px" }}>
											<div style={{ fontWeight: "bold", marginBottom: "4px" }}>
												API Configuration
											</div>
											<div
												style={{
													fontSize: "13px",
													color: "var(--vscode-descriptionForeground)",
												}}>
												You can select an API configuration to always use for enhancing prompts,
												or just use whatever is currently selected
											</div>
										</div>
										<VSCodeDropdown
											value={enhancementApiConfigId || ""}
											data-testid="api-config-dropdown"
											onChange={(e: any) => {
												const value = e.detail?.target?.value || e.target?.value
												setEnhancementApiConfigId(value)
												vscode.postMessage({
													type: "enhancementApiConfigId",
													text: value,
												})
											}}
											style={{ width: "300px" }}>
											<VSCodeOption value="">
												Use currently selected API configuration
											</VSCodeOption>
											{(listApiConfigMeta || []).map((config) => (
												<VSCodeOption key={config.id} value={config.id}>
													{config.name}
												</VSCodeOption>
											))}
										</VSCodeDropdown>
									</div>
								</div>

								<div style={{ marginTop: "12px" }}>
									<VSCodeTextArea
										value={testPrompt}
										onChange={(e) => setTestPrompt((e.target as HTMLTextAreaElement).value)}
										placeholder="Enter a prompt to test the enhancement"
										rows={3}
										resize="vertical"
										style={{ width: "100%" }}
										data-testid="test-prompt-textarea"
									/>
									<div
										style={{
											marginTop: "8px",
											display: "flex",
											justifyContent: "flex-start",
											alignItems: "center",
											gap: 8,
										}}>
										<VSCodeButton
											onClick={handleTestEnhancement}
											disabled={isEnhancing}
											appearance="primary">
											Preview Prompt Enhancement
										</VSCodeButton>
									</div>
								</div>
							</>
						)}
					</div>
				</div>
			</div>

			{isCreateModeDialogOpen && (
				<div
					style={{
						position: "fixed",
						inset: 0,
						display: "flex",
						justifyContent: "flex-end",
						backgroundColor: "rgba(0, 0, 0, 0.5)",
						zIndex: 1000,
					}}>
					<div
						style={{
							width: "calc(100vw - 100px)",
							height: "100%",
							backgroundColor: "var(--vscode-editor-background)",
							boxShadow: "-2px 0 5px rgba(0, 0, 0, 0.2)",
							display: "flex",
							flexDirection: "column",
							position: "relative",
						}}>
						<div
							style={{
								flex: 1,
								padding: "20px",
								overflowY: "auto",
								minHeight: 0,
							}}>
							<VSCodeButton
								appearance="icon"
								onClick={() => setIsCreateModeDialogOpen(false)}
								style={{
									position: "absolute",
									top: "20px",
									right: "20px",
								}}>
								<span className="codicon codicon-close"></span>
							</VSCodeButton>
							<h2 style={{ margin: "0 0 16px" }}>Create New Mode</h2>
							<div style={{ marginBottom: "16px" }}>
								<div style={{ fontWeight: "bold", marginBottom: "4px" }}>Name</div>
								<VSCodeTextField
									value={newModeName}
									onChange={(e: Event | React.FormEvent<HTMLElement>) => {
										const target =
											(e as CustomEvent)?.detail?.target ||
											((e as any).target as HTMLInputElement)
										handleNameChange(target.value)
									}}
									style={{ width: "100%" }}
								/>
								{nameError && (
									<div className="text-xs text-vscode-errorForeground mt-1">{nameError}</div>
								)}
							</div>
							<div style={{ marginBottom: "16px" }}>
								<div style={{ fontWeight: "bold", marginBottom: "4px" }}>Slug</div>
								<VSCodeTextField
									value={newModeSlug}
									onChange={(e: Event | React.FormEvent<HTMLElement>) => {
										const target =
											(e as CustomEvent)?.detail?.target ||
											((e as any).target as HTMLInputElement)
										setNewModeSlug(target.value)
									}}
									style={{ width: "100%" }}
								/>
								<div
									style={{
										fontSize: "12px",
										color: "var(--vscode-descriptionForeground)",
										marginTop: "4px",
									}}>
									The slug is used in URLs and file names. It should be lowercase and contain only
									letters, numbers, and hyphens.
								</div>
								{slugError && (
									<div className="text-xs text-vscode-errorForeground mt-1">{slugError}</div>
								)}
							</div>
							<div style={{ marginBottom: "16px" }}>
								<div style={{ fontWeight: "bold", marginBottom: "4px" }}>Save Location</div>
								<div className="text-sm text-vscode-descriptionForeground mb-2">
									Choose where to save this mode. Project-specific modes take precedence over global
									modes.
								</div>
								<VSCodeRadioGroup
									value={newModeSource}
									onChange={(e: Event | React.FormEvent<HTMLElement>) => {
										const target = ((e as CustomEvent)?.detail?.target ||
											(e.target as HTMLInputElement)) as HTMLInputElement
										setNewModeSource(target.value as ModeSource)
									}}>
									<VSCodeRadio value="global">
										Global
										<div
											style={{
												fontSize: "12px",
												color: "var(--vscode-descriptionForeground)",
												marginTop: "2px",
											}}>
											Available in all workspaces
										</div>
									</VSCodeRadio>
									<VSCodeRadio value="project">
										Project-specific (.roomodes)
										<div className="text-xs text-vscode-descriptionForeground mt-0.5">
											Only available in this workspace, takes precedence over global
										</div>
									</VSCodeRadio>
								</VSCodeRadioGroup>
							</div>

							<div style={{ marginBottom: "16px" }}>
								<div style={{ fontWeight: "bold", marginBottom: "4px" }}>Role Definition</div>
								<div
									style={{
										fontSize: "13px",
										color: "var(--vscode-descriptionForeground)",
										marginBottom: "8px",
									}}>
									Define Roo's expertise and personality for this mode.
								</div>
								<VSCodeTextArea
									value={newModeRoleDefinition}
									onChange={(e) => {
										const value =
											(e as CustomEvent)?.detail?.target?.value ||
											((e as any).target as HTMLTextAreaElement).value
										setNewModeRoleDefinition(value)
									}}
									rows={4}
									resize="vertical"
									style={{ width: "100%" }}
								/>
								{roleDefinitionError && (
									<div className="text-xs text-vscode-errorForeground mt-1">
										{roleDefinitionError}
									</div>
								)}
							</div>
							<div style={{ marginBottom: "16px" }}>
								<div style={{ fontWeight: "bold", marginBottom: "4px" }}>Available Tools</div>
								<div
									style={{
										fontSize: "13px",
										color: "var(--vscode-descriptionForeground)",
										marginBottom: "8px",
									}}>
									Select which tools this mode can use.
								</div>
								<div
									style={{
										display: "grid",
										gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
										gap: "8px",
									}}>
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
											{GROUP_DISPLAY_NAMES[group]}
										</VSCodeCheckbox>
									))}
								</div>
								{groupsError && (
									<div className="text-xs text-vscode-errorForeground mt-1">{groupsError}</div>
								)}
							</div>
							<div style={{ marginBottom: "16px" }}>
								<div style={{ fontWeight: "bold", marginBottom: "4px" }}>
									Custom Instructions (optional)
								</div>
								<div
									style={{
										fontSize: "13px",
										color: "var(--vscode-descriptionForeground)",
										marginBottom: "8px",
									}}>
									Add behavioral guidelines specific to this mode.
								</div>
								<VSCodeTextArea
									value={newModeCustomInstructions}
									onChange={(e) => {
										const value =
											(e as CustomEvent)?.detail?.target?.value ||
											((e as any).target as HTMLTextAreaElement).value
										setNewModeCustomInstructions(value)
									}}
									rows={4}
									resize="vertical"
									style={{ width: "100%" }}
								/>
							</div>
						</div>
						<div
							style={{
								display: "flex",
								justifyContent: "flex-end",
								padding: "12px 20px",
								gap: "8px",
								borderTop: "1px solid var(--vscode-editor-lineHighlightBorder)",
								backgroundColor: "var(--vscode-editor-background)",
							}}>
							<VSCodeButton onClick={() => setIsCreateModeDialogOpen(false)}>Cancel</VSCodeButton>
							<VSCodeButton appearance="primary" onClick={handleCreateMode}>
								Create Mode
							</VSCodeButton>
						</div>
					</div>
				</div>
			)}
			{isDialogOpen && (
				<div
					style={{
						position: "fixed",
						inset: 0,
						display: "flex",
						justifyContent: "flex-end",
						backgroundColor: "rgba(0, 0, 0, 0.5)",
						zIndex: 1000,
					}}>
					<div
						style={{
							width: "calc(100vw - 100px)",
							height: "100%",
							backgroundColor: "var(--vscode-editor-background)",
							boxShadow: "-2px 0 5px rgba(0, 0, 0, 0.2)",
							display: "flex",
							flexDirection: "column",
							position: "relative",
						}}>
						<div
							style={{
								flex: 1,
								padding: "20px",
								overflowY: "auto",
								minHeight: 0,
							}}>
							<VSCodeButton
								appearance="icon"
								onClick={() => setIsDialogOpen(false)}
								style={{
									position: "absolute",
									top: "20px",
									right: "20px",
								}}>
								<span className="codicon codicon-close"></span>
							</VSCodeButton>
							<h2 style={{ margin: "0 0 16px" }}>{selectedPromptTitle}</h2>
							<pre
								style={{
									padding: "8px",
									whiteSpace: "pre-wrap",
									wordBreak: "break-word",
									fontFamily: "var(--vscode-editor-font-family)",
									fontSize: "var(--vscode-editor-font-size)",
									color: "var(--vscode-editor-foreground)",
									backgroundColor: "var(--vscode-editor-background)",
									border: "1px solid var(--vscode-editor-lineHighlightBorder)",
									borderRadius: "4px",
									overflowY: "auto",
								}}>
								{selectedPromptContent}
							</pre>
						</div>
						<div
							style={{
								display: "flex",
								justifyContent: "flex-end",
								padding: "12px 20px",
								borderTop: "1px solid var(--vscode-editor-lineHighlightBorder)",
								backgroundColor: "var(--vscode-editor-background)",
							}}>
							<VSCodeButton onClick={() => setIsDialogOpen(false)}>Close</VSCodeButton>
						</div>
					</div>
				</div>
			)}
		</div>
	)
}

export default PromptsView
