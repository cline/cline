import React, { useState, useEffect, useMemo, useCallback } from "react"
import {
	VSCodeButton,
	VSCodeTextArea,
	VSCodeDropdown,
	VSCodeOption,
	VSCodeTextField,
	VSCodeCheckbox,
} from "@vscode/webview-ui-toolkit/react"
import { useExtensionState } from "../../context/ExtensionStateContext"
import {
	Mode,
	PromptComponent,
	getRoleDefinition,
	getAllModes,
	ModeConfig,
	enhancePrompt,
} from "../../../../src/shared/modes"
import { TOOL_GROUPS, GROUP_DISPLAY_NAMES, ToolGroup } from "../../../../src/shared/tool-groups"
import { vscode } from "../../utils/vscode"

// Get all available groups from GROUP_DISPLAY_NAMES
const availableGroups = Object.keys(TOOL_GROUPS) as ToolGroup[]

type PromptsViewProps = {
	onDone: () => void
}

const PromptsView = ({ onDone }: PromptsViewProps) => {
	const {
		customPrompts,
		listApiConfigMeta,
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
	const [isCreateModeDialogOpen, setIsCreateModeDialogOpen] = useState(false)

	// Direct update functions
	const updateAgentPrompt = useCallback(
		(mode: Mode, promptData: PromptComponent) => {
			const existingPrompt = customPrompts?.[mode]
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
		[customPrompts],
	)

	const updateCustomMode = useCallback((slug: string, modeConfig: ModeConfig) => {
		vscode.postMessage({
			type: "updateCustomMode",
			slug,
			modeConfig,
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
	const [newModeGroups, setNewModeGroups] = useState<readonly ToolGroup[]>(availableGroups)

	// Reset form fields when dialog opens
	useEffect(() => {
		if (isCreateModeDialogOpen) {
			setNewModeGroups(availableGroups)
			setNewModeRoleDefinition("")
			setNewModeCustomInstructions("")
		}
	}, [isCreateModeDialogOpen])

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
		if (!newModeName.trim() || !newModeSlug.trim()) return

		const newMode: ModeConfig = {
			slug: newModeSlug,
			name: newModeName,
			roleDefinition: newModeRoleDefinition.trim() || "",
			customInstructions: newModeCustomInstructions.trim() || undefined,
			groups: newModeGroups,
		}
		updateCustomMode(newModeSlug, newMode)
		switchMode(newModeSlug)
		setIsCreateModeDialogOpen(false)
		setNewModeName("")
		setNewModeSlug("")
		setNewModeRoleDefinition("")
		setNewModeCustomInstructions("")
		setNewModeGroups(availableGroups)
	}, [
		newModeName,
		newModeSlug,
		newModeRoleDefinition,
		newModeCustomInstructions,
		newModeGroups,
		updateCustomMode,
		switchMode,
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
				let newGroups: readonly ToolGroup[]
				if (checked) {
					newGroups = [...oldGroups, group]
				} else {
					newGroups = oldGroups.filter((g) => g !== group)
				}
				if (customMode) {
					updateCustomMode(customMode.slug, {
						...customMode,
						groups: newGroups,
					})
				}
			},
		[updateCustomMode],
	)

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

	const updateEnhancePrompt = (value: string | undefined) => {
		vscode.postMessage({
			type: "updateEnhancedPrompt",
			text: value,
		})
	}

	const handleEnhancePromptChange = (e: Event | React.FormEvent<HTMLElement>): void => {
		const value = (e as CustomEvent)?.detail?.target?.value || ((e as any).target as HTMLTextAreaElement).value
		const trimmedValue = value.trim()
		if (trimmedValue !== enhancePrompt.default) {
			updateEnhancePrompt(trimmedValue || enhancePrompt.default)
		}
	}

	const handleAgentReset = (modeSlug: string) => {
		// Only reset role definition for built-in modes
		const existingPrompt = customPrompts?.[modeSlug]
		updateAgentPrompt(modeSlug, {
			...existingPrompt,
			roleDefinition: undefined,
		})
	}

	const handleEnhanceReset = () => {
		updateEnhancePrompt(undefined)
	}

	const getEnhancePromptValue = (): string => {
		return enhancePrompt.get(customPrompts)
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
		<div
			style={{
				position: "fixed",
				top: 0,
				left: 0,
				right: 0,
				bottom: 0,
				display: "flex",
				flexDirection: "column",
			}}>
			<div
				style={{
					display: "flex",
					justifyContent: "space-between",
					alignItems: "center",
					padding: "10px 17px 10px 20px",
				}}>
				<h3 style={{ color: "var(--vscode-foreground)", margin: 0 }}>Prompts</h3>
				<VSCodeButton onClick={onDone}>Done</VSCodeButton>
			</div>

			<div style={{ flex: 1, overflow: "auto", padding: "0 20px" }}>
				<div style={{ marginBottom: "20px" }}>
					<div style={{ marginBottom: "20px" }}>
						<div style={{ fontWeight: "bold", marginBottom: "4px" }}>Preferred Language</div>
						<select
							value={preferredLanguage}
							onChange={(e) => {
								setPreferredLanguage(e.target.value)
								vscode.postMessage({
									type: "preferredLanguage",
									text: e.target.value,
								})
							}}
							style={{
								width: "100%",
								padding: "4px 8px",
								backgroundColor: "var(--vscode-input-background)",
								color: "var(--vscode-input-foreground)",
								border: "1px solid var(--vscode-input-border)",
								borderRadius: "2px",
								height: "28px",
							}}>
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
						<p
							style={{
								fontSize: "12px",
								marginTop: "5px",
								color: "var(--vscode-descriptionForeground)",
							}}>
							Select the language that Cline should use for communication.
						</p>
					</div>

					<div style={{ fontWeight: "bold", marginBottom: "4px" }}>Custom Instructions for All Modes</div>
					<div
						style={{ fontSize: "13px", color: "var(--vscode-descriptionForeground)", marginBottom: "8px" }}>
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
						style={{ width: "100%" }}
						data-testid="global-custom-instructions-textarea"
					/>
					<div style={{ fontSize: "12px", color: "var(--vscode-descriptionForeground)", marginTop: "5px" }}>
						Instructions can also be loaded from{" "}
						<span
							style={{
								color: "var(--vscode-textLink-foreground)",
								cursor: "pointer",
								textDecoration: "underline",
							}}
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

				<div style={{ marginBottom: "20px" }}>
					<div
						style={{
							display: "flex",
							justifyContent: "space-between",
							alignItems: "center",
							marginBottom: "12px",
						}}>
						<h3 style={{ color: "var(--vscode-foreground)", margin: 0 }}>Mode-Specific Prompts</h3>
						<div style={{ display: "flex", gap: "8px" }}>
							<VSCodeButton appearance="icon" onClick={openCreateModeDialog} title="Create new mode">
								<span className="codicon codicon-add"></span>
							</VSCodeButton>
							<VSCodeButton
								appearance="icon"
								title="Edit modes configuration"
								onClick={() => {
									vscode.postMessage({
										type: "openCustomModesSettings",
									})
								}}>
								<span className="codicon codicon-json"></span>
							</VSCodeButton>
						</div>
					</div>

					<div
						style={{
							fontSize: "13px",
							color: "var(--vscode-descriptionForeground)",
							marginBottom: "12px",
						}}>
						Hit the + to create a new custom mode, or just ask Roo in chat to create one for you!
					</div>

					<div
						style={{
							display: "flex",
							gap: "16px",
							alignItems: "center",
							marginBottom: "12px",
							overflowX: "auto",
							flexWrap: "nowrap",
							paddingBottom: "4px",
							paddingRight: "20px",
						}}>
						{modes.map((modeConfig) => {
							const isActive = mode === modeConfig.slug
							return (
								<button
									key={modeConfig.slug}
									data-testid={`${modeConfig.slug}-tab`}
									data-active={isActive ? "true" : "false"}
									onClick={() => handleModeSwitch(modeConfig)}
									style={{
										padding: "4px 8px",
										border: "none",
										background: isActive ? "var(--vscode-button-background)" : "none",
										color: isActive
											? "var(--vscode-button-foreground)"
											: "var(--vscode-foreground)",
										cursor: "pointer",
										opacity: isActive ? 1 : 0.8,
										borderRadius: "3px",
										fontWeight: "bold",
									}}>
									{modeConfig.name}
								</button>
							)
						})}
					</div>
				</div>

				<div style={{ marginBottom: "20px" }}>
					{/* Only show name and delete for custom modes */}
					{mode && findModeBySlug(mode, customModes) && (
						<div style={{ display: "flex", gap: "12px", marginBottom: "16px" }}>
							<div style={{ flex: 1 }}>
								<div style={{ fontWeight: "bold", marginBottom: "4px" }}>Name</div>
								<div style={{ display: "flex", gap: "8px" }}>
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
												})
											}
										}}
										style={{ width: "100%" }}
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
						<div
							style={{
								display: "flex",
								justifyContent: "space-between",
								alignItems: "center",
								marginBottom: "4px",
							}}>
							<div style={{ fontWeight: "bold" }}>Role Definition</div>
							{!findModeBySlug(mode, customModes) && (
								<VSCodeButton
									appearance="icon"
									onClick={() => {
										const currentMode = getCurrentMode()
										if (currentMode?.slug) {
											handleAgentReset(currentMode.slug)
										}
									}}
									title="Reset to default"
									data-testid="role-definition-reset">
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
							Define Roo's expertise and personality for this mode. This description shapes how Roo
							presents itself and approaches tasks.
						</div>
						<VSCodeTextArea
							value={(() => {
								const customMode = findModeBySlug(mode, customModes)
								const prompt = customPrompts?.[mode]
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
						{/* Show tools for all modes */}
						<div style={{ marginBottom: "16px" }}>
							<div
								style={{
									display: "flex",
									justifyContent: "space-between",
									alignItems: "center",
									marginBottom: "4px",
								}}>
								<div style={{ fontWeight: "bold" }}>Available Tools</div>
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
								<div
									style={{
										fontSize: "13px",
										color: "var(--vscode-descriptionForeground)",
										marginBottom: "8px",
									}}>
									Tools for built-in modes cannot be modified
								</div>
							)}
							{isToolsEditMode && findModeBySlug(mode, customModes) ? (
								<div
									style={{
										display: "grid",
										gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
										gap: "8px",
									}}>
									{availableGroups.map((group) => {
										const currentMode = getCurrentMode()
										const isCustomMode = findModeBySlug(mode, customModes)
										const customMode = isCustomMode
										const isGroupEnabled = isCustomMode
											? customMode?.groups?.includes(group)
											: currentMode?.groups?.includes(group)

										return (
											<VSCodeCheckbox
												key={group}
												checked={isGroupEnabled}
												onChange={handleGroupChange(group, Boolean(isCustomMode), customMode)}
												disabled={!isCustomMode}>
												{GROUP_DISPLAY_NAMES[group]}
											</VSCodeCheckbox>
										)
									})}
								</div>
							) : (
								<div
									style={{
										fontSize: "13px",
										color: "var(--vscode-foreground)",
										marginBottom: "8px",
										lineHeight: "1.4",
									}}>
									{(() => {
										const currentMode = getCurrentMode()
										const enabledGroups = currentMode?.groups || []
										return enabledGroups.map((group) => GROUP_DISPLAY_NAMES[group]).join(", ")
									})()}
								</div>
							)}
						</div>
					</>

					{/* Role definition for both built-in and custom modes */}
					<div style={{ marginBottom: "8px" }}>
						<div style={{ fontWeight: "bold", marginBottom: "4px" }}>Mode-specific Custom Instructions</div>
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
								const prompt = customPrompts?.[mode]
								return customMode?.customInstructions ?? prompt?.customInstructions ?? ""
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
									})
								} else {
									// For built-in modes, update the prompts
									const existingPrompt = customPrompts?.[mode]
									updateAgentPrompt(mode, {
										...existingPrompt,
										customInstructions: value.trim() || undefined,
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
				<div style={{ marginBottom: "20px", display: "flex", justifyContent: "flex-start" }}>
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
				</div>

				<h3 style={{ color: "var(--vscode-foreground)", margin: "40px 0 20px 0" }}>Prompt Enhancement</h3>

				<div
					style={{
						color: "var(--vscode-foreground)",
						fontSize: "13px",
						marginBottom: "20px",
						marginTop: "5px",
					}}>
					Use prompt enhancement to get tailored suggestions or improvements for your inputs. This ensures Roo
					understands your intent and provides the best possible responses.
				</div>

				<div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
					<div>
						<div style={{ marginBottom: "12px" }}>
							<div style={{ marginBottom: "8px" }}>
								<div style={{ fontWeight: "bold", marginBottom: "4px" }}>API Configuration</div>
								<div style={{ fontSize: "13px", color: "var(--vscode-descriptionForeground)" }}>
									You can select an API configuration to always use for enhancing prompts, or just use
									whatever is currently selected
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
								<VSCodeOption value="">Use currently selected API configuration</VSCodeOption>
								{(listApiConfigMeta || []).map((config) => (
									<VSCodeOption key={config.id} value={config.id}>
										{config.name}
									</VSCodeOption>
								))}
							</VSCodeDropdown>
						</div>

						<div style={{ marginBottom: "8px" }}>
							<div
								style={{
									display: "flex",
									justifyContent: "space-between",
									alignItems: "center",
									marginBottom: "4px",
								}}>
								<div style={{ fontWeight: "bold" }}>Enhancement Prompt</div>
								<div style={{ display: "flex", gap: "8px" }}>
									<VSCodeButton
										appearance="icon"
										onClick={handleEnhanceReset}
										title="Revert to default">
										<span className="codicon codicon-discard"></span>
									</VSCodeButton>
								</div>
							</div>
							<div
								style={{
									fontSize: "13px",
									color: "var(--vscode-descriptionForeground)",
									marginBottom: "8px",
								}}>
								This prompt will be used to refine your input when you hit the sparkle icon in chat.
							</div>
						</div>
						<VSCodeTextArea
							value={getEnhancePromptValue()}
							onChange={handleEnhancePromptChange}
							rows={4}
							resize="vertical"
							style={{ width: "100%" }}
						/>

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
					</div>
				</div>

				{/* Bottom padding */}
				<div style={{ height: "20px" }} />
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
											checked={newModeGroups.includes(group)}
											onChange={(e: Event | React.FormEvent<HTMLElement>) => {
												const target =
													(e as CustomEvent)?.detail?.target || (e.target as HTMLInputElement)
												const checked = target.checked
												if (checked) {
													setNewModeGroups([...newModeGroups, group])
												} else {
													setNewModeGroups(newModeGroups.filter((g) => g !== group))
												}
											}}>
											{GROUP_DISPLAY_NAMES[group]}
										</VSCodeCheckbox>
									))}
								</div>
							</div>
							<div style={{ marginBottom: "16px" }}>
								<div style={{ fontWeight: "bold", marginBottom: "4px" }}>Custom Instructions</div>
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
							<VSCodeButton
								appearance="primary"
								onClick={handleCreateMode}
								disabled={!newModeName.trim() || !newModeSlug.trim()}>
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
