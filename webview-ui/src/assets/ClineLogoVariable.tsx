import { SVGProps } from "react"
import type { Environment } from "../../../src/config"
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
		<svg fill="none" height="50" viewBox="0 0 47 50" width="47" xmlns="http://www.w3.org/2000/svg" {...svgProps}>
			<path
				d="M46.4075 28.1192L43.5011 22.3166V18.9747C43.5011 13.4354 39.0302 8.94931 33.5162 8.94931H28.5491C28.9086 8.21513 29.106 7.3898 29.106 6.5189C29.106 3.44039 26.6149 0.949219 23.5363 0.949219C20.4578 0.949219 17.9667 3.44039 17.9667 6.5189C17.9667 7.3898 18.1641 8.21513 18.5236 8.94931H13.5565C8.04249 8.94931 3.57155 13.4354 3.57155 18.9747V22.3166L0.604424 28.104C0.305687 28.6863 0.305687 29.3799 0.604424 29.9622L3.57155 35.6838V39.0256C3.57155 44.5649 8.04249 49.0511 13.5565 49.0511H33.5162C39.0302 49.0511 43.5011 44.5649 43.5011 39.0256V35.6838L46.4024 29.942C46.691 29.3698 46.691 28.6964 46.4075 28.1192ZM20.4983 32.8483C20.4983 35.3648 18.4578 37.4053 15.9413 37.4053C13.4248 37.4053 11.3843 35.3648 11.3843 32.8483V24.747C11.3843 22.2305 13.4248 20.19 15.9413 20.19C18.4578 20.19 20.4983 22.2305 20.4983 24.747V32.8483ZM35.182 32.8483C35.182 35.3648 33.1415 37.4053 30.625 37.4053C28.1085 37.4053 26.068 35.3648 26.068 32.8483V24.747C26.068 22.2305 28.1085 20.19 30.625 20.19C33.1415 20.19 35.182 22.2305 35.182 24.747V32.8483Z"
				fill={fillColor}
			/>
		</svg>
	)
}
export default ClineLogoVariable
