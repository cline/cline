import "should"
import { describe, it } from "mocha"
import { convertAnthropicMessagesToGemini } from "../gemini-format"

describe("gemini-format", () => {
	it("uses the original tool name for function responses and preserves the tool call id", () => {
		const contents = convertAnthropicMessagesToGemini([
			{
				role: "user",
				content: "list files",
			},
			{
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "resp_1-tool-0",
						name: "run_commands",
						input: { commands: ["ls -la /app"] },
					},
				],
			},
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "resp_1-tool-0",
						content: "total 0",
					},
				],
			},
		] as any)

		const functionCall = contents[1].parts![0].functionCall!
		const functionResponse = contents[2].parts![0].functionResponse!

		functionCall.should.deepEqual({
			id: "resp_1-tool-0",
			name: "run_commands",
			args: { commands: ["ls -la /app"] },
		})
		functionResponse.should.deepEqual({
			id: "resp_1-tool-0",
			name: "run_commands",
			response: {
				result: "total 0",
			},
		})
	})

	it("can resolve function response names from Cline call_id metadata", () => {
		const contents = convertAnthropicMessagesToGemini([
			{
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "tool-use-id",
						call_id: "provider-call-id",
						name: "read_file",
						input: { path: "/tmp/example.txt" },
					},
				],
			},
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "tool-use-id",
						call_id: "provider-call-id",
						content: "hello",
					},
				],
			},
		] as any)

		const functionResponse = contents[1].parts![0].functionResponse!
		functionResponse.name.should.equal("read_file")
		functionResponse.id.should.equal("tool-use-id")
	})
})
