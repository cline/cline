import React from "react"
import { cn } from "@/lib/utils"

type SettingsBadgeVariant = "experimental" | "new" | "dangerous" | "recommended"

interface SettingsBadgeProps {
	children: React.ReactNode
	variant?: SettingsBadgeVariant
	className?: string
}

export const SettingsBadge: React.FC<SettingsBadgeProps> = ({ children, variant = "experimental", className }) => {
	const getVariantStyles = () => {
		switch (variant) {
			case "experimental":
				return {
					backgroundColor: "color-mix(in srgb, var(--vscode-inputValidation-warningBackground) 40%, transparent)",
					color: "var(--vscode-inputValidation-warningBorder)",
				}
			case "new":
				return {
					backgroundColor: "color-mix(in srgb, var(--vscode-button-background) 40%, transparent)",
					color: "var(--vscode-button-background)",
				}
			case "dangerous":
				return {
					backgroundColor: "color-mix(in srgb, var(--vscode-inputValidation-errorBackground) 40%, transparent)",
					color: "var(--vscode-inputValidation-errorBorder)",
				}
			case "recommended":
				return {
					backgroundColor: "color-mix(in srgb, var(--vscode-button-background) 20%, transparent)",
					color: "var(--vscode-button-background)",
				}
		}
	}

	const variantStyles = getVariantStyles()

	return (
		<span
			className={cn("px-1.5 py-0.5 text-[8px] uppercase inline-flex items-center justify-center", className)}
			style={{ ...variantStyles, lineHeight: "1.25", borderRadius: "1px" }}>
			{children}
		</span>
	)
}
