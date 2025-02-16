import { useEffect, useRef, useState } from "react"
import mermaid from "mermaid"
import { useDebounceEffect } from "../../utils/useDebounceEffect"
import styled from "styled-components"

mermaid.initialize({
	startOnLoad: false,
	securityLevel: "loose",
	theme: "dark",
	themeVariables: {
		background: "#1e1e1e",
		textColor: "#ffffff", // make text much brighter
		mainBkg: "#2d2d2d",
		lineColor: "#cccccc", // light enough for contrast
		fontSize: "16px",
		primaryColor: "#3c3c3c", // node fill color, etc.
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

	return (
		<MermaidBlockContainer>
			{isLoading && <LoadingMessage>Creating mermaid chart...</LoadingMessage>}

			{/* The container for the final <svg> or raw code. */}
			<SvgContainer ref={containerRef} $isLoading={isLoading} />
		</MermaidBlockContainer>
	)
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
`
