import React, { useEffect, useRef, useState } from "react"
import mermaid from "mermaid"
import { useDebounceEffect } from "@src/utils/useDebounceEffect"
import { vscode } from "@src/utils/vscode"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { useCopyToClipboard } from "@src/utils/clipboard"
import CodeBlock from "./CodeBlock"
import { cn } from "@/lib/utils"

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
	const [error, setError] = useState<string | null>(null)
	const [isErrorExpanded, setIsErrorExpanded] = useState(false)
	const { showCopyFeedback, copyWithFeedback } = useCopyToClipboard()
	const { t } = useAppTranslation()

	// 1) Whenever `code` changes, mark that we need to re-render a new chart
	useEffect(() => {
		setIsLoading(true)
		setError(null)
	}, [code])

	// 2) Debounce the actual parse/render
	useDebounceEffect(
		() => {
			if (containerRef.current) {
				containerRef.current.innerHTML = ""
			}

			mermaid
				.parse(code)
				.then(() => {
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
					setError(err.message || "Failed to render Mermaid diagram")
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

	// Copy functionality handled directly through the copyWithFeedback utility

	return (
		<MermaidBlockContainer>
			{isLoading && <LoadingMessage>{t("common:mermaid.loading")}</LoadingMessage>}

			{error ? (
				<div className="mt-0 overflow-hidden mb-2">
					<div
						className={cn(
							"font-normal text-vscode-font-size text-vscode-editor-foreground flex items-center justify-between cursor-pointer",
							isErrorExpanded ? "border-b border-vscode-editorGroup-border" : "border-b-0",
						)}
						onClick={() => setIsErrorExpanded(!isErrorExpanded)}>
						<div className="flex items-center gap-2.5 flex-grow">
							<span className="codicon codicon-warning text-vscode-editorWarning-foreground opacity-80 text-base mb-[-1.5px]"></span>
							<span className="font-bold">{t("common:mermaid.render_error")}</span>
						</div>
						<div className="flex items-center">
							<CopyButton
								onClick={(e) => {
									e.stopPropagation()
									const combinedContent = `Error: ${error}\n\n\`\`\`mermaid\n${code}\n\`\`\``
									copyWithFeedback(combinedContent, e)
								}}>
								<span className={`codicon codicon-${showCopyFeedback ? "check" : "copy"}`}></span>
							</CopyButton>
							<span className={`codicon codicon-chevron-${isErrorExpanded ? "up" : "down"}`}></span>
						</div>
					</div>
					{isErrorExpanded && (
						<div className="p-2 bg-vscode-editor-background border-t-0">
							<div className="mb-2 text-vscode-descriptionForeground">{error}</div>
							<CodeBlock language="mermaid" source={code} />
						</div>
					)}
				</div>
			) : (
				<SvgContainer onClick={handleClick} ref={containerRef} isLoading={isLoading} />
			)}
		</MermaidBlockContainer>
	)
}

async function svgToPng(svgEl: SVGElement): Promise<string> {
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

const MermaidBlockContainer: React.FC<{ children: React.ReactNode }> = ({ children }) => {
	return <div className="relative my-2">{children}</div>
}

const LoadingMessage: React.FC<{ children: React.ReactNode }> = ({ children }) => {
	return <div className="py-2 text-vscode-descriptionForeground italic text-[0.9em]">{children}</div>
}

const CopyButton: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement>> = ({ children, ...props }) => {
	return (
		<button
			className="p-[3px] h-6 mr-1 text-vscode-editor-foreground flex items-center justify-center bg-transparent border-none cursor-pointer hover:opacity-80"
			{...props}>
			{children}
		</button>
	)
}

interface SvgContainerProps extends React.HTMLAttributes<HTMLDivElement> {
	isLoading: boolean
	children?: React.ReactNode
}

const SvgContainer = React.forwardRef<HTMLDivElement, SvgContainerProps>(({ isLoading, children, ...props }, ref) => {
	return (
		<div
			ref={ref}
			className={cn(
				"min-h-[20px] transition-opacity duration-200 ease-in-out cursor-pointer flex justify-center",
				isLoading ? "opacity-30" : "opacity-100",
			)}
			{...props}>
			{children}
		</div>
	)
})
SvgContainer.displayName = "SvgContainer"
