import { useEffect, useRef, useState } from "react"
import mermaid from "mermaid"
import { useDebounceEffect } from "../../utils/useDebounceEffect"
import styled from "styled-components"
import { vscode } from "../../utils/vscode"

const MERMAID_THEME = {
	background: "#1e1e1e", // VS Code dark theme background
	textColor: "#ffffff", // Main text color
	mainBkg: "#2d2d2d", // Background for nodes
	nodeBorder: "#888888", // Border color for nodes
	lineColor: "#cccccc", // Lines connecting nodes
	primaryColor: "#3c3c3c", // Primary color for highlights
	primaryTextColor: "#ffffff", // Text in primary colored elements
	primaryBorderColor: "#888888",
	secondaryColor: "#2d2d2d", // Secondary color for alternate elements
	tertiaryColor: "#454545", // Third color for special elements

	// Class diagram specific
	classText: "#ffffff",

	// State diagram specific
	labelColor: "#ffffff",

	// Sequence diagram specific
	actorLineColor: "#cccccc",
	actorBkg: "#2d2d2d",
	actorBorder: "#888888",
	actorTextColor: "#ffffff",

	// Flow diagram specific
	fillType0: "#2d2d2d",
	fillType1: "#3c3c3c",
	fillType2: "#454545",
}

mermaid.initialize({
	startOnLoad: false,
	securityLevel: "loose",
	theme: "dark",
	themeVariables: {
		...MERMAID_THEME,
		fontSize: "16px",
		fontFamily: "var(--vscode-font-family, 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif)",

		// Additional styling
		noteTextColor: "#ffffff",
		noteBkgColor: "#454545",
		noteBorderColor: "#888888",

		// Improve contrast for special elements
		critBorderColor: "#ff9580",
		critBkgColor: "#803d36",

		// Task diagram specific
		taskTextColor: "#ffffff",
		taskTextOutsideColor: "#ffffff",
		taskTextLightColor: "#ffffff",

		// Numbers/sections
		sectionBkgColor: "#2d2d2d",
		sectionBkgColor2: "#3c3c3c",

		// Alt sections in sequence diagrams
		altBackground: "#2d2d2d",

		// Links
		linkColor: "#6cb6ff",

		// Borders and lines
		compositeBackground: "#2d2d2d",
		compositeBorder: "#888888",
		titleColor: "#ffffff",
	},
})

interface MermaidBlockProps {
	code: string
}

export default function MermaidBlock({ code }: MermaidBlockProps) {
	const containerRef = useRef<HTMLDivElement>(null)
	const [isLoading, setIsLoading] = useState(false)

	// 1) Whenever `code` changes, mark that we need to re-render a new chart
	useEffect(() => {
		setIsLoading(true)
	}, [code])

	// 2) Debounce the actual parse/render
	useDebounceEffect(
		() => {
			if (containerRef.current) {
				containerRef.current.innerHTML = ""
			}
			mermaid
				.parse(code, { suppressErrors: true })
				.then((isValid) => {
					if (!isValid) {
						throw new Error("Invalid or incomplete Mermaid code")
					}
					const id = `mermaid-${Math.random().toString(36).substring(2)}`
					return mermaid.render(id, code)
				})
				.then(({ svg }) => {
					if (containerRef.current) {
						containerRef.current.innerHTML = svg
					}
				})
				.catch((err) => {
					console.warn("Mermaid parse/render failed:", err)
					containerRef.current!.innerHTML = code.replace(/</g, "&lt;").replace(/>/g, "&gt;")
				})
				.finally(() => {
					setIsLoading(false)
				})
		},
		500, // Delay 500ms
		[code], // Dependencies for scheduling
	)

	/**
	 * Called when user clicks the rendered diagram.
	 * Converts the <svg> to a PNG and sends it to the extension.
	 */
	const handleClick = async () => {
		if (!containerRef.current) return
		const svgEl = containerRef.current.querySelector("svg")
		if (!svgEl) return

		try {
			const pngDataUrl = await svgToPng(svgEl)
			vscode.postMessage({
				type: "openImage",
				text: pngDataUrl,
			})
		} catch (err) {
			console.error("Error converting SVG to PNG:", err)
		}
	}

	return (
		<MermaidBlockContainer>
			{isLoading && <LoadingMessage>Generating mermaid diagram...</LoadingMessage>}

			{/* The container for the final <svg> or raw code. */}
			<SvgContainer onClick={handleClick} ref={containerRef} $isLoading={isLoading} />
		</MermaidBlockContainer>
	)
}

async function svgToPng(svgEl: SVGElement): Promise<string> {
	console.log("svgToPng function called")
	// Clone the SVG to avoid modifying the original
	const svgClone = svgEl.cloneNode(true) as SVGElement

	// Get the original viewBox
	const viewBox = svgClone.getAttribute("viewBox")?.split(" ").map(Number) || []
	const originalWidth = viewBox[2] || svgClone.clientWidth
	const originalHeight = viewBox[3] || svgClone.clientHeight

	// Calculate the scale factor to fit editor width while maintaining aspect ratio

	// Unless we can find a way to get the actual editor window dimensions through the VS Code API (which might be possible but would require changes to the extension side),
	// the fixed width seems like a reliable approach.
	const editorWidth = 3_600

	const scale = editorWidth / originalWidth
	const scaledHeight = originalHeight * scale

	// Update SVG dimensions
	svgClone.setAttribute("width", `${editorWidth}`)
	svgClone.setAttribute("height", `${scaledHeight}`)

	const serializer = new XMLSerializer()
	const svgString = serializer.serializeToString(svgClone)
	const svgDataUrl = "data:image/svg+xml;base64," + btoa(decodeURIComponent(encodeURIComponent(svgString)))

	return new Promise((resolve, reject) => {
		const img = new Image()
		img.onload = () => {
			const canvas = document.createElement("canvas")
			canvas.width = editorWidth
			canvas.height = scaledHeight

			const ctx = canvas.getContext("2d")
			if (!ctx) return reject("Canvas context not available")

			// Fill background with Mermaid's dark theme background color
			ctx.fillStyle = MERMAID_THEME.background
			ctx.fillRect(0, 0, canvas.width, canvas.height)

			ctx.imageSmoothingEnabled = true
			ctx.imageSmoothingQuality = "high"

			ctx.drawImage(img, 0, 0, editorWidth, scaledHeight)
			resolve(canvas.toDataURL("image/png", 1.0))
		}
		img.onerror = reject
		img.src = svgDataUrl
	})
}

const MermaidBlockContainer = styled.div`
	position: relative;
	margin: 8px 0;
`

const LoadingMessage = styled.div`
	padding: 8px 0;
	color: var(--vscode-descriptionForeground);
	font-style: italic;
	font-size: 0.9em;
`

interface SvgContainerProps {
	$isLoading: boolean
}

const SvgContainer = styled.div<SvgContainerProps>`
	opacity: ${(props) => (props.$isLoading ? 0.3 : 1)};
	min-height: 20px;
	transition: opacity 0.2s ease;
	cursor: pointer;
	display: flex;
	justify-content: center;
`
