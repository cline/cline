// npx jest src/shared/__tests__/combineCommandSequences.test.ts

import { ClineMessage } from "../ExtensionMessage"

import { combineCommandSequences } from "../combineCommandSequences"

const messages: ClineMessage[] = [
	{
		ts: 1745710928469,
		type: "say",
		say: "api_req_started",
		text: '{"request":"<task>\\nRun the command \\"ping w…tes":12117,"cacheReads":0,"cost":0.020380125}',
		images: undefined,
	},
	{
		ts: 1745710930332,
		type: "say",
		say: "text",
		text: "Okay, I can run that command for you. The `pin…'s reachable and measure the round-trip time.",
		images: undefined,
	},
	{ ts: 1745710930748, type: "ask", ask: "command", text: "ping www.google.com", partial: false },
	{ ts: 1745710930894, type: "say", say: "command_output", text: "", images: undefined },
	{ ts: 1745710930894, type: "ask", ask: "command_output", text: "" },
	{
		ts: 1745710930954,
		type: "say",
		say: "command_output",
		text: "PING www.google.com (142.251.46.228): 56 data bytes\n",
		images: undefined,
	},
	{
		ts: 1745710930954,
		type: "ask",
		ask: "command_output",
		text: "PING www.google.com (142.251.46.228): 56 data bytes\n",
	},
]

describe("combineCommandSequences", () => {
	it("should combine command sequences", () => {
		const message = combineCommandSequences(messages).at(-1)
		expect(message!.text).toEqual(
			"ping www.google.com\nOutput:PING www.google.com (142.251.46.228): 56 data bytes\n",
		)
	})
})
