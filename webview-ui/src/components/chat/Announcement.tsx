import { Accordion, AccordionItem } from "@heroui/react"
import { EmptyRequest } from "@shared/proto/cline/common"
import { VSCodeButton, VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { CSSProperties, memo, useState } from "react"
import { useMount } from "react-use"
import { useClineAuth } from "@/context/ClineAuthContext"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { AccountServiceClient } from "@/services/grpc-client"
import { getAsVar, VSC_DESCRIPTION_FOREGROUND, VSC_INACTIVE_SELECTION_BACKGROUND } from "@/utils/vscStyles"
import VSCodeButtonLink from "../common/VSCodeButtonLink"
import { useApiConfigurationHandlers } from "../settings/utils/useApiConfigurationHandlers"

interface AnnouncementProps {
	version: string
	hideAnnouncement: () => void
}

const containerStyle: CSSProperties = {
	backgroundColor: getAsVar(VSC_INACTIVE_SELECTION_BACKGROUND),
	borderRadius: "3px",
	padding: "12px 16px",
	margin: "5px 15px 5px 15px",
	position: "relative",
	flexShrink: 0,
}
const closeIconStyle: CSSProperties = { position: "absolute", top: "8px", right: "8px" }
const h3TitleStyle: CSSProperties = { margin: "0 0 8px", fontWeight: "bold" }
const ulStyle: CSSProperties = { margin: "0 0 8px", paddingLeft: "12px", listStyleType: "disc" }
const _accountIconStyle: CSSProperties = { fontSize: 11 }
const hrStyle: CSSProperties = {
	height: "1px",
	background: getAsVar(VSC_DESCRIPTION_FOREGROUND),
	opacity: 0.1,
	margin: "8px 0",
}
const linkContainerStyle: CSSProperties = { margin: "0" }
const linkStyle: CSSProperties = { display: "inline" }

/*
Announcements are automatically shown when the major.minor version changes (for ex 3.19.x → 3.20.x or 4.0.x). 
The latestAnnouncementId is now automatically generated from the extension's package.json version. 
Patch releases (3.19.1 → 3.19.2) will not trigger new announcements.
*/
const Announcement = ({ version, hideAnnouncement }: AnnouncementProps) => {
	const minorVersion = version.split(".").slice(0, 2).join(".") // 2.0.0 -> 2.0
	const { clineUser } = useClineAuth()
	const { openRouterModels, setShowChatModelSelector, refreshOpenRouterModels } = useExtensionState()
	const user = clineUser || undefined
	const { handleFieldsChange } = useApiConfigurationHandlers()

	const [didClickGrokCodeButton, setDidClickGrokCodeButton] = useState(false)
	const [didClickCodeSupernovaButton, setDidClickCodeSupernovaButton] = useState(false)

	// Need to get latest model list in case user hits shortcut button to set model
	useMount(refreshOpenRouterModels)

	const setGrokCodeFast1 = () => {
		const modelId = "x-ai/grok-code-fast-1"
		// set both plan and act modes to use grok-code-fast-1
		handleFieldsChange({
			planModeOpenRouterModelId: modelId,
			actModeOpenRouterModelId: modelId,
			planModeOpenRouterModelInfo: openRouterModels[modelId],
			actModeOpenRouterModelInfo: openRouterModels[modelId],
			planModeApiProvider: "cline",
			actModeApiProvider: "cline",
		})

		setTimeout(() => {
			setDidClickGrokCodeButton(true)
			setShowChatModelSelector(true)
		}, 10)
	}

	const setCodeSupernova = () => {
		const modelId = "cline/code-supernova-1-million"
		// set both plan and act modes to use code-supernova-1-million
		handleFieldsChange({
			planModeOpenRouterModelId: modelId,
			actModeOpenRouterModelId: modelId,
			planModeOpenRouterModelInfo: openRouterModels[modelId],
			actModeOpenRouterModelInfo: openRouterModels[modelId],
			planModeApiProvider: "cline",
			actModeApiProvider: "cline",
		})

		setTimeout(() => {
			setDidClickCodeSupernovaButton(true)
			setShowChatModelSelector(true)
		}, 10)
	}

	const handleShowAccount = () => {
		AccountServiceClient.accountLoginClicked(EmptyRequest.create()).catch((err) =>
			console.error("Failed to get login URL:", err),
		)
	}

	return (
		<div style={containerStyle}>
			<VSCodeButton appearance="icon" data-testid="close-button" onClick={hideAnnouncement} style={closeIconStyle}>
				<span className="codicon codicon-close"></span>
			</VSCodeButton>
			<h3 style={h3TitleStyle}>
				🎉{"  "}New in v{minorVersion}
			</h3>
			<ul style={ulStyle}>
				<li>
					<b>UI Improvements:</b> New task header and focus chain design to take up less space for a cleaner experience
				</li>
				<li>
					<b>Voice Mode:</b> Experimental feature that must be enabled in settings for hands-free coding
				</li>
				<li>
					<b>YOLO Mode:</b> Enable in settings to let Cline approve all actions and automatically switch between
					plan/act mode
				</li>
				<li>
					<b>JetBrains Updates:</b> We've brought support to Rider and made tons of improvements thanks to all the
					feedback!
					<br />
					<VSCodeButtonLink href="https://cline.bot/jetbrains" style={{ margin: "5px 0" }}>
						Get Cline for JetBrains
					</VSCodeButtonLink>
				</li>
				<li>
					<b>Free Models:</b> Try the new code-supernova-1-million stealth model, or grok-code-fast-1 for free!
					<br />
					{user ? (
						<div style={{ display: "flex", gap: "8px", flexWrap: "wrap", margin: "5px 0" }}>
							{!didClickCodeSupernovaButton && (
								<VSCodeButton appearance="primary" onClick={setCodeSupernova}>
									Try code-supernova
								</VSCodeButton>
							)}
							{!didClickGrokCodeButton && (
								<VSCodeButton appearance="primary" onClick={setGrokCodeFast1}>
									Try grok-code-fast-1
								</VSCodeButton>
							)}
						</div>
					) : (
						<VSCodeButton appearance="primary" onClick={handleShowAccount} style={{ margin: "5px 0" }}>
							Sign Up with Cline
						</VSCodeButton>
					)}
				</li>
				{user && (
					<li>
						Updated the Terms of Service for Cline account users:{" "}
						<VSCodeLink href="https://cline.bot/tos" style={linkStyle}>
							https://cline.bot/tos
						</VSCodeLink>
					</li>
				)}
			</ul>
			<div style={{ margin: "12px 0" }} />
			<div style={{ margin: "-8px 0 -3px 0" }}>
				<Accordion className="pl-0" isCompact>
					<AccordionItem
						aria-label="Previous Updates"
						classNames={{
							trigger: "bg-transparent border-0 pl-0 pb-0 w-fit",
							title: "font-bold text-[var(--vscode-foreground)]",
							indicator:
								"text-[var(--vscode-foreground)] mb-0.5 -rotate-180 data-[open=true]:-rotate-90 rtl:rotate-0 rtl:data-[open=true]:-rotate-90",
						}}
						key="1"
						title="Previous Updates:">
						<ul style={ulStyle}>
							<li>
								<b>Free grok-code-fast-1:</b> Partnered with xAI to provide free usage of grok. Community feedback
								has been incredible and xAI is continuously improving the model's intelligence.
							</li>
							<li>
								<b>Focus Chain:</b> Keeps cline focused on long-horizon tasks with automatic todo list management,
								breaking down complex tasks into manageable steps with real-time progress tracking and passive
								reminders.
							</li>
							<li>
								<b>Auto Compact:</b> Auto summarizes your task and next steps when your conversation approaches
								the model's context window limit. This significantly helps Cline stay on track for long task
								sessions!
							</li>
							<li>
								<b>Deep Planning:</b> New <code>/deep-planning</code> slash command transforms Cline into an
								architect who investigates your codebase, asks clarifying questions, and creates a comprehensive
								plan before writing any code.
							</li>
						</ul>
					</AccordionItem>
				</Accordion>
			</div>
			<div style={hrStyle} />
			<p style={linkContainerStyle}>
				Join us on{" "}
				<VSCodeLink href="https://x.com/cline" style={linkStyle}>
					X,
				</VSCodeLink>{" "}
				<VSCodeLink href="https://discord.gg/cline" style={linkStyle}>
					discord,
				</VSCodeLink>{" "}
				or{" "}
				<VSCodeLink href="https://www.reddit.com/r/cline/" style={linkStyle}>
					r/cline
				</VSCodeLink>
				for more updates!
			</p>
		</div>
	)
}

export default memo(Announcement)
