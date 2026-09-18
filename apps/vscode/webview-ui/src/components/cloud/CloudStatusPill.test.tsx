import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { CloudStatusPill, isCloudStatusActive } from "./CloudStatusPill"

describe("cloud outcome labels", () => {
	it.each([
		["cancelled", "Cancelled"],
		["unknown", "Status unknown"],
		["idle", "Cloud"],
	] as const)("does not present %s as successful or running", (status, label) => {
		render(<CloudStatusPill status={status} />)
		expect(screen.getByText(label)).toBeInTheDocument()
		expect(screen.queryByText("Done")).not.toBeInTheDocument()
		expect(isCloudStatusActive(status)).toBe(false)
	})

	it("labels confirmed completion Done", () => {
		render(<CloudStatusPill status="completed" />)
		expect(screen.getByText("Done")).toBeInTheDocument()
	})
})
