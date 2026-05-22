import { beforeEach, describe, expect, it, vi } from "vitest"

const reportMapEventMock = vi.fn().mockResolvedValue({})

vi.mock("../../../services/grpc-client", () => ({
	MapServiceClient: {
		reportMapEvent: reportMapEventMock,
	},
}))

describe("mapSessionBridge", () => {
	beforeEach(() => {
		reportMapEventMock.mockClear()
	})

	it("reportMapEvent sends typed event to host", async () => {
		const { reportMapEvent } = await import("../mapSessionBridge")
		reportMapEvent("roi.set", { name: "Basin", areaHa: 100 })
		await vi.waitFor(() => expect(reportMapEventMock).toHaveBeenCalled())
		const req = reportMapEventMock.mock.calls[0][0]
		expect(req.event?.type).toBe("roi.set")
		expect(req.event?.source).toBe("user")
		expect(JSON.parse(req.event?.payloadJson ?? "{}")).toEqual({ name: "Basin", areaHa: 100 })
	})
})
