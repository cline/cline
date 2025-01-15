import { VSCodeButton, VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { memo } from "react"
import styled from "styled-components"
import { getVarValue, INACTIVE_SELECTION_BACKGROUND_VAR, FOREGROUND_VAR } from "../../utils/vscStyles"

const AnnouncementContainer = styled.div`
	background-color: ${getVarValue(INACTIVE_SELECTION_BACKGROUND_VAR)};
	border-radius: 3px;
	padding: 12px 16px;
	margin: 5px 15px 5px 15px;
	position: relative;
	flex-shrink: 0;
`

const AnnouncementIcon = styled.span`
	fontSize: 12px,
	marginRight: 4px
`

const AnnouncementHeader = styled.h3`
	margin: 0 0 8px;
`

const AnnouncementList = styled.ul`
	margin: 0 0 8px;
	padding-left: 12px;
`

const AnnouncementListInner = styled.ul`
	margin: 4px 0;
	padding-left: 22;
`

const AnnouncementSpacer = styled.div`
	height: 1px;
	background: ${getVarValue(FOREGROUND_VAR)};
	opacity: 0.1;
	margin: 8px 0;
`

interface AnnouncementProps {
	version: string
	hideAnnouncement: () => void
}

/*
 * You must update the latestAnnouncementId in ClineProvider for new announcements to show to users.
 * This new id will be compared with what's in state for the 'last announcement shown',
 * and if it's different then the announcement will render. As soon as an announcement is shown,
 * the id will be updated in state. This ensures that announcements are not shown more than once,
 * even if the user doesn't close it themselves.
 */
const Announcement = ({ version, hideAnnouncement }: AnnouncementProps) => {
	const minorVersion = version.split(".").slice(0, 2).join(".") // 2.0.0 -> 2.0
	return (
		<AnnouncementContainer>
			<VSCodeButton appearance="icon" onClick={hideAnnouncement} style={{ position: "absolute", top: "8px", right: "8px" }}>
				<span className="codicon codicon-close"></span>
			</VSCodeButton>
			<AnnouncementHeader>
				🎉{"  "}New in v{minorVersion}
			</AnnouncementHeader>
			<AnnouncementList>
				<li>
					<b>Checkpoints are here!</b> Cline now saves a snapshot of your workspace at each step of the task. Hover over
					any message to see two new buttons:
					<AnnouncementListInner>
						<li>
							<AnnouncementIcon className="codicon codicon-diff-multiple"></AnnouncementIcon>
							<b>Compare</b> shows you a diff between the snapshot and your current workspace
						</li>
						<li>
							<AnnouncementIcon className="codicon codicon-discard"></AnnouncementIcon>
							<b>Restore</b> lets you revert your project's files back to that point in the task
						</li>
					</AnnouncementListInner>
				</li>
				<li>
					<b>'See new changes' button</b> when a task is completed, showing you an overview of all the changes Cline
					made to your workspace throughout the task
				</li>
			</AnnouncementList>
			<p style={{ margin: "8px 0" }}>
				<VSCodeLink href="https://x.com/sdrzn/status/1876378124126236949" style={{ display: "inline" }}>
					See a demo of Checkpoints here!
				</VSCodeLink>
			</p>
			<AnnouncementSpacer />
			<p style={{ margin: "0" }}>
				Join
				<VSCodeLink style={{ display: "inline" }} href="https://discord.gg/cline">
					discord.gg/cline
				</VSCodeLink>
				for more updates!
			</p>
		</AnnouncementContainer>
	)
}

export default memo(Announcement)
