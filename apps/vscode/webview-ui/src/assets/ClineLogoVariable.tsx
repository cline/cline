import { SVGProps } from "react"
import type { Environment } from "../../../src/shared/config-types"
import { getEnvironmentColor } from "../utils/environmentColors"
import { CLINE_LOGO_VIEW_BOX, ClineLogoShape } from "./ClineLogoShape"

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
		<svg fill="none" height="50" viewBox={CLINE_LOGO_VIEW_BOX} width="50" xmlns="http://www.w3.org/2000/svg" {...svgProps}>
			<title>Cline</title>
			<ClineLogoShape color={fillColor} />
		</svg>
	)
}
export default ClineLogoVariable
