import { SVGProps } from "react"
import type { Environment } from "../../../src/config"
import { getEnvironmentColor } from "../utils/environmentColors"

/**
 * ClineLogoSanta component renders the Cline logo with a festive Santa hat
 * Includes automatic theme adaptation and environment-based color indicators.
 *
 * This festive version adds a Santa hat to the robot character while maintaining
 * the same theme and environment color system as ClineLogoVariable.
 *
 * @param {SVGProps<SVGSVGElement> & { environment?: Environment }} props - Standard SVG props plus optional environment
 * @returns {JSX.Element} SVG Cline logo with Santa hat that adapts to VS Code themes and environment
 */
const ClineLogoSanta = (props: SVGProps<SVGSVGElement> & { environment?: Environment }) => {
	const { environment, ...svgProps } = props

	// Determine fill color based on environment
	const fillColor = environment ? getEnvironmentColor(environment) : "var(--vscode-icon-foreground)"

	return (
		<svg height="50" viewBox="0 0 66.62 63.92" width="47" xmlns="http://www.w3.org/2000/svg" {...svgProps}>
			{/* Original Cline robot logo */}
			<path
				d="M55.69,42.04l-2.91-5.8v-3.34c0-5.54-4.47-10.03-9.98-10.03h-4.97c.36-.73.56-1.56.56-2.43,0-3.08-2.49-5.57-5.57-5.57s-5.57,2.49-5.57,5.57c0,.87.2,1.7.56,2.43h-4.97c-5.51,0-9.98,4.49-9.98,10.03v3.34l-2.97,5.79c-.3.58-.3,1.28,0,1.86l2.97,5.72v3.34c0,5.54,4.47,10.03,9.98,10.03h19.96c5.51,0,9.98-4.49,9.98-10.03v-3.34l2.9-5.74c.29-.57.29-1.25,0-1.82ZM29.79,46.77c0,2.52-2.04,4.56-4.56,4.56s-4.56-2.04-4.56-4.56v-8.1c0-2.52,2.04-4.56,4.56-4.56s4.56,2.04,4.56,4.56v8.1ZM44.47,46.77c0,2.52-2.04,4.56-4.56,4.56s-4.56-2.04-4.56-4.56v-8.1c0-2.52,2.04-4.56,4.56-4.56s4.56,2.04,4.56,4.56v8.1Z"
				fill={fillColor}
			/>

			{/* Santa hat - main red body */}
			<path
				d="M57.49,17.46,60.4,14.63c-.14-.01-.21-.13-.27-.26-1.43-2.96-1.52-3.53-4.67-6.86S43.99-.26,33.66.78c-2.51.25-7.99,1.46-11.38,4.92s-6.13,3.78-7.64,8.29c-.27.8-.39,1.63-.63,2.23-.03.07-.08.13-.15.16-.71.36-1.12.58-1.22.65-1.31.91-2.08,2.19-2.29,3.84-.21,1.66-.37,2.93-.46,3.83-.2,1.91.39,3.41,1.77,4.5.87.69,2.68-.33,3.63-1.16,4.39-3.85,16.92,1.42,24.19,2.64,3.06.51,7.98-.36,11.58.56,2.81.72,4.92,2.12,5.3-.71.24-1.81.41-3.27.53-4.39.17-1.75-.43-2.98-1.51-4.22-.07-.08-.11-.18-.11-.29-.01-.44,0-.9.02-1.38.08-1.87-1.10-3.89-1.4-5.9,0-.07.06-.1.12-.09,6.03,1.05,4.91,1.28,4.56,1.91"
				fill="#CC3333"
			/>

			{/* Santa hat - white fur trim */}
			<path
				d="M39.99,17.91c3.92.68,8.56,1.61,11.8,2.55.66.19,1.35.42,2.07.69,2.09.79,3.34,2.54,3.03,5.31-.24,2.13-.47,3.9-.68,5.34-.02.12-.05.24-.09.35-.51,1.43-1.33,2.3-2.46,2.61-.54.15-1.59,0-3.16-.45-4.77-1.35-11.05-2.49-16.7-3.16s-14.15-1.31-19.11-1.13c-1.63.06-2.69-.04-3.18-.31-1.02-.57-1.61-1.61-1.77-3.12-.01-.12-.01-.24,0-.36.13-1.44.33-3.23.6-5.35.35-2.76,1.98-4.17,4.2-4.44.77-.09,1.49-.15,2.18-.18,3.37-.14,10.25.3,14.21.57"
				fill="white"
			/>

			{/* Santa hat - white pom-pom */}
			<circle cx="61.35" cy="19.8" fill="white" r="5.27" />
		</svg>
	)
}
export default ClineLogoSanta
