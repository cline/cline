import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { CloudStatusPill, isCloudStatusActive } from "./CloudStatusPill"

describe("cloud outcome labels", () => {
	it.each([
		["cancelled", "Cancelled"],
		["unknown", "Unconfirmed"],
		["idle", "Cloud"],
	] as const)("does not present %s as successful or running", (status, label) => {
		const { container } = render(<CloudStatusPill status={status} />)
		expect(screen.getByText(label)).toBeInTheDocument()
		expect(screen.queryByText("Done")).not.toBeInTheDocument()
		expect(container.querySelector(".animate-spin")).not.toBeInTheDocument()
		expect(isCloudStatusActive(status)).toBe(false)
	})

	it("labels confirmed completion Done", () => {
		render(<CloudStatusPill status="completed" />)
		expect(screen.getByText("Done")).toBeInTheDocument()
	})

	it("animates only while the sandbox is starting or the agent is working", () => {
		const { container } = render(<CloudStatusPill status="running" />)
		expect(container.querySelector(".animate-spin")).toBeInTheDocument()
	})
})
