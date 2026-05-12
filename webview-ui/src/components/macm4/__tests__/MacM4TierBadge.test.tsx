import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { MacM4TierBadge, classifyTier } from "../MacM4TierBadge"

describe("classifyTier (pure)", () => {
	it("recognises the canonical local-fast id", () => {
		const r = classifyTier("local-fast")
		expect(r?.kind).toBe("local")
		expect(r?.backend).toBe("mlx")
		expect(r?.label).toContain("MLX")
	})

	it("recognises the gpt- prefixed Cursor mirror", () => {
		const r = classifyTier("gpt-local-fast")
		expect(r?.kind).toBe("local")
	})

	it("classifies local-long and local-agent as Ollama-backed", () => {
		expect(classifyTier("local-long")?.backend).toBe("ollama")
		expect(classifyTier("local-agent")?.backend).toBe("ollama")
	})

	it("classifies the Claude tiers as cloud", () => {
		expect(classifyTier("claude-haiku-4-5")?.kind).toBe("cloud")
		expect(classifyTier("claude-sonnet-4-6")?.kind).toBe("cloud")
		expect(classifyTier("claude-opus-4-7")?.kind).toBe("cloud")
		expect(classifyTier("claude-code")?.kind).toBe("cloud")
	})

	it("classifies hybrid-auto as router", () => {
		const r = classifyTier("hybrid-auto")
		expect(r?.kind).toBe("router")
		expect(r?.backend).toBe("litellm-router")
	})

	it("returns undefined for unknown tier ids", () => {
		expect(classifyTier("gpt-4")).toBeUndefined()
		expect(classifyTier("")).toBeUndefined()
		expect(classifyTier("random-model")).toBeUndefined()
	})
})

describe("<MacM4TierBadge />", () => {
	it("renders the tier label for a known id", () => {
		render(<MacM4TierBadge tierId="local-fast" />)
		expect(screen.getByText(/local · MLX/i)).toBeTruthy()
	})

	it("renders nothing for unknown tier ids", () => {
		const { container } = render(<MacM4TierBadge tierId="totally-unknown" />)
		expect(container.firstChild).toBeNull()
	})

	it("shows the cold hint when warm=false on a local tier", () => {
		render(<MacM4TierBadge tierId="local-long" warm={false} />)
		expect(screen.getByText(/cold/i)).toBeTruthy()
	})

	it("does not show cold hint for cloud tiers regardless of warm", () => {
		render(<MacM4TierBadge tierId="claude-opus-4-7" warm={false} />)
		expect(screen.queryByText(/cold/i)).toBeNull()
	})

	it("uses the compact label when compact=true", () => {
		render(<MacM4TierBadge tierId="local-long" compact />)
		// Compact label drops the backend portion ("· Ollama")
		const txt = screen.getByText(/local/i).textContent ?? ""
		expect(txt).not.toContain("Ollama")
	})

	it("includes the reason as a title attribute when provided", () => {
		const { container } = render(<MacM4TierBadge tierId="hybrid-auto" reason="task=12 tok, default" />)
		const span = container.querySelector("[data-tier]") as HTMLElement | null
		expect(span?.getAttribute("title")).toBe("task=12 tok, default")
	})

	it("stamps data-tier attribute for downstream targeting", () => {
		const { container } = render(<MacM4TierBadge tierId="local-fast" />)
		const span = container.querySelector('[data-tier="local-fast"]')
		expect(span).toBeTruthy()
		expect(span?.getAttribute("data-tier-kind")).toBe("local")
	})
})
