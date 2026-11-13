import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const themeCss = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "theme.css"), "utf8")

function extractBlock(source: string, selector: string): string {
	const needle = `${selector} {`
	const start = source.indexOf(needle)
	if (start === -1) {
		throw new Error(`missing ${selector} block`)
	}
	const open = source.indexOf("{", start)
	let depth = 0
	for (let i = open; i < source.length; i++) {
		const ch = source[i]
		if (ch === "{") {
			depth++
		} else if (ch === "}") {
			depth--
			if (depth === 0) {
				return source.slice(open + 1, i)
			}
		}
	}
	throw new Error(`unclosed ${selector} block`)
}

function cssVar(block: string, name: string): string {
	const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
	const match = block.match(new RegExp(`${escaped}:\\s*([^;]+);`))
	if (!match) {
		throw new Error(`missing ${name}`)
	}
	return match[1].trim()
}

function hexToRgb(hex: string): [number, number, number] {
	const n = hex.replace("#", "")
	return [Number.parseInt(n.slice(0, 2), 16), Number.parseInt(n.slice(2, 4), 16), Number.parseInt(n.slice(4, 6), 16)]
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
	const linear = [r, g, b].map((channel) => {
		const srgb = channel / 255
		return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4
	})
	return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
}

function contrastRatio(foreground: string, background: string): number {
	const a = relativeLuminance(hexToRgb(foreground))
	const b = relativeLuminance(hexToRgb(background))
	const [hi, lo] = a > b ? [a, b] : [b, a]
	return (hi + 0.05) / (lo + 0.05)
}

function mixHex(foreground: string, background: string, amount: number): string {
	const [fr, fg, fb] = hexToRgb(foreground)
	const [br, bg, bb] = hexToRgb(background)
	const mix = (from: number, to: number) => Math.round(from * amount + to * (1 - amount))
	return `#${[mix(fr, br), mix(fg, bg), mix(fb, bb)].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`
}

describe("webview warning theme tokens", () => {
	it("falls back to --warning when the host does not inject VS Code warning colors", () => {
		expect(themeCss).toContain("--color-warning: var(--vscode-charts-yellow, var(--warning));")
		expect(themeCss).toContain("--color-warning-foreground: var(--vscode-editorWarning-foreground, var(--warning));")
		expect(themeCss).toContain("--color-editor-warning-foreground: var(--vscode-editorWarning-foreground, var(--warning));")
	})

	it("defines per-scheme --warning that stays readable on light and dark banners", () => {
		const lightWarning = cssVar(extractBlock(themeCss, ":root"), "--warning")
		const darkWarning = cssVar(extractBlock(themeCss, ".dark"), "--warning")

		expect(lightWarning).toMatch(/^#[0-9a-fA-F]{6}$/)
		expect(darkWarning).toMatch(/^#[0-9a-fA-F]{6}$/)

		// JetBrains light themes inject --background/--foreground/--input but
		// not --warning. The :root fallback must contrast against white and
		// against the 10% warning banner tint used by PlanCompletionOutputRow.
		expect(contrastRatio(lightWarning, "#ffffff")).toBeGreaterThanOrEqual(4.5)
		expect(contrastRatio(lightWarning, mixHex(lightWarning, "#ffffff", 0.1))).toBeGreaterThanOrEqual(4.5)

		expect(contrastRatio(darkWarning, "#1e1e1e")).toBeGreaterThanOrEqual(4.5)
		expect(contrastRatio(darkWarning, mixHex(darkWarning, "#1e1e1e", 0.1))).toBeGreaterThanOrEqual(4.5)
	})
})
