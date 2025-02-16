import React, { useRef } from "react"
import mermaid from "mermaid"
import { useDebounceEffect } from "../../utils/useDebounceEffect"

mermaid.initialize({
	startOnLoad: false,
	securityLevel: "loose",
})

interface MermaidBlockProps {
	code: string
}

export default function MermaidBlock({ code }: MermaidBlockProps) {
	const containerRef = useRef<HTMLDivElement>(null)

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
				})
		},
		500, // Delay 500ms
		[code], // Dependencies for scheduling
	)

	return <div ref={containerRef} />
}
