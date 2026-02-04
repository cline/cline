import * as proto from "@shared/proto/index"
import { VSCodeButton, VSCodeCheckbox, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { AlertCircle, Check, Edit, FolderOpen, MessageSquare, Plus, RefreshCw, Save, Trash2, X } from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { cn } from "@/lib/utils"
import { PromptsServiceClient } from "@/services/grpc-client"
import Section from "../Section"

/**
 * Tool groups for granular tool selection in custom prompts.
 * These map to the backend TOOL_GROUPS constant in SystemPromptsManager.ts
 * Keys use @ prefix for group notation in YAML frontmatter.
 */
const TOOL_GROUPS: Record<string, readonly string[]> = {
	"@filesystem": [
		"read_file",
		"write_to_file",
		"replace_in_file",
		"list_files",
		"search_files",
		"list_code_definition_names",
		"apply_patch",
	],
	"@browser": ["browser_action"],
	"@web": ["web_fetch", "web_search"],
	"@terminal": ["execute_command"],
	"@mcp": ["use_mcp_tool", "access_mcp_resource", "load_mcp_documentation"],
	"@communication": ["ask_followup_question", "attempt_completion"],
	"@task": ["new_task", "plan_mode_respond", "act_mode_respond", "focus_chain"],
	"@utility": ["generate_explanation", "use_skill"],
} as const

interface SystemPromptsSectionProps {
	renderSectionHeader: (tabId: string) => JSX.Element | null
}

interface PromptFormData {
	id: string
	name: string
	description: string
	content: string
	enabledTools: string[]
	disabledTools: string[]
	includeToolInstructions: boolean
	includeEditingGuidelines: boolean
	includeBrowserRules: boolean
	includeMcpSection: boolean
	includeUserInstructions: boolean
	includeRules: boolean
	includeSystemInfo: boolean
}

const defaultFormData: PromptFormData = {
	id: "",
	name: "",
	description: "",
	content: "",
	enabledTools: [],
	disabledTools: [],
	includeToolInstructions: true,
	includeEditingGuidelines: true,
	includeBrowserRules: true,
	includeMcpSection: true,
	includeUserInstructions: true,
	includeRules: true,
	includeSystemInfo: true,
}

const SystemPromptsSection = ({ renderSectionHeader }: SystemPromptsSectionProps) => {
	const [prompts, setPrompts] = useState<proto.cline.SystemPromptInfo[]>([])
	const [activePromptId, setActivePromptId] = useState<string>("default")
	const [promptsDirectory, setPromptsDirectory] = useState<string>("")
	const [selectedPromptId, setSelectedPromptId] = useState<string | null>(null)
	const [isEditing, setIsEditing] = useState(false)
	const [isCreating, setIsCreating] = useState(false)
	const [isLoading, setIsLoading] = useState(true)
	const [isSaving, setIsSaving] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [successMessage, setSuccessMessage] = useState<string | null>(null)
	const [formData, setFormData] = useState<PromptFormData>(defaultFormData)

	// Load prompts from backend
	const loadPrompts = useCallback(async () => {
		try {
			setIsLoading(true)
			setError(null)

			const response = await PromptsServiceClient.listPrompts(proto.cline.EmptyRequest.create({}))

			setPrompts(response.prompts || [])
			setActivePromptId(response.activePromptId || "default")
			setPromptsDirectory(response.promptsDirectory || "")
		} catch (err) {
			const errorMessage = err instanceof Error ? err.message : "Failed to load prompts"
			setError(errorMessage)
			console.error("Error loading prompts:", err)
		} finally {
			setIsLoading(false)
		}
	}, [])

	// Activate a prompt
	const handleActivatePrompt = useCallback(async (promptId: string) => {
		try {
			setError(null)
			await PromptsServiceClient.activatePrompt(proto.cline.StringRequest.create({ value: promptId }))
			setActivePromptId(promptId)
			const message =
				promptId === "default"
					? "Default prompt activated. Start a new task to apply."
					: `Prompt "${promptId}" activated. Start a new task to apply the custom prompt.`
			setSuccessMessage(message)
			setTimeout(() => setSuccessMessage(null), 5000)
		} catch (err) {
			const errorMessage = err instanceof Error ? err.message : "Failed to activate prompt"
			setError(errorMessage)
		}
	}, [])

	// Start editing a prompt
	const startEditing = useCallback(async (promptId: string) => {
		try {
			setError(null)
			const response = await PromptsServiceClient.getPrompt(proto.cline.StringRequest.create({ value: promptId }))

			if (response.prompt) {
				const prompt = response.prompt
				setFormData({
					id: prompt.id,
					name: prompt.metadata?.name || prompt.name,
					description: prompt.metadata?.description || prompt.description || "",
					content: response.rawContent || response.content || "",
					enabledTools: prompt.metadata?.tools?.enabled || [],
					disabledTools: prompt.metadata?.tools?.disabled || [],
					includeToolInstructions: prompt.metadata?.includeToolInstructions ?? true,
					includeEditingGuidelines: prompt.metadata?.includeEditingGuidelines ?? true,
					includeBrowserRules: prompt.metadata?.includeBrowserRules ?? true,
					includeMcpSection: prompt.metadata?.includeMcpSection ?? true,
					includeUserInstructions: prompt.metadata?.includeUserInstructions ?? true,
					includeRules: prompt.metadata?.includeRules ?? true,
					includeSystemInfo: prompt.metadata?.includeSystemInfo ?? true,
				})
				setSelectedPromptId(promptId)
				setIsEditing(true)
				setIsCreating(false)
			}
		} catch (err) {
			const errorMessage = err instanceof Error ? err.message : "Failed to load prompt"
			setError(errorMessage)
		}
	}, [])

	// Start creating a new prompt
	const startCreating = useCallback(() => {
		setFormData(defaultFormData)
		setSelectedPromptId(null)
		setIsEditing(false)
		setIsCreating(true)
		setError(null)
	}, [])

	// Build YAML frontmatter content
	const buildPromptContent = useCallback((data: PromptFormData): string => {
		const lines: string[] = ["---"]

		lines.push(`name: "${data.name}"`)
		if (data.description) {
			lines.push(`description: "${data.description}"`)
		}

		// Tool configuration
		if (data.enabledTools.length > 0 || data.disabledTools.length > 0) {
			lines.push("tools:")
			if (data.enabledTools.length > 0) {
				lines.push("  enabled:")
				data.enabledTools.forEach((t) => lines.push(`    - "${t}"`))
			}
			if (data.disabledTools.length > 0) {
				lines.push("  disabled:")
				data.disabledTools.forEach((t) => lines.push(`    - "${t}"`))
			}
		}

		// Component flags
		lines.push(`includeToolInstructions: ${data.includeToolInstructions}`)
		lines.push(`includeEditingGuidelines: ${data.includeEditingGuidelines}`)
		lines.push(`includeBrowserRules: ${data.includeBrowserRules}`)
		lines.push(`includeMcpSection: ${data.includeMcpSection}`)
		lines.push(`includeUserInstructions: ${data.includeUserInstructions}`)
		lines.push(`includeRules: ${data.includeRules}`)
		lines.push(`includeSystemInfo: ${data.includeSystemInfo}`)

		lines.push("---")
		lines.push("")
		lines.push(data.content)

		return lines.join("\n")
	}, [])

	// Save prompt (create or update)
	const savePrompt = useCallback(async () => {
		try {
			if (!formData.name.trim()) {
				setError("Name is required")
				return
			}

			setIsSaving(true)
			setError(null)

			const fullContent = buildPromptContent(formData)

			if (isCreating) {
				// Create new prompt
				const response = await PromptsServiceClient.createPrompt(
					proto.cline.CreatePromptRequest.create({
						name: formData.name,
						content: formData.content,
						description: formData.description,
						metadata: {
							tools: {
								enabled: formData.enabledTools,
								disabled: formData.disabledTools,
							},
							includeToolInstructions: formData.includeToolInstructions,
							includeEditingGuidelines: formData.includeEditingGuidelines,
							includeBrowserRules: formData.includeBrowserRules,
							includeMcpSection: formData.includeMcpSection,
							includeUserInstructions: formData.includeUserInstructions,
							includeRules: formData.includeRules,
							includeSystemInfo: formData.includeSystemInfo,
						},
					}),
				)

				if (!response.success) {
					setError(response.error || "Failed to create prompt")
					return
				}

				setSuccessMessage(`Prompt "${formData.name}" created successfully`)
			} else {
				// Update existing prompt
				const response = await PromptsServiceClient.updatePrompt(
					proto.cline.UpdatePromptRequest.create({
						id: formData.id,
						content: fullContent,
					}),
				)

				if (!response.value) {
					setError("Failed to update prompt")
					return
				}

				setSuccessMessage(`Prompt "${formData.name}" updated successfully`)
			}

			// Reload prompts and reset state
			await loadPrompts()
			setIsEditing(false)
			setIsCreating(false)
			setSelectedPromptId(null)
			setTimeout(() => setSuccessMessage(null), 3000)
		} catch (err) {
			const errorMessage = err instanceof Error ? err.message : "Failed to save prompt"
			setError(errorMessage)
		} finally {
			setIsSaving(false)
		}
	}, [formData, isCreating, buildPromptContent, loadPrompts])

	// Delete prompt
	const handleDeletePrompt = useCallback(
		async (promptId: string) => {
			if (!confirm(`Are you sure you want to delete "${promptId}"?`)) {
				return
			}

			try {
				setError(null)
				const response = await PromptsServiceClient.deletePrompt(proto.cline.StringRequest.create({ value: promptId }))

				if (!response.value) {
					setError("Failed to delete prompt")
					return
				}

				setSuccessMessage(`Prompt "${promptId}" deleted`)
				await loadPrompts()
				setTimeout(() => setSuccessMessage(null), 3000)

				// If we were editing this prompt, close the editor
				if (selectedPromptId === promptId) {
					setIsEditing(false)
					setIsCreating(false)
					setSelectedPromptId(null)
				}
			} catch (err) {
				const errorMessage = err instanceof Error ? err.message : "Failed to delete prompt"
				setError(errorMessage)
			}
		},
		[selectedPromptId, loadPrompts],
	)

	// Open prompts directory
	const openPromptsDirectory = useCallback(async () => {
		try {
			await PromptsServiceClient.openPromptsDirectory(proto.cline.EmptyRequest.create({}))
		} catch (err) {
			console.error("Failed to open prompts directory:", err)
		}
	}, [])

	// Cancel editing
	const cancelEditing = useCallback(() => {
		setIsEditing(false)
		setIsCreating(false)
		setSelectedPromptId(null)
		setFormData(defaultFormData)
		setError(null)
	}, [])

	// Toggle tool group
	const toggleToolGroup = useCallback((groupId: string) => {
		setFormData((prev) => {
			const isEnabled = prev.enabledTools.includes(groupId)
			if (isEnabled) {
				return {
					...prev,
					enabledTools: prev.enabledTools.filter((t) => t !== groupId),
				}
			} else {
				return {
					...prev,
					enabledTools: [...prev.enabledTools, groupId],
					disabledTools: prev.disabledTools.filter((t) => t !== groupId),
				}
			}
		})
	}, [])

	// Toggle component flag
	const toggleComponentFlag = useCallback((key: keyof PromptFormData) => {
		setFormData((prev) => ({
			...prev,
			[key]: !prev[key],
		}))
	}, [])

	// Load data on mount
	useEffect(() => {
		loadPrompts()
	}, [loadPrompts])

	return (
		<div className="system-prompts-section">
			{renderSectionHeader("system-prompts")}

			{/* Status Messages */}
			{error && (
				<div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-md flex items-center gap-2">
					<AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
					<span className="text-red-400 text-sm">{error}</span>
				</div>
			)}

			{successMessage && (
				<div className="mb-4 p-3 bg-green-500/10 border border-green-500/30 rounded-md flex items-center gap-2">
					<Check className="w-4 h-4 text-green-500 shrink-0" />
					<span className="text-green-400 text-sm">{successMessage}</span>
				</div>
			)}

			<div className="flex gap-4 h-full">
				{/* Prompts List */}
				<div className="w-1/3 border-r border-[var(--vscode-panel-border)] pr-4">
					<div className="flex justify-between items-center mb-4">
						<h3 className="text-base font-medium">Custom Prompts</h3>
						<div className="flex gap-1">
							<VSCodeButton appearance="icon" onClick={loadPrompts} title="Refresh">
								<RefreshCw className="w-4 h-4" />
							</VSCodeButton>
							<VSCodeButton appearance="icon" onClick={openPromptsDirectory} title="Open Directory">
								<FolderOpen className="w-4 h-4" />
							</VSCodeButton>
							<VSCodeButton onClick={startCreating}>
								<Plus className="w-4 h-4 mr-1" />
								New
							</VSCodeButton>
						</div>
					</div>

					{isLoading ? (
						<div className="text-center py-8 text-[var(--vscode-descriptionForeground)]">Loading prompts...</div>
					) : (
						<div className="space-y-2">
							{/* Default Option */}
							<div
								className={cn(
									"p-3 border rounded-md cursor-pointer transition-colors",
									"border-[var(--vscode-panel-border)]",
									activePromptId === "default"
										? "bg-[var(--vscode-list-activeSelectionBackground)] border-[var(--vscode-focusBorder)]"
										: "hover:bg-[var(--vscode-list-hoverBackground)]",
								)}
								onClick={() => handleActivatePrompt("default")}>
								<div className="flex items-center gap-2">
									<MessageSquare className="w-4 h-4" />
									<span className="font-medium flex-1">Default Cline</span>
									{activePromptId === "default" && (
										<Check className="w-4 h-4 text-[var(--vscode-charts-green)]" />
									)}
								</div>
								<p className="text-xs text-[var(--vscode-descriptionForeground)] mt-1">Original Cline behavior</p>
							</div>

							{/* Custom Prompts */}
							{prompts.length === 0 ? (
								<div className="text-center py-6 text-[var(--vscode-descriptionForeground)]">
									<MessageSquare className="w-10 h-10 mx-auto mb-2 opacity-50" />
									<p className="text-sm">No custom prompts yet</p>
									<p className="text-xs">Click "New" to create one</p>
								</div>
							) : (
								prompts.map((prompt) => (
									<div
										className={cn(
											"p-3 border rounded-md cursor-pointer transition-colors group",
											"border-[var(--vscode-panel-border)]",
											activePromptId === prompt.id
												? "bg-[var(--vscode-list-activeSelectionBackground)] border-[var(--vscode-focusBorder)]"
												: "hover:bg-[var(--vscode-list-hoverBackground)]",
											selectedPromptId === prompt.id && "ring-1 ring-[var(--vscode-focusBorder)]",
										)}
										key={prompt.id}>
										<div className="flex items-center justify-between">
											<div
												className="flex items-center gap-2 flex-1 min-w-0"
												onClick={() => handleActivatePrompt(prompt.id)}>
												<MessageSquare className="w-4 h-4 shrink-0" />
												<div className="flex-1 min-w-0">
													<div className="font-medium truncate">{prompt.name}</div>
													{prompt.description && (
														<p className="text-xs text-[var(--vscode-descriptionForeground)] truncate">
															{prompt.description}
														</p>
													)}
												</div>
												{activePromptId === prompt.id && (
													<Check className="w-4 h-4 text-[var(--vscode-charts-green)] shrink-0" />
												)}
											</div>
											<div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity ml-2">
												<VSCodeButton
													appearance="icon"
													onClick={(e) => {
														e.stopPropagation()
														startEditing(prompt.id)
													}}
													title="Edit">
													<Edit className="w-3 h-3" />
												</VSCodeButton>
												<VSCodeButton
													appearance="icon"
													onClick={(e) => {
														e.stopPropagation()
														handleDeletePrompt(prompt.id)
													}}
													title="Delete">
													<Trash2 className="w-3 h-3" />
												</VSCodeButton>
											</div>
										</div>
									</div>
								))
							)}
						</div>
					)}
				</div>

				{/* Editor Panel */}
				<div className="flex-1 pl-2">
					{isEditing || isCreating ? (
						<div className="h-full flex flex-col">
							<div className="flex justify-between items-center mb-4">
								<h3 className="text-base font-medium">{isCreating ? "Create Prompt" : "Edit Prompt"}</h3>
								<div className="flex gap-2">
									<VSCodeButton disabled={isSaving} onClick={savePrompt}>
										<Save className="w-4 h-4 mr-1" />
										{isSaving ? "Saving..." : "Save"}
									</VSCodeButton>
									<VSCodeButton appearance="secondary" onClick={cancelEditing}>
										<X className="w-4 h-4 mr-1" />
										Cancel
									</VSCodeButton>
								</div>
							</div>

							<div className="space-y-4 flex-1 overflow-auto">
								{/* Basic Info */}
								<Section>
									<div className="border-b border-[var(--vscode-panel-border)] pb-2 mb-3">
										<h4 className="font-medium text-sm">Basic Information</h4>
									</div>
									<div className="space-y-3">
										<div>
											<label className="block text-xs font-medium mb-1">Name *</label>
											<VSCodeTextField
												className="w-full"
												onInput={(e) =>
													setFormData((prev) => ({
														...prev,
														name: (e.target as HTMLInputElement).value,
													}))
												}
												placeholder="Enter prompt name..."
												value={formData.name}
											/>
										</div>
										<div>
											<label className="block text-xs font-medium mb-1">Description</label>
											<VSCodeTextField
												className="w-full"
												onInput={(e) =>
													setFormData((prev) => ({
														...prev,
														description: (e.target as HTMLInputElement).value,
													}))
												}
												placeholder="Brief description..."
												value={formData.description}
											/>
										</div>
									</div>
								</Section>

								{/* Tool Configuration */}
								<Section>
									<div className="border-b border-[var(--vscode-panel-border)] pb-2 mb-3">
										<h4 className="font-medium text-sm">Tool Groups</h4>
										<p className="text-xs text-[var(--vscode-descriptionForeground)]">
											Select which tool groups to enable
										</p>
									</div>
									<div className="grid grid-cols-2 gap-2">
										{Object.entries(TOOL_GROUPS).map(([groupId, tools]) => (
											<label
												className="flex items-center gap-2 p-2 border border-[var(--vscode-panel-border)] rounded cursor-pointer hover:bg-[var(--vscode-list-hoverBackground)]"
												key={groupId}>
												<VSCodeCheckbox
													checked={formData.enabledTools.includes(groupId)}
													onChange={() => toggleToolGroup(groupId)}
												/>
												<span className="text-xs font-mono">{groupId}</span>
												<span className="text-xs text-[var(--vscode-descriptionForeground)]">
													({tools.length})
												</span>
											</label>
										))}
									</div>
								</Section>

								{/* Component Settings */}
								<Section>
									<div className="border-b border-[var(--vscode-panel-border)] pb-2 mb-3">
										<h4 className="font-medium text-sm">Component Settings</h4>
										<p className="text-xs text-[var(--vscode-descriptionForeground)]">
											Toggle system prompt components
										</p>
									</div>
									<div className="grid grid-cols-2 gap-2">
										{[
											{ key: "includeToolInstructions" as const, label: "Tool Instructions" },
											{ key: "includeEditingGuidelines" as const, label: "Editing Guidelines" },
											{ key: "includeBrowserRules" as const, label: "Browser Rules" },
											{ key: "includeMcpSection" as const, label: "MCP Section" },
											{ key: "includeUserInstructions" as const, label: "User Instructions" },
											{ key: "includeRules" as const, label: "Rules Section" },
											{ key: "includeSystemInfo" as const, label: "System Info" },
										].map(({ key, label }) => (
											<label className="flex items-center gap-2 cursor-pointer" key={key}>
												<VSCodeCheckbox
													checked={formData[key] as boolean}
													onChange={() => toggleComponentFlag(key)}
												/>
												<span className="text-xs">{label}</span>
											</label>
										))}
									</div>
								</Section>

								{/* Content */}
								<Section>
									<div className="border-b border-[var(--vscode-panel-border)] pb-2 mb-3">
										<h4 className="font-medium text-sm">Prompt Content</h4>
										<p className="text-xs text-[var(--vscode-descriptionForeground)]">
											Custom instructions (Markdown supported)
										</p>
									</div>
									<textarea
										className="w-full h-48 p-3 bg-[var(--vscode-input-background)] text-[var(--vscode-input-foreground)] border border-[var(--vscode-input-border)] rounded font-mono text-xs resize-none focus:outline-none focus:border-[var(--vscode-focusBorder)]"
										onChange={(e) =>
											setFormData((prev) => ({
												...prev,
												content: e.target.value,
											}))
										}
										placeholder="Enter your custom prompt content..."
										value={formData.content}
									/>
								</Section>
							</div>
						</div>
					) : (
						<div className="h-full flex items-center justify-center text-[var(--vscode-descriptionForeground)]">
							<div className="text-center">
								<MessageSquare className="w-12 h-12 mx-auto mb-3 opacity-40" />
								<h3 className="text-base font-medium mb-1">Select a Prompt</h3>
								<p className="text-sm">Choose a prompt to view or edit, or create a new one</p>
							</div>
						</div>
					)}
				</div>
			</div>
		</div>
	)
}

export default SystemPromptsSection
