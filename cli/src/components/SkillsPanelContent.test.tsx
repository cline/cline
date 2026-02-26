/**
 * Tests for SkillsPanelContent component
 *
 * Tests keyboard interactions and callbacks.
 * Rendering tests are limited due to ink-testing-library constraints with nested components.
 */

import { render } from "ink-testing-library"
// biome-ignore lint/correctness/noUnusedImports: React must be in scope for JSX in this test file.
import React from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

// Mock refreshSkills
const mockRefreshSkills = vi.fn()
vi.mock("@/core/controller/file/refreshSkills", () => ({
	refreshSkills: () => mockRefreshSkills(),
}))

// Mock toggleSkill
const mockToggleSkill = vi.fn()
vi.mock("@/core/controller/file/toggleSkill", () => ({
	toggleSkill: (...args: unknown[]) => mockToggleSkill(...args),
}))

// Mock child_process exec
const mockExec = vi.fn()
vi.mock("node:child_process", () => ({
	exec: (...args: unknown[]) => mockExec(...args),
}))

// Mock StdinContext
vi.mock("../context/StdinContext", () => ({
	useStdinContext: () => ({ isRawModeSupported: true }),
}))

import { SkillsPanelContent } from "./SkillsPanelContent"

// Helper to wait for async state updates
const delay = (ms = 60) => new Promise((resolve) => setTimeout(resolve, ms))

describe("SkillsPanelContent", () => {
	const mockController = {} as any
	const mockOnClose = vi.fn()
	const mockOnUseSkill = vi.fn()

	const defaultProps = {
		controller: mockController,
		onClose: mockOnClose,
		onUseSkill: mockOnUseSkill,
	}

	beforeEach(() => {
		vi.clearAllMocks()
		mockRefreshSkills.mockResolvedValue({
			globalSkills: [],
			localSkills: [],
		})
	})

	describe("keyboard interactions", () => {
		it("should call onClose when Escape is pressed", async () => {
			mockRefreshSkills.mockResolvedValue({
				globalSkills: [],
				localSkills: [],
			})

			const { stdin } = render(<SkillsPanelContent {...defaultProps} />)
			await delay()

			stdin.write("\x1B") // Escape
			await delay()

			expect(mockOnClose).toHaveBeenCalled()
		})

		it("should call onUseSkill with skill path when Enter is pressed on a skill", async () => {
			mockRefreshSkills.mockResolvedValue({
				globalSkills: [{ name: "test-skill", description: "Test", path: "/test/path/SKILL.md", enabled: true }],
				localSkills: [],
			})

			const { stdin } = render(<SkillsPanelContent {...defaultProps} />)
			await delay()

			stdin.write("\r") // Enter
			await delay()

			expect(mockOnUseSkill).toHaveBeenCalledWith("/test/path/SKILL.md")
		})

		it("should call toggleSkill when Space is pressed on a skill", async () => {
			mockRefreshSkills.mockResolvedValue({
				globalSkills: [{ name: "test-skill", description: "Test", path: "/test/path/SKILL.md", enabled: true }],
				localSkills: [],
			})

			const { stdin } = render(<SkillsPanelContent {...defaultProps} />)
			await delay()

			stdin.write(" ") // Space
			await delay()

			expect(mockToggleSkill).toHaveBeenCalledWith(
				mockController,
				expect.objectContaining({
					skillPath: "/test/path/SKILL.md",
					isGlobal: true,
					enabled: false, // toggled from true to false
				}),
			)
		})

		it("should open marketplace URL when Enter is pressed on marketplace item", async () => {
			mockRefreshSkills.mockResolvedValue({
				globalSkills: [{ name: "skill", description: "desc", path: "/path", enabled: true }],
				localSkills: [],
			})

			const { stdin } = render(<SkillsPanelContent {...defaultProps} />)
			await delay()

			// Navigate down to marketplace (past the one skill)
			stdin.write("\x1B[B") // Down arrow
			await delay()

			stdin.write("\r") // Enter
			await delay()

			// Should have called exec with open command
			expect(mockExec).toHaveBeenCalled()
			const execCall = mockExec.mock.calls[0][0]
			expect(execCall).toContain("https://skills.sh/")
		})

		it("should navigate through skills with arrow keys", async () => {
			mockRefreshSkills.mockResolvedValue({
				globalSkills: [
					{ name: "skill-1", description: "First", path: "/path1", enabled: true },
					{ name: "skill-2", description: "Second", path: "/path2", enabled: true },
				],
				localSkills: [],
			})

			const { stdin } = render(<SkillsPanelContent {...defaultProps} />)
			await delay()

			// Navigate down
			stdin.write("\x1B[B") // Down arrow
			await delay()

			// Press Enter - should use second skill
			stdin.write("\r")
			await delay()

			expect(mockOnUseSkill).toHaveBeenCalledWith("/path2")
		})

		it("should navigate with vim keys (j/k)", async () => {
			mockRefreshSkills.mockResolvedValue({
				globalSkills: [
					{ name: "skill-1", description: "First", path: "/path1", enabled: true },
					{ name: "skill-2", description: "Second", path: "/path2", enabled: true },
				],
				localSkills: [],
			})

			const { stdin } = render(<SkillsPanelContent {...defaultProps} />)
			await delay()

			// Navigate down with j
			stdin.write("j")
			await delay()

			// Press Enter - should use second skill
			stdin.write("\r")
			await delay()

			expect(mockOnUseSkill).toHaveBeenCalledWith("/path2")
		})

		it("should revert optimistic toggle on failure", async () => {
			mockRefreshSkills.mockResolvedValue({
				globalSkills: [{ name: "test-skill", description: "Test", path: "/test/path/SKILL.md", enabled: true }],
				localSkills: [],
			})
			mockToggleSkill.mockRejectedValueOnce(new Error("toggle failed"))

			const { stdin, lastFrame } = render(<SkillsPanelContent {...defaultProps} />)
			await delay()

			stdin.write(" ") // Space to toggle
			await delay(100)

			// toggleSkill was called with enabled: false (toggled from true)
			expect(mockToggleSkill).toHaveBeenCalledWith(mockController, expect.objectContaining({ enabled: false }))
			const frame = lastFrame() || ""
			expect(frame).toContain("● test-skill")
			expect(frame).not.toContain("○ test-skill")
		})

		it("should wrap navigation at list boundaries", async () => {
			mockRefreshSkills.mockResolvedValue({
				globalSkills: [{ name: "only-skill", description: "Only", path: "/only", enabled: true }],
				localSkills: [],
			})

			const { stdin } = render(<SkillsPanelContent {...defaultProps} />)
			await delay()

			// Navigate up from first item (should wrap to last - marketplace)
			stdin.write("\x1B[A") // Up arrow
			await delay()

			stdin.write("\r") // Enter
			await delay()

			// Should have opened marketplace (wrapped to last item)
			expect(mockExec).toHaveBeenCalled()
		})
	})

	describe("skill loading", () => {
		it("should call refreshSkills on mount", async () => {
			render(<SkillsPanelContent {...defaultProps} />)
			await delay()

			expect(mockRefreshSkills).toHaveBeenCalled()
		})
	})
})
