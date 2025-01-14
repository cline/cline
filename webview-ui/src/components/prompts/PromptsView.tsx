import { VSCodeButton, VSCodeTextArea, VSCodeDropdown, VSCodeOption, VSCodeDivider } from "@vscode/webview-ui-toolkit/react"
import { useExtensionState } from "../../context/ExtensionStateContext"
import { defaultPrompts, askMode, codeMode, architectMode, Mode, PromptComponent } from "../../../../src/shared/modes"
import { vscode } from "../../utils/vscode"
import React, { useState, useEffect } from "react"

type PromptsViewProps = {
	onDone: () => void
}

const AGENT_MODES = [
	{ id: codeMode, label: 'Code' },
	{ id: architectMode, label: 'Architect' },
	{ id: askMode, label: 'Ask' },
] as const

const PromptsView = ({ onDone }: PromptsViewProps) => {
	const { customPrompts, listApiConfigMeta, enhancementApiConfigId, setEnhancementApiConfigId, mode } = useExtensionState()
	const [testPrompt, setTestPrompt] = useState('')
	const [isEnhancing, setIsEnhancing] = useState(false)
	const [activeTab, setActiveTab] = useState<Mode>(mode)
	const [isDialogOpen, setIsDialogOpen] = useState(false)
	const [selectedPromptContent, setSelectedPromptContent] = useState('')
	const [selectedPromptTitle, setSelectedPromptTitle] = useState('')

	useEffect(() => {
		const handler = (event: MessageEvent) => {
			const message = event.data
			if (message.type === 'enhancedPrompt') {
				if (message.text) {
					setTestPrompt(message.text)
				}
				setIsEnhancing(false)
			} else if (message.type === 'systemPrompt') {
				if (message.text) {
					setSelectedPromptContent(message.text)
					setSelectedPromptTitle(`System Prompt (${message.mode} mode)`)
					setIsDialogOpen(true)
				}
			}
		}

		window.addEventListener('message', handler)
		return () => window.removeEventListener('message', handler)
	}, [])

	type AgentMode = typeof codeMode | typeof architectMode | typeof askMode

	const updateAgentPrompt = (mode: AgentMode, promptData: PromptComponent) => {
		vscode.postMessage({
			type: "updatePrompt",
			promptMode: mode,
			customPrompt: promptData
		})
	}

	const updateEnhancePrompt = (value: string | undefined) => {
		vscode.postMessage({
			type: "updateEnhancedPrompt",
			text: value
		})
	}

	const handleAgentPromptChange = (mode: AgentMode, e: Event | React.FormEvent<HTMLElement>) => {
		const value = (e as CustomEvent)?.detail?.target?.value || ((e as any).target as HTMLTextAreaElement).value
		updateAgentPrompt(mode, { roleDefinition: value.trim() || undefined })
	}

	const handleEnhancePromptChange = (e: Event | React.FormEvent<HTMLElement>) => {
		const value = (e as CustomEvent)?.detail?.target?.value || ((e as any).target as HTMLTextAreaElement).value
		updateEnhancePrompt(value.trim() || undefined)
	}

	const handleAgentReset = (mode: AgentMode) => {
		updateAgentPrompt(mode, { roleDefinition: undefined })
	}

	const handleEnhanceReset = () => {
		updateEnhancePrompt(undefined)
	}

	const getAgentPromptValue = (mode: AgentMode): string => {
		return customPrompts?.[mode]?.roleDefinition ?? defaultPrompts[mode].roleDefinition
	}

	const getEnhancePromptValue = (): string => {
		return customPrompts?.enhance ?? defaultPrompts.enhance
	}

	const handleTestEnhancement = () => {
		if (!testPrompt.trim()) return
		
		setIsEnhancing(true)
		vscode.postMessage({
			type: "enhancePrompt",
			text: testPrompt
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
				<h3 style={{ color: "var(--vscode-foreground)", margin: "0 0 20px 0" }}>Agent Modes</h3>

				<div
					style={{
						color: "var(--vscode-foreground)",
						fontSize: "13px",
						marginBottom: "20px",
						marginTop: "5px",
					}}>
					Customize Cline's prompt in each mode. The rest of the system prompt will be automatically appended. Click the button to preview the full prompt. Leave empty or click the reset button to use the default.
				</div>

				<div style={{ 
					display: 'flex',
					justifyContent: 'space-between',
					alignItems: 'center',
					marginBottom: '12px'
				}}>
					<div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
						{AGENT_MODES.map((tab, index) => (
							<React.Fragment key={tab.id}>
								<button
									data-testid={`${tab.id}-tab`}
									data-active={activeTab === tab.id ? "true" : "false"}
									onClick={() => setActiveTab(tab.id)}
									style={{
										padding: '4px 0',
										border: 'none',
										background: 'none',
										color: activeTab === tab.id ? 'var(--vscode-textLink-foreground)' : 'var(--vscode-foreground)',
										cursor: 'pointer',
										opacity: activeTab === tab.id ? 1 : 0.8,
										borderBottom: activeTab === tab.id ?
											'1px solid var(--vscode-textLink-foreground)' :
											'1px solid var(--vscode-foreground)',
										fontWeight: 'bold'
									}}
								>
									{tab.label}
								</button>
								{index < AGENT_MODES.length - 1 && (
									<span style={{ color: 'var(--vscode-foreground)', opacity: 0.4 }}>|</span>
								)}
							</React.Fragment>
						))}
					</div>
					<VSCodeButton
						appearance="icon"
						onClick={() => handleAgentReset(activeTab)}
						data-testid="reset-prompt-button"
						title="Revert to default"
					>
						<span className="codicon codicon-discard"></span>
					</VSCodeButton>
				</div>

				<div style={{ marginBottom: '8px' }}>
					<VSCodeTextArea
						value={getAgentPromptValue(activeTab)}
						onChange={(e) => handleAgentPromptChange(activeTab, e)}
						rows={4}
						resize="vertical"
						style={{ width: "100%" }}
						data-testid={`${activeTab}-prompt-textarea`}
					/>
				</div>
				<div style={{ marginBottom: '20px', display: 'flex', justifyContent: 'flex-start' }}>
					<VSCodeButton
						appearance="primary"
						onClick={() => {
							vscode.postMessage({
								type: "getSystemPrompt",
								mode: activeTab
							})
						}}
						data-testid="preview-prompt-button"
					>
						Preview System Prompt
					</VSCodeButton>
				</div>

				<h3 style={{ color: "var(--vscode-foreground)", margin: "40px 0 20px 0" }}>Prompt Enhancement</h3>

				<div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
					<div>
						<div style={{ marginBottom: "12px" }}>
							<div style={{ marginBottom: "8px" }}>
								<div style={{ fontWeight: "bold", marginBottom: "4px" }}>API Configuration</div>
								<div style={{ fontSize: "13px", color: "var(--vscode-descriptionForeground)" }}>
									You can select an API configuration to always use for enhancing prompts, or just use whatever is currently selected
								</div>
							</div>
							<VSCodeDropdown
								value={enhancementApiConfigId || ''}
								data-testid="api-config-dropdown"
								onChange={(e: any) => {
									const value = e.detail?.target?.value || e.target?.value
									setEnhancementApiConfigId(value)
									vscode.postMessage({
										type: "enhancementApiConfigId",
										text: value
									})
								}}
								style={{ width: "300px" }}
							>
								<VSCodeOption value="">Use currently selected API configuration</VSCodeOption>
								{(listApiConfigMeta || []).map((config) => (
									<VSCodeOption key={config.id} value={config.id}>
										{config.name}
									</VSCodeOption>
								))}
							</VSCodeDropdown>
						</div>

						<div style={{ marginBottom: "8px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
							<div style={{ fontWeight: "bold" }}>Enhancement Prompt</div>
							<div style={{ display: "flex", gap: "8px" }}>
								<VSCodeButton appearance="icon" onClick={handleEnhanceReset} title="Revert to default">
									<span className="codicon codicon-discard"></span>
								</VSCodeButton>
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
							<div style={{ 
								marginTop: "8px",
								display: "flex", 
								justifyContent: "flex-start",
								alignItems: "center", 
								gap: 8 
							}}>
								<VSCodeButton
									onClick={handleTestEnhancement}
									disabled={isEnhancing}
									appearance="primary"
								>
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
				<div style={{
					position: 'fixed',
					inset: 0,
					display: 'flex',
					justifyContent: 'flex-end',
					backgroundColor: 'rgba(0, 0, 0, 0.5)',
					zIndex: 1000
				}}>
					<div style={{
						width: 'calc(100vw - 100px)',
						height: '100%',
						backgroundColor: 'var(--vscode-editor-background)',
						boxShadow: '-2px 0 5px rgba(0, 0, 0, 0.2)',
						display: 'flex',
						flexDirection: 'column',
						padding: '20px',
						overflowY: 'auto'
					}}>
						<div style={{
							display: 'flex',
							justifyContent: 'space-between',
							alignItems: 'center',
							marginBottom: '16px'
						}}>
							<h2 style={{ margin: 0 }}>{selectedPromptTitle}</h2>
							<VSCodeButton appearance="icon" onClick={() => setIsDialogOpen(false)}>
								<span className="codicon codicon-close"></span>
							</VSCodeButton>
						</div>
						<VSCodeDivider />
						<pre style={{
							margin: '16px 0',
							padding: '8px',
							whiteSpace: 'pre-wrap',
							wordBreak: 'break-word',
							fontFamily: 'var(--vscode-editor-font-family)',
							fontSize: 'var(--vscode-editor-font-size)',
							color: 'var(--vscode-editor-foreground)',
							backgroundColor: 'var(--vscode-editor-background)',
							border: '1px solid var(--vscode-editor-lineHighlightBorder)',
							borderRadius: '4px',
							flex: 1,
							overflowY: 'auto'
						}}>
							{selectedPromptContent}
						</pre>
					</div>
				</div>
			)}
		</div>
	)
}

export default PromptsView