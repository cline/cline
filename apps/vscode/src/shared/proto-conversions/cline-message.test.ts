import { describe, expect, it } from "vitest"
import { convertClineMessageToProto, convertProtoToClineMessage } from "./cline-message"

describe("ClineMessage command completion conversion", () => {
	it("round-trips the explicit command completion state", () => {
		const proto = convertClineMessageToProto({
			ts: 1,
			type: "say",
			say: "command",
			text: "bun test",
			commandCompleted: true,
			commandStatus: "killed",
		})

		expect(proto.commandCompleted).toBe(true)
		expect(convertProtoToClineMessage(proto).commandCompleted).toBe(true)
		expect(convertProtoToClineMessage(proto).commandStatus).toBe("killed")
	})
})
