import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import React, { useState } from "react"

export const TAB_NAVBAR_HEIGHT = 24
const BUTTON_MARGIN_RIGHT = "3px"
const LAST_BUTTON_MARGIN_RIGHT = "13px"

type TabNavbarProps = {
	onPlusClick: () => void
	onHistoryClick: () => void
	onSettingsClick: () => void
}

type TooltipProps = {
	text: string
	isVisible: boolean
	position: { x: number; y: number }
	align?: "left" | "center" | "right"
}

const Tooltip: React.FC<TooltipProps> = ({ text, isVisible, position, align = "center" }) => {
	let leftPosition = position.x
	let triangleStyle: React.CSSProperties = {
		left: "50%",
		marginLeft: "-5px",
	}

	if (align === "right") {
		leftPosition = position.x - 10 // Adjust this value as needed
		triangleStyle = {
			right: "10px", // Adjust this value to match the tooltip's right padding
			marginLeft: "0",
		}
	} else if (align === "left") {
		leftPosition = position.x + 10 // Adjust this value as needed
		triangleStyle = {
			left: "10px", // Adjust this value to match the tooltip's left padding
			marginLeft: "0",
		}
	}

	return (
		<div
			style={{
				position: "fixed",
				top: `${position.y}px`,
				left: align === "center" ? leftPosition + "px" : "auto",
				right: align === "right" ? "10px" : "auto", // Ensure 10px from screen edge
				transform: align === "center" ? "translateX(-50%)" : "none",
				opacity: isVisible ? 1 : 0,
				visibility: isVisible ? "visible" : "hidden",
				transition: "opacity 0.1s ease-out 0.1s, visibility 0.1s ease-out 0.1s",
				backgroundColor: "var(--vscode-editorHoverWidget-background)",
				color: "var(--vscode-editorHoverWidget-foreground)",
				padding: "4px 8px",
				borderRadius: "3px",
				fontSize: "12px",
				pointerEvents: "none",
				zIndex: 1000,
				boxShadow: "0 2px 8px var(--vscode-widget-shadow)",
				border: "1px solid var(--vscode-editorHoverWidget-border)",
				textAlign: "center",
				whiteSpace: "nowrap",
			}}>
			<div
				style={{
					position: "absolute",
					top: "-5px",
					...triangleStyle,
					borderLeft: "5px solid transparent",
					borderRight: "5px solid transparent",
					borderBottom: "5px solid var(--vscode-editorHoverWidget-border)",
				}}
			/>
			<div
				style={{
					position: "absolute",
					top: "-4px",
					...triangleStyle,
					borderLeft: "5px solid transparent",
					borderRight: "5px solid transparent",
					borderBottom: "5px solid var(--vscode-editorHoverWidget-background)",
				}}
			/>
			{text}
		</div>
	)
}

const TabNavbar = ({ onPlusClick, onHistoryClick, onSettingsClick }: TabNavbarProps) => {
	const [tooltip, setTooltip] = useState<TooltipProps>({
		text: "",
		isVisible: false,
		position: { x: 0, y: 0 },
		align: "center",
	})

	const showTooltip = (text: string, event: React.MouseEvent, align: "left" | "center" | "right" = "center") => {
		const rect = event.currentTarget.getBoundingClientRect()
		setTooltip({
			text,
			isVisible: true,
			position: { x: rect.left + rect.width / 2, y: rect.bottom + 7 },
			align,
		})
	}

	const hideTooltip = () => {
		setTooltip((prev) => ({ ...prev, isVisible: false }))
	}

	const buttonStyle = {
		marginRight: BUTTON_MARGIN_RIGHT,
	}

	const lastButtonStyle = {
		...buttonStyle,
		marginRight: LAST_BUTTON_MARGIN_RIGHT,
	}

	return (
		<>
			<div
				style={{
					position: "absolute",
					top: 4,
					right: 0,
					left: 0,
					height: TAB_NAVBAR_HEIGHT,
					display: "flex",
					justifyContent: "flex-end",
					alignItems: "center",
				}}>
				<VSCodeButton
					appearance="icon"
					onClick={onPlusClick}
					style={buttonStyle}
					onMouseEnter={(e) => showTooltip("New Chat", e, "center")}
					onMouseLeave={hideTooltip}
					onMouseMove={(e) => showTooltip("New Chat", e, "center")}>
					<span className="codicon codicon-add"></span>
				</VSCodeButton>
				<VSCodeButton
					appearance="icon"
					onClick={onHistoryClick}
					style={buttonStyle}
					onMouseEnter={(e) => showTooltip("History", e, "center")}
					onMouseLeave={hideTooltip}
					onMouseMove={(e) => showTooltip("History", e, "center")}>
					<span className="codicon codicon-history"></span>
				</VSCodeButton>
				<VSCodeButton
					appearance="icon"
					onClick={onSettingsClick}
					style={lastButtonStyle}
					onMouseEnter={(e) => showTooltip("Settings", e, "right")}
					onMouseLeave={hideTooltip}
					onMouseMove={(e) => showTooltip("Settings", e, "right")}>
					<span className="codicon codicon-settings-gear"></span>
				</VSCodeButton>
			</div>
			<Tooltip {...tooltip} />
		</>
	)
}

export default TabNavbar
