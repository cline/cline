import { describe, it } from "mocha"
import "should"
import type { ToolUse } from "@core/assistant-message"
import type { Mode } from "@shared/storage/types"
import { TaskState } from "../../../TaskState"
import type { TaskConfig } from "../../types/TaskConfig"
import { NewTaskHandler } from "../NewTaskHandler"

const handler = new NewTaskHandler()

const baseMode = "plan" as Mode

const createConfig = (overrides: Partial<TaskConfig> = {}): TaskConfig => {
	const taskState = overrides.taskState ?? new TaskState()

	const config = {
		taskId: "task",
		ulid: "ulid",
		cwd: ".",
		mode: baseMode,
		strictPlanModeEnabled: false,
		yoloModeToggled: false,
		context: {} as any,
		taskState,
		messageState: {
			getClineMessages: () => [],
			saveClineMessagesAndUpdateHistory: async () => {},
			updateClineMessage: async () => {},
		} as any,
		api: {} as any,
		services: {} as any,
		autoApprovalSettings: {
			enabled: false,
			enableNotifications: false,
		} as any,
		autoApprover: {} as any,
		browserSettings: {} as any,
		focusChainSettings: {} as any,
		callbacks: {
			say: async () => undefined,
			ask: async () => ({ response: "" as any }),
			saveCheckpoint: async () => {},
			sayAndCreateMissingParamError: async () => "",
			removeLastPartialMessageIfExistsWithType: async () => {},
			executeCommandTool: async () => [false, ""] as [boolean, any],
			doesLatestTaskCompletionHaveNewChanges: async () => false,
			updateFCListFromToolResponse: async () => {},
			shouldAutoApproveTool: () => false,
			shouldAutoApproveToolWithPath: async () => false,
			postStateToWebview: async () => {},
			reinitExistingTaskFromId: async () => {},
			cancelTask: async () => {},
			updateTaskHistory: async () => [],
			applyLatestBrowserSettings: async () => ({} as any),
			switchToActMode: async () => true,
		},
		coordinator: {} as any,
	}

	return { ...config, ...overrides, taskState } as TaskConfig
}

describe("NewTaskHandler", () => {
	describe("execute", () => {
		it("blocks in ACT mode", async () => {
			const config = createConfig({ mode: "act" as Mode })
			const block = {
				name: "new_task",
				params: {
					context: "Context",
				},
			} as unknown as ToolUse

			const result = await handler.execute(config, block)

			;(typeof result).should.equal("string")
			;(result as string).should.containEql("ACT MODE")
		})

		it("blocks when template boilerplate is present", async () => {
			const config = createConfig()
			const block = {
				name: "new_task",
				params: {
					context: "1. Current Work: details\n2. Key Technical Concepts:",
				},
			} as unknown as ToolUse

			const result = await handler.execute(config, block)

			;(typeof result).should.equal("string")
			;(result as string).should.containEql("template boilerplate")
		})

		it("blocks when instructional phrasing tells the agent to create a new task", async () => {
			const config = createConfig()
			const block = {
				name: "new_task",
				params: {
					context:
						"The user wants to create an impressive HTML5 website. We should create a new task with context and set up todo list. According to instructions: - Create a comprehensive checklist of all steps needed. Include the task_progress parameter in the next tool call.",
				},
			} as unknown as ToolUse

			const result = await handler.execute(config, block)

			;(typeof result).should.equal("string")
			;(result as string).should.containEql("template boilerplate")
		})

		it("blocks environment detail template phrasing", async () => {
			const config = createConfig()
			const block = {
				name: "new_task",
				params: {
					context:
						"We have the environment details: VSCode has files src/index.html, src/js.js, src/styles.css, src/todo.md. There's also a new task in context and the user wants a todo list and plan.",
				},
			} as unknown as ToolUse

			const result = await handler.execute(config, block)

			;(typeof result).should.equal("string")
			;(result as string).should.containEql("template boilerplate")
		})

		it("blocks \"Thinking\" preamble that kicks off new task instructions", async () => {
			const config = createConfig()
			const block = {
				name: "new_task",
				params: {
					context:
						"Thinking we have a task: 'Make an impressive HTML5 website.' Cline wants to start a new task and set up a todo list.",
				},
			} as unknown as ToolUse

			const result = await handler.execute(config, block)

			;(typeof result).should.equal("string")
			;(result as string).should.containEql("template boilerplate")
		})

		it("blocks todo list restatement phrasing", async () => {
			const config = createConfig()
			const block = {
				name: "new_task",
				params: {
					context: "Here is your todo list for creating an impressive HTML5 website: - [ ] Analyze requirements",
				},
			} as unknown as ToolUse

			const result = await handler.execute(config, block)

			;(typeof result).should.equal("string")
			;(result as string).should.containEql("template boilerplate")
		})

		it("blocks markdown-format todo list phrasing", async () => {
			const config = createConfig()
			const block = {
				name: "new_task",
				params: {
					context: "Todo list with markdown format:\n- [ ] Analyze requirements",
				},
			} as unknown as ToolUse

			const result = await handler.execute(config, block)

			;(typeof result).should.equal("string")
			;(result as string).should.containEql("template boilerplate")
		})

		it("blocks contexts that echo tool instructions", async () => {
			const config = createConfig()
			const context = `- [ ] Analyze requirements
- [ ] Set up necessary files

# Reminder: Instructions for Tool
Tool uses are formatted using XML.
You have no instructions`;
			const block = {
				name: "new_task",
				params: {
					context,
				},
			} as unknown as ToolUse

			const result = await handler.execute(config, block)

			;(typeof result).should.equal("string")
			;(result as string).should.containEql("template boilerplate")
		})

		it("blocks instructions about generating a new task with context", async () => {
			const config = createConfig()
			const block = {
				name: "new_task",
				params: {
					context:
						"We need to generate a new task with context. We will use the new_task tool and keep the todo list in markdown format. We should not do anything else — let's produce the XML and embed the checklist in the context field.",
				},
			} as unknown as ToolUse

			const result = await handler.execute(config, block)

			;(typeof result).should.equal("string")
			;(result as string).should.containEql("template boilerplate")
		})

		it("blocks task summary boilerplate that mirrors new task panel", async () => {
			const config = createConfig()
			const context = `Task
You are now creating a new task for making an impressive HTML5 website.
Current Work: Nothing was done before this request.
Key Technical Concepts: HTML5, CSS, JavaScript, VSCode, Node, npm.
Relevant Files and Code: src/index.html, src/js, src/css.
Pending Tasks and Next Steps:
- [ ] Analyze requirements
- [ ] Set up necessary files
- [ ] Implement main functionality
- [ ] Handle edge cases
- [ ] Test the implementation
- [ ] Verify results
Todo List:
- [ ] Analyze requirements`
			const block = {
				name: "new_task",
				params: {
					context,
				},
			} as unknown as ToolUse

			const result = await handler.execute(config, block)

			;(typeof result).should.equal("string")
			;(result as string).should.containEql("template boilerplate")
		})

		it("blocks bare task heading with checklist items", async () => {
			const config = createConfig()
			const context = `Task
- [ ] Analyze requirements
- [ ] Set up necessary files (src/index.html, src/js.js, src/styles.css)
- [ ] Implement main functionality`
			const block = {
				name: "new_task",
				params: {
					context,
				},
			} as unknown as ToolUse

			const result = await handler.execute(config, block)

			;(typeof result).should.equal("string")
			;(result as string).should.containEql("template boilerplate")
		})

		it("blocks task heading with colon and checkbox lines without bullets", async () => {
			const config = createConfig()
			const context = `Task:
[ ] Analyze requirements
[ ] Set up necessary files (src/index.html, src/js.js, src/styles.css)
[ ] Implement main functionality`
			const block = {
				name: "new_task",
				params: {
					context,
				},
			} as unknown as ToolUse

			const result = await handler.execute(config, block)

			;(typeof result).should.equal("string")
			;(result as string).should.containEql("template boilerplate")
		})

		it("blocks bare checklist templates without headings", async () => {
			const config = createConfig()
			const context = `- [ ] Analyze requirements
- [ ] Set up necessary files
- [ ] Implement main functionality
- [ ] Handle edge cases`
			const block = {
				name: "new_task",
				params: {
					context,
				},
			} as unknown as ToolUse

			const result = await handler.execute(config, block)

			;(typeof result).should.equal("string")
			;(result as string).should.containEql("template boilerplate")
		})

		it("blocks reasoning loops that keep suggesting <new_task>", async () => {
			const config = createConfig()
			const context = `We can use the new_task tool to create a todo list. But we need to have the task progress parameter in the next tool call.
We can do: <new_task>
<context> ... (including todo list)
But we need to have the task progress parameter in the next tool call.
We can do: <new_task>
<context> ... (including todo list)
But we need to have the task progress parameter in the next tool call.
We can do: <new_task>
<context> ... (including todo list)`
			const block = {
				name: "new_task",
				params: {
					context,
				},
			} as unknown as ToolUse

			const result = await handler.execute(config, block)

			;(typeof result).should.equal("string")
			;(result as string).should.containEql("template boilerplate")
		})

		it("blocks task summary panels listing existing files", async () => {
			const config = createConfig()
			const context = `Task

1. Current Work:
Existing files and open tabs are:
  ○ src/index.html
  ○ src/styles.css
  ○ src/js.js These files currently contain basic HTML structure, CSS styles, JavaScript code.
2. Key Technical Concepts:
  ○ HTML5 standard markup.
  ○ CSS styling for layout and aesthetics.
  ○ JavaScript for interactivity and dynamic content.
  ○ Web development tools: VSCode, npm, git, curl, etc.
3. Relevant Files and Code:
  ○ src/index.html: contains basic page structure.
  ○ src/styles.css: includes styles for layout.
  ○ src/js.js: contains JavaScript.`
			const block = {
				name: "new_task",
				params: {
					context,
				},
			} as unknown as ToolUse

			const result = await handler.execute(config, block)

			;(typeof result).should.equal("string")
			;(result as string).should.containEql("template boilerplate")
		})

		it("blocks task summary panels declaring no prior tasks", async () => {
			const config = createConfig()
			const context = `Task

1. Current Work: No prior tasks.
2. Key Technical Concepts: HTML5, CSS, JavaScript, Node.js (if needed).
3. Relevant Files & Code: src/index.html, src/js.js, src/styles.css.
4. Problem Solving: None.
5. Pending Tasks and Next Steps:
   ○ [ ] Analyze requirements
   ○ [ ] Set up necessary files
   ○ [ ] Implement main functionality
   ○ [ ] Handle edge cases
   ○ [ ] Test the implementation
   ○ [ ] Verify results`
			const block = {
				name: "new_task",
				params: {
					context,
				},
			} as unknown as ToolUse

			const result = await handler.execute(config, block)

			;(typeof result).should.equal("string")
			;(result as string).should.containEql("template boilerplate")
		})

		it("blocks contexts that instruct creating a new task tool call", async () => {
			const config = createConfig()
			const block = {
				name: "new_task",
				params: {
					context:
						"ThinkingUser wants to create an impressive HTML5 website. We should output a tool call to create a new_task with context and provide the task_progress parameter in the next tool call.",
				},
			} as unknown as ToolUse

			const result = await handler.execute(config, block)

			;(typeof result).should.equal("string")
			;(result as string).should.containEql("template boilerplate")
		})

		it("blocks numbered task summary template", async () => {
			const config = createConfig()
			const context = `Task

1. Current Work: Make an impressive HTML5 website.
2. Key Technical Concepts:
   ○ HTML5
   ○ CSS
   ○ JavaScript
3. Relevant Files & Code: src/index.html, src/js.js, src/styles.css
4. Problem Solving: No pending issues yet.
5. Pending Tasks and Next Steps:
   ○ [ ] Analyze requirements
   ○ [ ] Set up necessary files
   ○ [ ] Implement main functionality
   ○ [ ] Handle edge cases
   ○ [ ] Test the implementation
   ○ [ ] Verify results`
			const block = {
				name: "new_task",
				params: {
					context,
				},
			} as unknown as ToolUse

			const result = await handler.execute(config, block)

			;(typeof result).should.equal("string")
			;(result as string).should.containEql("template boilerplate")
		})

		it("blocks numbered task summary template without colons", async () => {
			const config = createConfig()
			const context = `Task

1. Current Work (none)
2. Key Technical Concepts
   • HTML5
   • CSS
   • JavaScript
3. Relevant Files & Code
4. Problem Solving (none)
5. Pending Tasks & Next Steps
   • [ ] Analyze requirements`
			const block = {
				name: "new_task",
				params: {
					context,
				},
			} as unknown as ToolUse

			const result = await handler.execute(config, block)

			;(typeof result).should.equal("string")
			;(result as string).should.containEql("template boilerplate")
		})

		it("blocks bullet task summary template", async () => {
			const config = createConfig()
			const context = `Task
- Current Work: "Creating an HTML5 website from scratch."
- Key Technical Concepts: HTML5 structure, CSS styling, JavaScript functionality.
- Relevant Files and Code: src/index.html (currently empty), src/js.js (empty), src/css (empty).
- Problem Solving: None.
- Pending Tasks and Next Steps: Steps to create website:
  ○ [ ] Analyze requirements`
			const block = {
				name: "new_task",
				params: {
					context,
				},
			} as unknown as ToolUse

			const result = await handler.execute(config, block)

			;(typeof result).should.equal("string")
			;(result as string).should.containEql("template boilerplate")
		})

		it("blocks when task already has progress", async () => {
			const taskState = new TaskState()
			taskState.currentFocusChainChecklist = "- [ ] Existing item"
			const config = createConfig({ taskState })
			const block = {
				name: "new_task",
				params: {
					context: "User explicitly requested a new task",
				},
			} as unknown as ToolUse

			const result = await handler.execute(config, block)

			;(typeof result).should.equal("string")
			;(result as string).should.containEql("already in the middle")
		})

		it("allows creating a new task when no work has started", async () => {
			let asked = false
			const baseConfig = createConfig()
			const config = createConfig({
				callbacks: {
					...baseConfig.callbacks,
					ask: async () => {
						asked = true
						return {
							response: "" as any,
						}
					},
				},
			})
			const block = {
				name: "new_task",
				params: {
					context: "User explicitly requested a new, unrelated task.",
				},
			} as unknown as ToolUse

			const result = await handler.execute(config, block)

			asked.should.be.true()
			;(typeof result).should.equal("string")
			;(result as string).should.containEql("created a new task")
		})
	})
})
