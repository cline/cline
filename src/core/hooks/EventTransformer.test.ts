/**
 * Tests for EventTransformer
 */

import { ToolUse } from "@core/assistant-message"
import { expect } from "chai"
import { beforeEach, describe, it } from "mocha"
import { ClineDefaultTool } from "@/shared/tools"
import { EventTransformer } from "./EventTransformer"

describe("EventTransformer", () => {
	let transformer: EventTransformer
	const taskId = "test-task-123"
	const cwd = "/workspace"
	const transcriptPath = "/logs/transcript.json"

	beforeEach(() => {
		transformer = new EventTransformer(taskId, cwd, transcriptPath)
	})

	describe("Common Fields", () => {
		it("should include common fields in all events", () => {
			const event = transformer.createNotificationEvent("Test message")

			expect(event.session_id).to.equal(taskId)
			expect(event.cwd).to.equal(cwd)
			expect(event.transcript_path).to.equal(transcriptPath)
			expect(event.hook_event_name).to.equal("Notification")
		})

		it("should handle missing transcript path", () => {
			const transformerNoTranscript = new EventTransformer(taskId, cwd)
			const event = transformerNoTranscript.createStopEvent()

			expect(event.transcript_path).to.equal("")
		})

		it("should update transcript path", () => {
			const transformerNoTranscript = new EventTransformer(taskId, cwd)
			transformerNoTranscript.setTranscriptPath("/new/path.json")
			const event = transformerNoTranscript.createStopEvent()

			expect(event.transcript_path).to.equal("/new/path.json")
		})
	})

	describe("PreToolUse Event", () => {
		it("should create PreToolUse event with correct tool mapping", () => {
			const toolBlock: ToolUse = {
				type: "tool_use",
				name: ClineDefaultTool.FILE_READ,
				params: { path: "/file.txt" },
				partial: false,
			}

			const event = transformer.createPreToolUseEvent(toolBlock)

			expect(event.hook_event_name).to.equal("PreToolUse")
			expect(event.tool_name).to.equal("Read") // Mapped from FILE_READ
			expect(event.tool_input).to.deep.equal({ path: "/file.txt" })
		})

		it("should map various tool names correctly", () => {
			const testCases = [
				{ cline: ClineDefaultTool.FILE_NEW, claude: "Write" },
				{ cline: ClineDefaultTool.FILE_EDIT, claude: "Edit" },
				{ cline: ClineDefaultTool.BASH, claude: "Bash" },
				{ cline: ClineDefaultTool.SEARCH, claude: "Grep" },
				{ cline: ClineDefaultTool.LIST_FILES, claude: "Glob" },
			]

			for (const testCase of testCases) {
				const toolBlock: ToolUse = {
					type: "tool_use",
					name: testCase.cline,
					params: {},
					partial: false,
				}

				const event = transformer.createPreToolUseEvent(toolBlock)
				expect(event.tool_name).to.equal(testCase.claude)
			}
		})
	})

	describe("PostToolUse Event", () => {
		it("should create PostToolUse event with response", () => {
			const toolBlock: ToolUse = {
				type: "tool_use",
				name: ClineDefaultTool.BASH,
				params: { command: "ls -la" },
				partial: false,
			}

			const response = { output: "file1.txt\nfile2.txt" }

			const event = transformer.createPostToolUseEvent(toolBlock, response)

			expect(event.hook_event_name).to.equal("PostToolUse")
			expect(event.tool_name).to.equal("Bash")
			expect(event.tool_input).to.deep.equal({ command: "ls -la" })
			expect(event.tool_response).to.deep.equal(response)
		})
	})

	describe("UserPromptSubmit Event", () => {
		it("should create UserPromptSubmit event", () => {
			const prompt = "Please write a function to sort an array"
			const event = transformer.createUserPromptSubmitEvent(prompt)

			expect(event.hook_event_name).to.equal("UserPromptSubmit")
			expect(event.prompt).to.equal(prompt)
		})
	})

	describe("Notification Event", () => {
		it("should create Notification event", () => {
			const message = "Tool requires user approval"
			const event = transformer.createNotificationEvent(message)

			expect(event.hook_event_name).to.equal("Notification")
			expect(event.message).to.equal(message)
		})
	})

	describe("Stop Events", () => {
		it("should create Stop event", () => {
			const event = transformer.createStopEvent(true)

			expect(event.hook_event_name).to.equal("Stop")
			expect(event.stop_hook_active).to.equal(true)
		})

		it("should create SubagentStop event", () => {
			const event = transformer.createSubagentStopEvent(false)

			expect(event.hook_event_name).to.equal("SubagentStop")
			expect(event.stop_hook_active).to.equal(false)
		})

		it("should default stop_hook_active to false", () => {
			const stopEvent = transformer.createStopEvent()
			const subagentEvent = transformer.createSubagentStopEvent()

			expect(stopEvent.stop_hook_active).to.equal(false)
			expect(subagentEvent.stop_hook_active).to.equal(false)
		})
	})

	describe("PreCompact Event", () => {
		it("should create PreCompact event with manual trigger", () => {
			const event = transformer.createPreCompactEvent("manual", "Keep recent context")

			expect(event.hook_event_name).to.equal("PreCompact")
			expect(event.trigger).to.equal("manual")
			expect(event.custom_instructions).to.equal("Keep recent context")
		})

		it("should create PreCompact event with auto trigger", () => {
			const event = transformer.createPreCompactEvent("auto")

			expect(event.hook_event_name).to.equal("PreCompact")
			expect(event.trigger).to.equal("auto")
			expect(event.custom_instructions).to.be.undefined
		})
	})

	describe("Session Events", () => {
		it("should create SessionStart event", () => {
			const event = transformer.createSessionStartEvent("startup")

			expect(event.hook_event_name).to.equal("SessionStart")
			expect(event.source).to.equal("startup")
		})

		it("should support different session sources", () => {
			const sources: Array<"startup" | "resume" | "clear"> = ["startup", "resume", "clear"]

			for (const source of sources) {
				const event = transformer.createSessionStartEvent(source)
				expect(event.source).to.equal(source)
			}
		})

		it("should create SessionEnd event", () => {
			const event = transformer.createSessionEndEvent()

			expect(event.hook_event_name).to.equal("SessionEnd")
		})
	})

	describe("Tool Input Extraction", () => {
		it("should extract FILE_READ input", () => {
			const toolBlock: ToolUse = {
				type: "tool_use",
				name: ClineDefaultTool.FILE_READ,
				params: { path: "/test.txt" },
				partial: false,
			}

			const extracted = EventTransformer.extractToolInput(toolBlock)
			expect(extracted).to.deep.equal({ path: "/test.txt" })
		})

		it("should extract FILE_NEW/FILE_EDIT input", () => {
			const toolBlock1: ToolUse = {
				type: "tool_use",
				name: ClineDefaultTool.FILE_NEW,
				params: { path: "/new.txt", content: "Hello" },
				partial: false,
			}

			const extracted1 = EventTransformer.extractToolInput(toolBlock1)
			expect(extracted1).to.deep.equal({ path: "/new.txt", content: "Hello" })

			const toolBlock2: ToolUse = {
				type: "tool_use",
				name: ClineDefaultTool.FILE_EDIT,
				params: { path: "/edit.txt", diff: "World" },
				partial: false,
			}

			const extracted2 = EventTransformer.extractToolInput(toolBlock2)
			expect(extracted2).to.deep.equal({ path: "/edit.txt", content: "World" })
		})

		it("should extract BASH input", () => {
			const toolBlock: ToolUse = {
				type: "tool_use",
				name: ClineDefaultTool.BASH,
				params: { command: "npm test" },
				partial: false,
			}

			const extracted = EventTransformer.extractToolInput(toolBlock)
			expect(extracted).to.deep.equal({ command: "npm test" })
		})

		it("should extract SEARCH input", () => {
			const toolBlock: ToolUse = {
				type: "tool_use",
				name: ClineDefaultTool.SEARCH,
				params: {
					path: "/src",
					regex: "TODO",
					file_pattern: "*.ts",
				},
				partial: false,
			}

			const extracted = EventTransformer.extractToolInput(toolBlock)
			expect(extracted).to.deep.equal({
				path: "/src",
				regex: "TODO",
				file_pattern: "*.ts",
			})
		})

		it("should return raw input for unknown tools", () => {
			const toolBlock: ToolUse = {
				type: "tool_use",
				name: "unknown_tool" as ClineDefaultTool,
				params: { path: "/custom/data" },
				partial: false,
			}

			const extracted = EventTransformer.extractToolInput(toolBlock)
			expect(extracted).to.deep.equal({ path: "/custom/data" })
		})
	})

	describe("Tool Response Transformation", () => {
		it("should wrap string responses", () => {
			const transformed = EventTransformer.transformToolResponse("Success")
			expect(transformed).to.deep.equal({ output: "Success" })
		})

		it("should wrap array responses", () => {
			const blocks = [{ type: "text", text: "Result" }]
			const transformed = EventTransformer.transformToolResponse(blocks)
			expect(transformed).to.deep.equal({ blocks })
		})

		it("should pass through object responses", () => {
			const response = { status: "ok", data: { value: 42 } }
			const transformed = EventTransformer.transformToolResponse(response)
			expect(transformed).to.deep.equal(response)
		})
	})
})
