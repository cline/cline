import { HtmlPreviewMode } from "@shared/proto/cline/html_preview"
import { AiHydroDefaultTool } from "@shared/tools"
import { expect } from "chai"
import { describe, it } from "mocha"
import { ToolUse } from "../../../../assistant-message"
import { PreviewHtmlToolHandler } from "../PreviewHtmlToolHandler"

describe("PreviewHtmlToolHandler", () => {
	const handler = new PreviewHtmlToolHandler()

	describe("getDescription", () => {
		it("should return description with title when provided", () => {
			const block: ToolUse = {
				name: AiHydroDefaultTool.PREVIEW_HTML,
				params: { title: "My Chart" } as Record<string, string>,
				type: "tool_use",
				partial: false,
			}
			expect(handler.getDescription(block)).to.equal("[preview_html - My Chart]")
		})

		it("should return description with default title when not provided", () => {
			const block: ToolUse = {
				name: AiHydroDefaultTool.PREVIEW_HTML,
				params: {} as Record<string, string>,
				type: "tool_use",
				partial: false,
			}
			expect(handler.getDescription(block)).to.equal("[preview_html - HTML Preview]")
		})
	})

	describe("parseMode", () => {
		it("should parse interactive mode from mode param", () => {
			const result = PreviewHtmlToolHandler.parseMode("interactive", undefined)
			expect(result).to.equal(HtmlPreviewMode.INTERACTIVE)
		})

		it("should parse external_browser mode from mode param", () => {
			const result = PreviewHtmlToolHandler.parseMode("external_browser", undefined)
			expect(result).to.equal(HtmlPreviewMode.EXTERNAL_BROWSER)
		})

		it("should parse external mode shorthand", () => {
			const result = PreviewHtmlToolHandler.parseMode("external", undefined)
			expect(result).to.equal(HtmlPreviewMode.EXTERNAL_BROWSER)
		})

		it("should parse numeric mode '1' as interactive", () => {
			const result = PreviewHtmlToolHandler.parseMode("1", undefined)
			expect(result).to.equal(HtmlPreviewMode.INTERACTIVE)
		})

		it("should parse numeric mode '2' as external_browser", () => {
			const result = PreviewHtmlToolHandler.parseMode("2", undefined)
			expect(result).to.equal(HtmlPreviewMode.EXTERNAL_BROWSER)
		})

		it("should fallback to interactive mode for backward compatibility with interactive=true", () => {
			const result = PreviewHtmlToolHandler.parseMode(undefined, "true")
			expect(result).to.equal(HtmlPreviewMode.INTERACTIVE)
		})

		it("should fallback to interactive mode for backward compatibility with interactive=yes", () => {
			const result = PreviewHtmlToolHandler.parseMode(undefined, "yes")
			expect(result).to.equal(HtmlPreviewMode.INTERACTIVE)
		})

		it("should fallback to interactive mode for backward compatibility with interactive=1", () => {
			const result = PreviewHtmlToolHandler.parseMode(undefined, "1")
			expect(result).to.equal(HtmlPreviewMode.INTERACTIVE)
		})

		it("should default to UNSPECIFIED for unknown mode values (auto-detect on extension)", () => {
			const result = PreviewHtmlToolHandler.parseMode("unknown_mode", undefined)
			expect(result).to.equal(HtmlPreviewMode.UNSPECIFIED)
		})

		it("should default to UNSPECIFIED when both params are undefined", () => {
			const result = PreviewHtmlToolHandler.parseMode(undefined, undefined)
			expect(result).to.equal(HtmlPreviewMode.UNSPECIFIED)
		})

		it("should prefer mode param over interactive param", () => {
			const result = PreviewHtmlToolHandler.parseMode("safe", "true")
			expect(result).to.equal(HtmlPreviewMode.SAFE)
		})

		it("should ignore case and whitespace in mode param", () => {
			const result = PreviewHtmlToolHandler.parseMode("  INTERACTIVE  ", undefined)
			expect(result).to.equal(HtmlPreviewMode.INTERACTIVE)
		})
	})
})
