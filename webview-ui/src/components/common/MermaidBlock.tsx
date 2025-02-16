import React, { useEffect, useRef } from "react"
import mermaid from "mermaid"

mermaid.initialize({
	startOnLoad: false,
	securityLevel: "loose",
})

interface MermaidBlockProps {
	code: string
}

export default function MermaidBlock({ code }: MermaidBlockProps) {
	const containerRef = useRef<HTMLDivElement>(null)

	useEffect(() => {
		// 1) Clear previous render
		if (containerRef.current) {
			containerRef.current.innerHTML = ""
		}

		// 2) Try parse
		mermaid
			.parse(code, { suppressErrors: true })
			.then((isValid) => {
				if (!isValid) {
					throw new Error("Invalid or incomplete Mermaid code")
				}
				// 3) If valid, do the actual render
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
	}, [code])

	return <div ref={containerRef} />
}
