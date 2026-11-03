import { SVGProps } from "react"
import type { Environment } from "../../../src/shared/config-types"
import { getEnvironmentColor } from "../utils/environmentColors"

/**
 * ClineLogoVariable component renders the Cline logo with automatic theme adaptation
 * and environment-based color indicators.
 *
 * This component uses VS Code theme variables for the fill color, with environment-specific colors:
 * - Local: yellow/orange (development/experimental)
 * - Staging: blue (stable testing)
 * - Production: gray/white (default icon color)
 *
 * @param {SVGProps<SVGSVGElement> & { environment?: Environment }} props - Standard SVG props plus optional environment
 * @returns {JSX.Element} SVG Cline logo that adapts to VS Code themes and environment
 */
const ClineLogoVariable = (props: SVGProps<SVGSVGElement> & { environment?: Environment }) => {
	const { environment, ...svgProps } = props

	// Determine fill color based on environment
	const fillColor = environment ? getEnvironmentColor(environment) : "var(--vscode-icon-foreground)"

	return (
		<svg fill="none" height="50" role="img" viewBox="0 0 113 113" width="50" xmlns="http://www.w3.org/2000/svg" {...svgProps}>
			<title>CLine</title>
			<path
				d="M22,34 L44,56.5 L22,79"
				fill="none"
				stroke={fillColor}
				strokeLinecap="round"
				strokeLinejoin="round"
				strokeWidth="11"
			/>
			<rect fill={fillColor} height="11" rx="5.5" width="42" x="56" y="40" />
			<rect fill={fillColor} height="11" rx="5.5" width="32" x="56" y="62" />
		</svg>
	)
}
export default ClineLogoVariable
