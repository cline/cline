import { memo, useMemo } from "react"
import styled from "styled-components"

interface WorkspaceBadgeProps {
	workspaceIds: string[]
	workspaceName: string
	showTooltip?: boolean
}

const WorkspaceBadge = ({ workspaceIds, workspaceName, showTooltip = true }: WorkspaceBadgeProps) => {
	const displayText = useMemo(() => {
		if (!workspaceIds || workspaceIds.length === 0) {
			return null
		}

		if (workspaceIds.length === 1) {
			return workspaceName || "Unknown Workspace"
		}

		// Multiple workspaces
		const additionalCount = workspaceIds.length - 1
		return `${workspaceName || "Workspace"} + ${additionalCount}`
	}, [workspaceIds, workspaceName])

	const tooltipText = useMemo(() => {
		if (!showTooltip || !workspaceIds || workspaceIds.length <= 1) {
			return undefined
		}

		// For multi-workspace tasks, show all workspace paths
		return `Used in ${workspaceIds.length} workspaces:\n${workspaceIds.join("\n")}`
	}, [workspaceIds, showTooltip])

	if (!displayText) {
		return null
	}

	return (
		<BadgeContainer title={tooltipText}>
			<span className="codicon codicon-folder" style={{ fontSize: "12px" }} />
			<BadgeText>{displayText}</BadgeText>
		</BadgeContainer>
	)
}

export default memo(WorkspaceBadge)

const BadgeContainer = styled.div`
	display: inline-flex;
	align-items: center;
	gap: 4px;
	padding: 2px 6px;
	border-radius: 3px;
	background-color: var(--vscode-badge-background);
	color: var(--vscode-badge-foreground);
	font-size: 11px;
	white-space: nowrap;
	margin-left: 6px;
	vertical-align: middle;
	user-select: none;

	&:hover {
		opacity: 0.9;
	}
`

const BadgeText = styled.span`
	font-size: 11px;
	line-height: 1;
	max-width: 150px;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
`
