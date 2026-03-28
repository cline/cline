import type { ClineMessage } from "@shared/ExtensionMessage"
import { render } from "ink-testing-library"
import React from "react"
import { describe, expect, it, vi } from "vitest"
import { ChatMessage } from "./ChatMessage"

vi.mock("../hooks/useTerminalSize", () => ({
	useTerminalSize: () => ({
		columns: 120,
		rows: 40,
		resizeKey: 0,
	}),
}))

describe("ChatMessage markdown rendering", () => {
	it("renders basic markdown elements correctly with appropriate styling", () => {
		const message: ClineMessage = {
			ts: Date.now(),
			type: "say",
			say: "text",
			text: "# Heading 1\n\nThis is a **bold** and *italic* text with `inline code`.\n\n- List item 1\n- List item 2\n\n> Blockquote\n\n```javascript\nconst x = 1;\n```",
		}

		const { lastFrame } = render(React.createElement(ChatMessage, { message, mode: "act" }))
		const frame = lastFrame() || ""

		// Check for heading (bold)
		// \x1B[1m is the ANSI escape code for bold
		expect(frame).toMatch(/\x1B\[1mHeading 1\x1B\[22m/)

		// Check for bold text
		expect(frame).toMatch(/\x1B\[1mbold\x1B\[22m/)

		// Check for italic text
		// \x1B[3m is the ANSI escape code for italic
		expect(frame).toMatch(/\x1B\[3mitalic\x1B\[23m/)

		// Check for inline code (no special styling in the current implementation, just text)
		expect(frame).toContain("inline code")

		// Check for list items (gray bullet)
		// \x1B[90m is the ANSI escape code for gray
		expect(frame).toMatch(/\x1B\[90m• \x1B\[39mList item 1/)
		expect(frame).toMatch(/\x1B\[90m• \x1B\[39mList item 2/)

		// Check for blockquote (gray pipe)
		expect(frame).toMatch(/\x1B\[90m│ \x1B\[39mBlockquote/)

		// Check for code block (cyan text)
		// \x1B[36m is the ANSI escape code for cyan
		expect(frame).toMatch(/\x1B\[36mconst x = 1;\x1B\[39m/)
	})
})
