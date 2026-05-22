import type { ArtifactKernelInfoResponse } from "@shared/proto/cline/html_preview"
import { ArtifactKernelState } from "@shared/proto/cline/html_preview"
import React from "react"

export interface KernelStatusChipProps {
	kernelInfo: ArtifactKernelInfoResponse | null
	runAllCurrent?: number
	runAllTotal?: number
	isRunning?: boolean
}

function stateLabel(state: ArtifactKernelState | undefined, dirty: boolean, isRunning: boolean): string {
	if (isRunning) {
		return "Busy"
	}
	switch (state) {
		case ArtifactKernelState.ARTIFACT_KERNEL_STATE_STARTING:
			return "Starting"
		case ArtifactKernelState.ARTIFACT_KERNEL_STATE_BUSY:
			return "Busy"
		case ArtifactKernelState.ARTIFACT_KERNEL_STATE_ERROR:
			return "Error"
		case ArtifactKernelState.ARTIFACT_KERNEL_STATE_READY:
			return dirty ? "Ready · Dirty" : "Ready · Clean"
		case ArtifactKernelState.ARTIFACT_KERNEL_STATE_STOPPED:
			return "Stopped"
		default:
			return "Idle"
	}
}

export const KernelStatusChip: React.FC<KernelStatusChipProps> = ({
	kernelInfo,
	runAllCurrent = 0,
	runAllTotal = 0,
	isRunning = false,
}) => {
	const dirty = kernelInfo?.kernelDirty ?? false
	const state = kernelInfo?.state
	const label = kernelInfo?.label || "No kernel"
	const busyProgress = isRunning && runAllTotal > 1 ? ` (${runAllCurrent}/${runAllTotal})` : ""
	const text = `${stateLabel(state, dirty, isRunning)}${busyProgress}`

	const dotColor =
		state === ArtifactKernelState.ARTIFACT_KERNEL_STATE_ERROR
			? "var(--vscode-errorForeground, #f14c4c)"
			: isRunning || state === ArtifactKernelState.ARTIFACT_KERNEL_STATE_BUSY
				? "var(--vscode-progressBar-background, #0e70c0)"
				: state === ArtifactKernelState.ARTIFACT_KERNEL_STATE_READY
					? "var(--vscode-testing-iconPassed, #89d185)"
					: "var(--vscode-descriptionForeground, #888)"

	const tooltip = [
		label,
		kernelInfo?.interpreterPath,
		kernelInfo?.pythonVersion,
		kernelInfo?.lastError,
		dirty ? "Kernel has executed cells since last restart." : "Kernel has not run cells since restart.",
	]
		.filter(Boolean)
		.join("\n")

	return (
		<span
			style={{
				display: "inline-flex",
				alignItems: "center",
				gap: 4,
				fontSize: 10,
				color: "var(--vscode-descriptionForeground, #999)",
				maxWidth: 140,
				overflow: "hidden",
				textOverflow: "ellipsis",
				whiteSpace: "nowrap",
			}}
			title={tooltip}>
			<span
				style={{
					width: 7,
					height: 7,
					borderRadius: "50%",
					background: dotColor,
					flexShrink: 0,
				}}
			/>
			<span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{text}</span>
		</span>
	)
}
