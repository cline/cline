import { VSCodeButton, VSCodeTextArea, VSCodeDropdown, VSCodeOption } from "@vscode/webview-ui-toolkit/react"
import { useExtensionState } from "../../context/ExtensionStateContext"
import { defaultPrompts, modes, Mode, PromptComponent, getRoleDefinition } from "../../../../src/shared/modes"
import { vscode } from "../../utils/vscode"
import React, { useState, useEffect } from "react"

type PromptsViewProps = {
	onDone: () => void
}

const AGENT_MODES = modes.map((mode) => ({
	id: mode.slug,
	label: mode.name,
}))

const PromptsView = ({ onDone }: PromptsViewProps) => {
	const {
		customPrompts,
		listApiConfigMeta,
		enhancementApiConfigId,
		setEnhancementApiConfigId,
		mode,
		customInstructions,
		setCustomInstructions,
	} = useExtensionState()
	const [testPrompt, setTestPrompt] = useState("")
	const [isEnhancing, setIsEnhancing] = useState(false)
	const [activeTab, setActiveTab] = useState<Mode>(mode)
	const [isDialogOpen, setIsDialogOpen] = useState(false)
	const [selectedPromptContent, setSelectedPromptContent] = useState("")
	const [selectedPromptTitle, setSelectedPromptTitle] = useState("")

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

	type AgentMode = string

	const updateAgentPrompt = (mode: Mode, promptData: PromptComponent) => {
		const existingPrompt = customPrompts?.[mode]
		const updatedPrompt = typeof existingPrompt === "object" ? { ...existingPrompt, ...promptData } : promptData

		// Only include properties that differ from defaults
		if (updatedPrompt.roleDefinition === getRoleDefinition(mode)) {
			delete updatedPrompt.roleDefinition
		}

		vscode.postMessage({
			type: "updatePrompt",
			promptMode: mode,
			customPrompt: updatedPrompt,
		})
	}

	const updateEnhancePrompt = (value: string | undefined) => {
		vscode.postMessage({
			type: "updateEnhancedPrompt",
			text: value,
		})
	}

	const handleAgentPromptChange = (mode: AgentMode, e: Event | React.FormEvent<HTMLElement>) => {
		const value = (e as CustomEvent)?.detail?.target?.value || ((e as any).target as HTMLTextAreaElement).value
		updateAgentPrompt(mode, { roleDefinition: value.trim() || undefined })
	}

	const handleEnhancePromptChange = (e: Event | React.FormEvent<HTMLElement>) => {
		const value = (e as CustomEvent)?.detail?.target?.value || ((e as any).target as HTMLTextAreaElement).value
		const trimmedValue = value.trim()
		if (trimmedValue !== defaultPrompts.enhance) {
			updateEnhancePrompt(trimmedValue || undefined)
		}
	}

	const handleAgentReset = (mode: AgentMode) => {
		const existingPrompt = customPrompts?.[mode]
		updateAgentPrompt(mode, {
			...(typeof existingPrompt === "object" ? existingPrompt : {}),
			roleDefinition: undefined,
		})
	}

	const handleEnhanceReset = () => {
		updateEnhancePrompt(undefined)
	}

	const getAgentPromptValue = (mode: Mode): string => {
		const prompt = customPrompts?.[mode]
		return typeof prompt === "object" ? (prompt.roleDefinition ?? getRoleDefinition(mode)) : getRoleDefinition(mode)
	}

	const getEnhancePromptValue = (): string => {
		const enhance = customPrompts?.enhance
		const defaultEnhance = typeof defaultPrompts.enhance === "string" ? defaultPrompts.enhance : ""
		return typeof enhance === "string" ? enhance : defaultEnhance
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

				<h3 style={{ color: "var(--vscode-foreground)", margin: "0 0 20px 0" }}>Mode-Specific Prompts</h3>

				<div
					style={{
						display: "flex",
						gap: "16px",
						alignItems: "center",
						marginBottom: "12px",
					}}>
					{AGENT_MODES.map((tab) => (
						<button
							key={tab.id}
							data-testid={`${tab.id}-tab`}
							data-active={activeTab === tab.id ? "true" : "false"}
							onClick={() => setActiveTab(tab.id)}
							style={{
								padding: "4px 8px",
								border: "none",
								background: activeTab === tab.id ? "var(--vscode-button-background)" : "none",
								color:
									activeTab === tab.id
										? "var(--vscode-button-foreground)"
										: "var(--vscode-foreground)",
								cursor: "pointer",
								opacity: activeTab === tab.id ? 1 : 0.8,
								borderRadius: "3px",
								fontWeight: "bold",
							}}>
							{tab.label}
						</button>
					))}
				</div>

				<div style={{ marginBottom: "20px" }}>
					<div style={{ marginBottom: "8px" }}>
						<div>
							<div
								style={{
									display: "flex",
									justifyContent: "space-between",
									alignItems: "center",
									marginBottom: "4px",
								}}>
								<div style={{ fontWeight: "bold" }}>Role Definition</div>
								<VSCodeButton
									appearance="icon"
									onClick={() => handleAgentReset(activeTab)}
									data-testid="reset-prompt-button"
									title="Revert to default">
									<span className="codicon codicon-discard"></span>
								</VSCodeButton>
							</div>
							<div
								style={{
									fontSize: "13px",
									color: "var(--vscode-descriptionForeground)",
									marginBottom: "8px",
								}}>
								Define Cline's expertise and personality for this mode. This description shapes how
								Cline presents itself and approaches tasks.
							</div>
						</div>
						<VSCodeTextArea
							value={getAgentPromptValue(activeTab)}
							onChange={(e) => handleAgentPromptChange(activeTab, e)}
							rows={4}
							resize="vertical"
							style={{ width: "100%" }}
							data-testid={`${activeTab}-prompt-textarea`}
						/>
					</div>
					<div style={{ marginBottom: "8px" }}>
						<div style={{ fontWeight: "bold", marginBottom: "4px" }}>Mode-specific Custom Instructions</div>
						<div
							style={{
								fontSize: "13px",
								color: "var(--vscode-descriptionForeground)",
								marginBottom: "8px",
							}}>
							Add behavioral guidelines specific to {activeTab} mode. These instructions enhance the base
							behaviors defined above.
						</div>
						<VSCodeTextArea
							value={(() => {
								const prompt = customPrompts?.[activeTab]
								return typeof prompt === "object" ? (prompt.customInstructions ?? "") : ""
							})()}
							onChange={(e) => {
								const value =
									(e as CustomEvent)?.detail?.target?.value ||
									((e as any).target as HTMLTextAreaElement).value
								const existingPrompt = customPrompts?.[activeTab]
								updateAgentPrompt(activeTab, {
									...(typeof existingPrompt === "object" ? existingPrompt : {}),
									customInstructions: value.trim() || undefined,
								})
							}}
							rows={4}
							resize="vertical"
							style={{ width: "100%" }}
							data-testid={`${activeTab}-custom-instructions-textarea`}
						/>
						<div
							style={{
								fontSize: "12px",
								color: "var(--vscode-descriptionForeground)",
								marginTop: "5px",
							}}>
							Custom instructions specific to {activeTab} mode can also be loaded from{" "}
							<span
								style={{
									color: "var(--vscode-textLink-foreground)",
									cursor: "pointer",
									textDecoration: "underline",
								}}
								onClick={() => {
									// First create/update the file with current custom instructions
									const defaultContent = `# ${activeTab} Mode Rules\n\nAdd mode-specific rules and guidelines here.`
									const existingPrompt = customPrompts?.[activeTab]
									const existingInstructions =
										typeof existingPrompt === "object"
											? existingPrompt.customInstructions
											: undefined
									vscode.postMessage({
										type: "updatePrompt",
										promptMode: activeTab,
										customPrompt: {
											...(typeof existingPrompt === "object" ? existingPrompt : {}),
											customInstructions: existingInstructions || defaultContent,
										},
									})
									// Then open the file
									vscode.postMessage({
										type: "openFile",
										text: `./.clinerules-${activeTab}`,
										values: {
											create: true,
											content: "",
										},
									})
								}}>
								.clinerules-{activeTab}
							</span>{" "}
							in your workspace.
						</div>
					</div>
				</div>
				<div style={{ marginBottom: "20px", display: "flex", justifyContent: "flex-start" }}>
					<VSCodeButton
						appearance="primary"
						onClick={() => {
							vscode.postMessage({
								type: "getSystemPrompt",
								mode: activeTab,
							})
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
					Use prompt enhancement to get tailored suggestions or improvements for your inputs. This ensures
					Cline understands your intent and provides the best possible responses.
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
