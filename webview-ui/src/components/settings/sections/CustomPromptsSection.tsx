import { VSCodeButton, VSCodeRadio, VSCodeRadioGroup } from "@vscode/webview-ui-toolkit/react"
import { FolderOpen, RefreshCw } from "lucide-react"
import { memo, useCallback, useEffect, useState } from "react"
import { PLATFORM_CONFIG } from "@/config/platform.config"
import { Section } from "../Section"

interface SystemPrompt {
	id: string
	filename: string
	name: string
	description?: string
	enabled: boolean
}

interface CustomPromptsSectionProps {
	renderSectionHeader: (tabId: string) => JSX.Element | null
}

const DEFAULT_PROMPT_ID = "default"

const CustomPromptsSection = ({ renderSectionHeader }: CustomPromptsSectionProps) => {
	const [systemPrompts, setSystemPrompts] = useState<SystemPrompt[]>([])
	const [activePromptId, setActivePromptId] = useState<string>(DEFAULT_PROMPT_ID)
	const [isLoading, setIsLoading] = useState(true)
	const [isRefreshing, setIsRefreshing] = useState(false)

	const postMessage = useCallback((action: string, payload?: any) => {
		PLATFORM_CONFIG.postMessage({
			type: "customSystemPrompts",
			action,
			...payload,
		})
	}, [])

	const loadSystemPrompts = useCallback(async () => {
		setIsRefreshing(true)
		postMessage("list")
	}, [postMessage])

	useEffect(() => {
		loadSystemPrompts()

		const handleMessage = (event: MessageEvent) => {
			const message = event.data
			if (message.type === "customSystemPrompts.response") {
				if (message.action === "list") {
					setSystemPrompts(message.prompts || [])
					setActivePromptId(message.activePromptId || DEFAULT_PROMPT_ID)
					setIsLoading(false)
					setIsRefreshing(false)
				} else if (message.action === "activate") {
					if (message.success) {
						setActivePromptId(message.activePromptId)
						loadSystemPrompts()
					}
				}
			}
		}

		window.addEventListener("message", handleMessage)
		return () => window.removeEventListener("message", handleMessage)
	}, [loadSystemPrompts, postMessage])

	const handlePromptChange = useCallback(
		(promptId: string) => {
			setActivePromptId(promptId)
			setSystemPrompts((prev) =>
				prev.map((p) => ({
					...p,
					enabled: p.id === promptId,
				})),
			)
			postMessage("activate", { promptId })
		},
		[postMessage],
	)

	const handleOpenFolder = useCallback(() => {
		postMessage("openFolder")
	}, [postMessage])

	if (isLoading) {
		return (
			<div className="overflow-y-auto p-5">
				{renderSectionHeader("custom-prompts")}
				<Section>
					<p className="text-sm text-[var(--vscode-descriptionForeground)]">Loading custom prompts...</p>
				</Section>
			</div>
		)
	}

	return (
		<div className="overflow-y-auto p-5">
			{renderSectionHeader("custom-prompts")}

			<Section>
				<div className="flex items-center justify-between mb-3">
					<h3 className="text-sm font-semibold">System Prompt Selection</h3>
					<div className="flex gap-2">
						<VSCodeButton appearance="icon" title="Refresh" onClick={loadSystemPrompts} disabled={isRefreshing}>
							<RefreshCw className={`w-4 h-4 ${isRefreshing ? "animate-spin" : ""}`} />
						</VSCodeButton>
						<VSCodeButton appearance="icon" title="Open Prompts Folder" onClick={handleOpenFolder}>
							<FolderOpen className="w-4 h-4" />
						</VSCodeButton>
					</div>
				</div>

				<p className="text-xs mb-4 text-[var(--vscode-descriptionForeground)]">
					Choose between Cline's default behavior or your custom prompts from{" "}
					<code className="bg-[var(--vscode-textCodeBlock-background)] px-1 rounded">~/.cline/system-prompts/</code>
				</p>

				<VSCodeRadioGroup
					value={activePromptId}
					onChange={(e: any) => {
						const value = e.target.value
						if (value) {
							handlePromptChange(value)
						}
					}}>
					<VSCodeRadio value={DEFAULT_PROMPT_ID} checked={activePromptId === DEFAULT_PROMPT_ID}>
						<div className="flex flex-col gap-0.5">
							<span className="font-medium">Cline Default</span>
							<span className="text-xs text-[var(--vscode-descriptionForeground)]">
								Use Cline's original built-in system prompt
							</span>
						</div>
					</VSCodeRadio>

					{systemPrompts.map((prompt) => (
						<VSCodeRadio key={prompt.id} value={prompt.id} checked={activePromptId === prompt.id}>
							<div className="flex flex-col gap-0.5">
								<span className="font-medium">{prompt.name}</span>
								{prompt.description && (
									<span className="text-xs text-[var(--vscode-descriptionForeground)]">
										{prompt.description}
									</span>
								)}
							</div>
						</VSCodeRadio>
					))}
				</VSCodeRadioGroup>

				{systemPrompts.length === 0 && (
					<div className="mt-4 p-3 bg-[var(--vscode-textBlockQuote-background)] border-l-2 border-[var(--vscode-textBlockQuote-border)] rounded">
						<p className="text-xs mb-2">No custom prompts found.</p>
						<p className="text-xs text-[var(--vscode-descriptionForeground)]">
							Click the folder icon above to create your first custom prompt.
						</p>
					</div>
				)}

				<div className="mt-4 p-3 bg-[var(--vscode-editor-inactiveSelectionBackground)] rounded text-xs">
					<p className="font-medium mb-2">Quick Guide:</p>
					<ol className="list-decimal list-inside space-y-1 text-[var(--vscode-descriptionForeground)]">
						<li>Click the folder icon to open the prompts directory</li>
						<li>Create a new <code>.md</code> file (e.g., <code>my-prompt.md</code>)</li>
						<li>Write your custom system prompt as plain text</li>
						<li>Click refresh and select your prompt</li>
					</ol>
					<p className="mt-2 text-[var(--vscode-editorWarning-foreground)]">
						Note: Custom prompts completely replace Cline's default behavior.
					</p>
				</div>
			</Section>
		</div>
	)
}

export default memo(CustomPromptsSection)
