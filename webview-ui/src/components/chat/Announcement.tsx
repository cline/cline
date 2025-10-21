import { EmptyRequest } from "@shared/proto/cline/common"
import { VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { XIcon } from "lucide-react"
import { CSSProperties, memo, useState } from "react"
import { useMount } from "react-use"
import { Button } from "@/components/ui/button"
import { useClineAuth } from "@/context/ClineAuthContext"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { AccountServiceClient } from "@/services/grpc-client"
import { getAsVar, VSC_DESCRIPTION_FOREGROUND, VSC_INACTIVE_SELECTION_BACKGROUND } from "@/utils/vscStyles"
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
const h4TitleStyle: CSSProperties = { margin: "0 0 8px", fontWeight: "bold" }
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
			<Button
				className="absolute top-2.5 right-2"
				data-testid="close-button"
				onClick={hideAnnouncement}
				size="icon"
				variant="icon">
				<XIcon />
			</Button>
			<h4 style={h4TitleStyle}>
				🎉{"  "}New in v{minorVersion}
			</h4>
			<ul style={ulStyle}>
				<li>
					<b>Cline CLI (Preview):</b> Run Cline from the command line with experimental Subagent support.{" "}
					<VSCodeLink href="http://cline.bot/blog/cline-cli-my-undying-love-of-cline-core" style={linkStyle}>
						Learn more
					</VSCodeLink>
				</li>
				<li>
					<b>Multi-Root Workspaces:</b> Work across multiple projects simultaneously (Enable in feature settings)
				</li>

				<li>
					<b>Auto-Retry Failed API Requests:</b> No more interrupted auto-approved tasks due to server errors
				</li>
			</ul>
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
