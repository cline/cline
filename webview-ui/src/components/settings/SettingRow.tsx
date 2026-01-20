import React from "react"
import { cn } from "@/lib/utils"

interface SettingRowProps {
	children: React.ReactNode
	highlighted?: boolean
	disabled?: boolean
}

export const SettingRow: React.FC<SettingRowProps> = ({ children, highlighted, disabled }) => {
	return (
		<div
			className={cn(
				"flex items-start justify-between gap-4 py-3 px-2 rounded-md transition-colors",
				highlighted && "ring-1 bg-opacity-5",
				disabled && "opacity-50",
				!disabled && "hover:bg-white/5",
			)}
			style={{
				...(highlighted && {
					ringColor: "color-mix(in srgb, var(--vscode-button-background) 30%, transparent)",
					backgroundColor: "color-mix(in srgb, var(--vscode-button-background) 5%, transparent)",
				}),
			}}>
			{children}
		</div>
	)
}

export const SettingInfo: React.FC<{ children: React.ReactNode }> = ({ children }) => {
	return <div className="flex-1 min-w-0">{children}</div>
}

export const SettingLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => {
	return (
		<div className="text-sm font-medium mb-1" style={{ color: "var(--vscode-foreground)" }}>
			{children}
		</div>
	)
}

export const SettingDescription: React.FC<{ children: React.ReactNode }> = ({ children }) => {
	return (
		<div className="text-xs leading-relaxed" style={{ color: "var(--vscode-descriptionForeground)" }}>
			{children}
		</div>
	)
}
