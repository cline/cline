import type { ArtifactKernelInfoResponse } from "@shared/proto/cline/html_preview"
import { ArtifactKernelState } from "@shared/proto/cline/html_preview"
import React from "react"

export interface KernelStatusChipProps {
	kernelInfo: ArtifactKernelInfoResponse | null
	runAllCurrent?: number
	runAllTotal?: number
	isRunning?: boolean
}

/** Inject the pulse keyframe once into the document (idempotent). */
function ensurePulseStyle() {
	if (typeof document === "undefined") {
		return
	}
	if (document.getElementById("aihydro-kernel-pulse-style")) {
		return
	}
	const el = document.createElement("style")
	el.id = "aihydro-kernel-pulse-style"
	el.textContent = `
		@keyframes aihydro-kernel-pulse {
			0%, 100% { opacity: 1; }
			50%       { opacity: 0.32; }
		}
	`
	document.head.appendChild(el)
}

type ChipState = "ready-clean" | "ready-dirty" | "busy" | "starting" | "error" | "stopped" | "idle"

function resolveChipState(kernelState: ArtifactKernelState | undefined, dirty: boolean, isRunning: boolean): ChipState {
	if (isRunning) {
		return "busy"
	}
	switch (kernelState) {
		case ArtifactKernelState.ARTIFACT_KERNEL_STATE_STARTING:
			return "starting"
		case ArtifactKernelState.ARTIFACT_KERNEL_STATE_BUSY:
			return "busy"
		case ArtifactKernelState.ARTIFACT_KERNEL_STATE_ERROR:
			return "error"
		case ArtifactKernelState.ARTIFACT_KERNEL_STATE_READY:
			return dirty ? "ready-dirty" : "ready-clean"
		case ArtifactKernelState.ARTIFACT_KERNEL_STATE_STOPPED:
			return "stopped"
		default:
			return "idle"
	}
}

const CHIP_PALETTE: Record<ChipState, { dot: string; bg: string; border: string; fg: string }> = {
	"ready-clean": {
		dot: "#89d185",
		bg: "rgba(137,209,133,0.10)",
		border: "rgba(137,209,133,0.30)",
		fg: "#a0c8a0",
	},
	"ready-dirty": {
		dot: "#cca700",
		bg: "rgba(204,167,0,0.10)",
		border: "rgba(204,167,0,0.30)",
		fg: "#c8b060",
	},
	busy: {
		dot: "#0e70c0",
		bg: "rgba(14,112,192,0.12)",
		border: "rgba(14,112,192,0.35)",
		fg: "#6ab0e0",
	},
	starting: {
		dot: "#cca700",
		bg: "rgba(204,167,0,0.10)",
		border: "rgba(204,167,0,0.30)",
		fg: "#c8b060",
	},
	error: {
		dot: "#f14c4c",
		bg: "rgba(241,76,76,0.10)",
		border: "rgba(241,76,76,0.30)",
		fg: "#d88080",
	},
	stopped: {
		dot: "#777",
		bg: "rgba(120,120,120,0.08)",
		border: "rgba(120,120,120,0.22)",
		fg: "#888",
	},
	idle: {
		dot: "#555",
		bg: "rgba(80,80,80,0.08)",
		border: "rgba(80,80,80,0.20)",
		fg: "#777",
	},
}

const CHIP_LABEL: Record<ChipState, string> = {
	"ready-clean": "Ready",
	"ready-dirty": "Ready",
	busy: "Busy",
	starting: "Starting",
	error: "Error",
	stopped: "Stopped",
	idle: "Idle",
}

/** Tiny ✎ pen SVG for dirty-kernel indicator */
const PenIcon: React.FC = () => (
	<svg
		fill="none"
		height="9"
		stroke="currentColor"
		strokeLinecap="round"
		strokeLinejoin="round"
		strokeWidth="2"
		style={{ flexShrink: 0, opacity: 0.65 }}
		viewBox="0 0 24 24"
		width="9">
		<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
		<path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
	</svg>
)

export const KernelStatusChip: React.FC<KernelStatusChipProps> = ({
	kernelInfo,
	runAllCurrent = 0,
	runAllTotal = 0,
	isRunning = false,
}) => {
	ensurePulseStyle()

	const dirty = kernelInfo?.kernelDirty ?? false
	const chipState = resolveChipState(kernelInfo?.state, dirty, isRunning)
	const palette = CHIP_PALETTE[chipState]
	const isAnimating = chipState === "busy" || chipState === "starting"
	const progressSuffix = chipState === "busy" && runAllTotal > 1 ? ` ${runAllCurrent}/${runAllTotal}` : ""
	const label = CHIP_LABEL[chipState] + progressSuffix
	const showDirtyIcon = chipState === "ready-dirty"

	const tooltip = [
		kernelInfo?.label || "No kernel",
		kernelInfo?.interpreterPath,
		kernelInfo?.pythonVersion ? `Python ${kernelInfo.pythonVersion}` : null,
		dirty ? "Kernel has executed cells since last restart." : "Kernel state: clean.",
		kernelInfo?.lastError ? `Last error: ${kernelInfo.lastError}` : null,
	]
		.filter(Boolean)
		.join("\n")

	return (
		<span
			aria-label={tooltip}
			role="status"
			style={{
				display: "inline-flex",
				alignItems: "center",
				gap: 5,
				padding: "2px 7px",
				borderRadius: 10,
				background: palette.bg,
				border: `1px solid ${palette.border}`,
				fontSize: 11,
				color: palette.fg,
				whiteSpace: "nowrap",
				userSelect: "none",
				flexShrink: 0,
			}}
			title={tooltip}>
			{/* Status dot */}
			<span
				style={{
					width: 8,
					height: 8,
					borderRadius: "50%",
					background: palette.dot,
					flexShrink: 0,
					animation: isAnimating ? "aihydro-kernel-pulse 1s ease-in-out infinite" : "none",
				}}
			/>
			{/* Label */}
			<span style={{ fontSize: 11 }}>{label}</span>
			{/* Dirty pen icon */}
			{showDirtyIcon && <PenIcon />}
		</span>
	)
}
