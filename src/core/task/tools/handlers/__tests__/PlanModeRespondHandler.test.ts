import { describe, it } from "mocha"
import "should"
import type { ToolUse } from "@core/assistant-message"
import type { Mode } from "@shared/storage/types"
import { TaskState } from "../../../TaskState"
import type { TaskConfig } from "../../types/TaskConfig"
import { PlanModeRespondHandler, responseImpliesFurtherWork } from "../PlanModeRespondHandler"

describe("PlanModeRespondHandler", () => {
	const handler = new PlanModeRespondHandler()

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
			autoApprovalSettings: {} as any,
			autoApprover: {} as any,
			browserSettings: {} as any,
			focusChainSettings: {} as any,
			callbacks: {
				say: async () => undefined,
				ask: async () => ({ response: "user_input" as any }),
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
				applyLatestBrowserSettings: async () => ({}) as any,
				switchToActMode: async () => true,
			},
			coordinator: {} as any,
		}

		return { ...config, ...overrides, taskState } as TaskConfig
	}

	describe("responseImpliesFurtherWork", () => {
		it("detects unchecked todo items", () => {
			responseImpliesFurtherWork("- [ ] Analyze requirements", []).should.be.true()
		})

		it("detects file references", () => {
			responseImpliesFurtherWork("Check src/index.ts", []).should.be.true()
		})

		it("detects continue options", () => {
			responseImpliesFurtherWork("Plan", ["Continue execution"]).should.be.true()
		})

		it("returns false for simple acknowledgment", () => {
			responseImpliesFurtherWork("All steps done", []).should.be.false()
		})
	})

	describe("execute", () => {
		it("blocks when further work is implied but exploration flag missing", async () => {
			const config = createConfig()
			const block = {
				name: "plan_mode_respond",
				params: {
					response: "- [ ] Check src/index.html",
					options: "[]",
				},
			} as unknown as ToolUse

			const result = await handler.execute(config, block)

			;(typeof result).should.equal("string")
			;(result as string).should.containEql("needs_more_exploration")
		})

		it("allows exploration when flag is true", async () => {
			const config = createConfig()
			const block = {
				name: "plan_mode_respond",
				params: {
					response: "- [ ] Check src/index.html",
					options: "[]",
					needs_more_exploration: "true",
				},
			} as unknown as ToolUse

			const result = await handler.execute(config, block)

			;(typeof result).should.equal("string")
			;(result as string).should.containEql("You have indicated that you need more exploration")
		})

		it("requires task_progress when a checklist is provided", async () => {
			const config = createConfig()
			config.mode = "act"
			config.taskState.didReadProjectFile = true
			const block = {
				name: "plan_mode_respond",
				params: {
					response: "[ ] Draft implementation steps",
					options: "[]",
				},
			} as unknown as ToolUse

			const result = await handler.execute(config, block)

			;(typeof result).should.equal("string")
			;(result as string).should.containEql("task_progress")
		})

		it("rejects placeholder text from the new-task template", async () => {
			const config = createConfig()
			config.mode = "act"
			config.taskState.didReadProjectFile = true
			const block = {
				name: "plan_mode_respond",
				params: {
					response:
						"1. Current Work:\n[Detailed description of what was being worked on prior to this request to create a new task]\n\n6. Todo List (Checklist):\n[ ] Analyze requirements",
					options: "[]",
				},
			} as unknown as ToolUse

			const result = await handler.execute(config, block)

			;(typeof result).should.equal("string")
			;(result as string).should.containEql("placeholder text for starting a brand new task")
		})

		it("rejects attempt_completion responses when no work has been performed", async () => {
			const config = createConfig()
			const block = {
				name: "plan_mode_respond",
				params: {
					response:
						"<attempt_completion>Task Completed</attempt_completion> New website has been built. All files created and ready for testing.",
					options: "[]",
				},
			} as unknown as ToolUse

			const result = await handler.execute(config, block)

			;(typeof result).should.equal("string")
			;(result as string).should.containEql("no files were read, edited, or commands executed")
		})

		it("rejects completion phrase when no file reads or edits have occurred", async () => {
			const config = createConfig()
			config.mode = "act"
			const block = {
				name: "plan_mode_respond",
				params: {
					response: "All tasks are completed and the website is ready. Great work!",
					options: "[]",
				},
			} as unknown as ToolUse

			const result = await handler.execute(config, block)

			;(typeof result).should.equal("string")
			;(result as string).should.containEql("no files were read, edited, or commands executed")
		})

		it("rejects completion language when task_progress still has unchecked items", async () => {
			const config = createConfig()
			config.mode = "act"
			config.taskState.didReadProjectFile = true
			const block = {
				name: "plan_mode_respond",
				params: {
					response: "Task Completed. Ready to hand off to the user.",
					task_progress: "- [x] Analyze requirements\n- [ ] Implement main functionality",
					options: "[]",
				},
			} as unknown as ToolUse

			const result = await handler.execute(config, block)

			;(typeof result).should.equal("string")
			;(result as string).should.containEql("task is complete even though <task_progress> still has unchecked items")
		})

		it("rejects instructional phrasing that asks to create a new task", async () => {
			const config = createConfig()
			config.mode = "act"
			config.taskState.didReadProjectFile = true
			const block = {
				name: "plan_mode_respond",
				params: {
					response:
						"We should create a new task with context and set up todo list. According to instructions: include the task_progress parameter in the next tool call.",
					options: "[]",
				},
			} as unknown as ToolUse

			const result = await handler.execute(config, block)

			;(typeof result).should.equal("string")
			;(result as string).should.containEql("placeholder text for starting a brand new task")
		})

		it("rejects environment detail template phrasing", async () => {
			const config = createConfig()
			config.mode = "act"
			config.taskState.didReadProjectFile = true
			const block = {
				name: "plan_mode_respond",
				params: {
					response:
						"We have the environment details: VSCode has files src/index.html, src/js.js, src/styles.css, src/todo.md. There's also a new task in context and the user wants a todo list and plan.",
					options: "[]",
				},
			} as unknown as ToolUse

			const result = await handler.execute(config, block)

			;(typeof result).should.equal("string")
			;(result as string).should.containEql("placeholder text for starting a brand new task")
		})

		it("rejects \"Thinking\" preamble that kicks off new task instructions", async () => {
			const config = createConfig()
			config.mode = "act"
			config.taskState.didReadProjectFile = true
			const block = {
				name: "plan_mode_respond",
				params: {
					response:
						"Thinking we have a task: \"Make an impressive HTML5 website.\" Cline wants to start a new task and set up a todo list.",
					options: "[]",
				},
			} as unknown as ToolUse

			const result = await handler.execute(config, block)

			;(typeof result).should.equal("string")
			;(result as string).should.containEql("placeholder text for starting a brand new task")
		})

		it("rejects todo list restatement phrasing", async () => {
			const config = createConfig()
			config.mode = "act"
			config.taskState.didReadProjectFile = true
			const block = {
				name: "plan_mode_respond",
				params: {
					response: "Here is your todo list for creating an impressive HTML5 website: - [ ] Analyze requirements",
					options: "[]",
				},
			} as unknown as ToolUse

			const result = await handler.execute(config, block)

			;(typeof result).should.equal("string")
			;(result as string).should.containEql("placeholder text for starting a brand new task")
		})

		it("rejects markdown-format todo list phrasing", async () => {
			const config = createConfig()
			config.mode = "act"
			config.taskState.didReadProjectFile = true
			const block = {
				name: "plan_mode_respond",
				params: {
					response: "Todo list with markdown format:\n- [ ] Analyze requirements",
					options: "[]",
				},
			} as unknown as ToolUse

			const result = await handler.execute(config, block)

			;(typeof result).should.equal("string")
			;(result as string).should.containEql("placeholder text for starting a brand new task")
		})

		it("rejects responses that echo tool instructions", async () => {
			const config = createConfig()
			config.mode = "act"
			config.taskState.didReadProjectFile = true
			const response = `- [ ] Analyze requirements
- [ ] Set up necessary files

# Reminder: Instructions for Tool
Tool uses are formatted using XML.
You have no instructions`;
			const block = {
				name: "plan_mode_respond",
				params: {
					response,
					task_progress: "- [ ] Analyze requirements",
					options: "[]",
				},
			} as unknown as ToolUse

			const result = await handler.execute(config, block)

			;(typeof result).should.equal("string")
			;(result as string).should.containEql("placeholder text for starting a brand new task")
		})

		it("rejects responses that restate the task_progress checklist", async () => {
			const config = createConfig()
			config.mode = "act"
			config.taskState.didReadProjectFile = true
			const checklist = `- [ ] Analyze requirements\n- [ ] Set up necessary files\n- [ ] Implement main functionality`
			const block = {
				name: "plan_mode_respond",
				params: {
					response: `Here is the plan checklist:\n${checklist}\nWe'll tackle these one by one.`,
					task_progress: checklist,
					options: "[]",
				},
			} as unknown as ToolUse

			const result = await handler.execute(config, block)

			;(typeof result).should.equal("string")
			;(result as string).should.containEql("Don't repeat the checklist from <task_progress>")
		})

		it("rejects instructions to output a new_task tool call", async () => {
			const config = createConfig()
			config.mode = "act"
			config.taskState.didReadProjectFile = true
			const block = {
				name: "plan_mode_respond",
				params: {
					response:
						"ThinkingUser wants to create an impressive HTML5 website. We should output a tool call to create a new_task with context and provide the task_progress parameter in the next tool call.",
					options: "[]",
				},
			} as unknown as ToolUse

			const result = await handler.execute(config, block)

			;(typeof result).should.equal("string")
			;(result as string).should.containEql("placeholder text for starting a brand new task")
		})

		it("rejects concatenated ThinkingWe new task boilerplate", async () => {
			const config = createConfig()
			config.mode = "act"
			config.taskState.didReadProjectFile = true
			const block = {
				name: "plan_mode_respond",
				params: {
					response:
						"ThinkingWe have a task: Create an impressive HTML5 website. Cline wants to start a new task and set up a todo list before doing any work.",
					options: "[]",
				},
			} as unknown as ToolUse

			const result = await handler.execute(config, block)

			;(typeof result).should.equal("string")
			;(result as string).should.containEql("placeholder text for starting a brand new task")
		})

		it("rejects plan responses parroting todo guidelines and XML new_task formatting", async () => {
			const config = createConfig()
			config.mode = "act"
			config.taskState.didReadProjectFile = true
			const block = {
				name: "plan_mode_respond",
				params: {
					response:
						"ThinkingUser wants to create an impressive HTML5 website. We should first create a todo list as per guidelines. The task_progress parameter must include markdown checklist steps. We will provide an XML formatted <new_task> with context even though we are already in ACT mode.",
					options: "[]",
				},
			} as unknown as ToolUse

			const result = await handler.execute(config, block)

			;(typeof result).should.equal("string")
			;(result as string).should.containEql("placeholder text for starting a brand new task")
		})

		it("rejects reasoning that insists on starting a new task before using tools", async () => {
			const config = createConfig()
			config.mode = "act"
			config.taskState.didReadProjectFile = true
			const response =
				"Thinking The user wants to create an impressive HTML5 website. The current environment details indicate that there already exist files: src/index.html, src/js.js, src/styles.css. The user has no existing website yet. We need to start a new task. According to the instructions, we should create a todo list. We must include the task_progress parameter in next tool call and provide comprehensive checklist of all steps needed using markdown format. Also we need to keep the todo list updated throughout the task. We can proceed by creating a new_task with context that includes details.";
			const block = {
				name: "plan_mode_respond",
				params: {
					response,
					options: "[]",
				},
			} as unknown as ToolUse

			const result = await handler.execute(config, block)

			;(typeof result).should.equal("string")
			;(result as string).should.containEql("placeholder text for starting a brand new task")
		})

		it("rejects simple phrasing to start a new task", async () => {
			const config = createConfig()
			config.mode = "act"
			config.taskState.didReadProjectFile = true
			const block = {
				name: "plan_mode_respond",
				params: {
					response: "Let's start a new task and build a checklist before continuing.",
					options: "[]",
				},
			} as unknown as ToolUse

			const result = await handler.execute(config, block)

			;(typeof result).should.equal("string")
			;(result as string).should.containEql("placeholder text for starting a brand new task")
		})

		it("rejects new_task boilerplate instructions about generating context", async () => {
			const config = createConfig()
			config.mode = "act"
			config.taskState.didReadProjectFile = true
			const block = {
				name: "plan_mode_respond",
				params: {
					response:
						"We need to generate a new task with context. We will use the new_task tool and keep the todo list in markdown format. We should not do anything else — let's produce the XML and embed the checklist in the context field.",
					options: "[]",
				},
			} as unknown as ToolUse

			const result = await handler.execute(config, block)

			;(typeof result).should.equal("string")
			;(result as string).should.containEql("placeholder text for starting a brand new task")
		})

		it("rejects task summary boilerplate that mirrors new task panel", async () => {
			const config = createConfig()
			config.mode = "act"
			config.taskState.didReadProjectFile = true
			const response = `Task
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
				name: "plan_mode_respond",
				params: {
					response,
					options: "[]",
				},
			} as unknown as ToolUse

			const result = await handler.execute(config, block)

			;(typeof result).should.equal("string")
			;(result as string).should.containEql("placeholder text for starting a brand new task")
		})

		it("rejects reasoning that insists on producing new_task with context", async () => {
			const config = createConfig()
			config.mode = "act"
			config.taskState.didReadProjectFile = false
			const response = `We have the task: "Create an impressive HTML5 website". We need to create a todo list. The user is in ACT mode. We must produce a new task with the context as described. We must produce <new_task> with the context. Since we are in ACT mode, we can only use tools for building and modifying files, but not plan_mode_respond. But we should create a new task. We'll also need to include the todo list in the next tool call. The user is asked to create a todo list. We should produce the new_task with context including the current work. We should produce a <new_task> with the context that includes: 1. Current Work: "Create an impressive HTML5 website" (the task description). 2. Key Technical Concepts: "HTML5, CSS, JavaScript, web development". 3. Relevant Files and Code: "src/index.html", "src.js.js", "src/styles.css". We should mention the file names and possibly some code snippet. 4. Problem Solving: Not yet. 5. Pending Tasks and Next Steps: We'll create a comprehensive checklist of steps needed. The user requested to create a todo list, so we must include that as part of the context. We need to produce a new_task with the context. Thus, final output: <new_task> with context and <task_progress> with todo list.`
			const block = {
				name: "plan_mode_respond",
				params: {
					response,
					options: "[]",
				},
			} as unknown as ToolUse

			const result = await handler.execute(config, block)

			;(typeof result).should.equal("string")
			;(result as string).should.containEql("placeholder text for starting a brand new task")
		})

		it("rejects reasoning that debates whether to call new_task", async () => {
			const config = createConfig()
			config.mode = "act"
			config.taskState.didReadProjectFile = false
			const response = `Task: Create an impressive HTML5 website. We need to create a todo list. The user expects the next tool call with task_progress parameter. Also we must create comprehensive checklist of all steps needed. Use markdown format - [ ] for incomplete, - [x] for completed. The user instructions: "Create an impressive HTML 5 website" and "TODO LIST RECOMMENDED" etc. So first step: create a todo list. We should call new_task? Actually we need to start new task. We may use new_task tool to create a new task with context. The user hasn't explicitly requested to start a new task, but the instructions recommend that we create a todo list at beginning. We can do that. So next step: create a todo list. We should call new_task? The environment details indicate current mode ACT MODE. So we cannot use plan_mode_respond. But we can use new_task with context to preload. It will produce a preview of our generated context and user may choose to start new task or keep chatting in the current conversation. Since the user has not explicitly requested to create a new task, but the instructions recommend that we create a todo list at beginning, so we can do it. We need to provide context: Current work, Key technical concepts, Relevant files and code, Problem solving, Pending tasks and next steps. We can create a new_task with context. So next step: create a new task with the context including the todo list. Now, let's write the code: <new_task> <context>...</context>`
			const block = {
				name: "plan_mode_respond",
				params: {
					response,
					options: "[]",
				},
			} as unknown as ToolUse

			const result = await handler.execute(config, block)

			;(typeof result).should.equal("string")
			;(result as string).should.containEql("placeholder text for starting a brand new task")
		})

		it("rejects metacognitive uncertainty loops that conclude with finalizing new_task", async () => {
			const config = createConfig()
			config.mode = "act"
			config.taskState.didReadProjectFile = false
			const response = `We have task: Create an impressive HTML5 website. The user says "Create an impressive HTML5 website". We are in ACT mode. Must create a todo list to track progress. We should create the new_task? But the user says "Create an impressive HTML5 website". So the task is: Create an HTML5 website. We must provide a new task with context. But we are in ACT mode, so we cannot use new_task unless the user explicitly requested to start a new task. Actually the user only said "Create an impressive HTML5 website". We can create a new task from this statement. The instructions: When starting a new task, it is recommended to create a todo list. We need to create a new_task with context. So we will call <new_task> with context containing the current work and the user request. But let's think: For a new task, we want to create a comprehensive checklist of all steps needed. But I think we should include it in the new_task's content. Let's see: We have instructions: "When starting a new task, it is recommended to create a todo list." So we need to create a new_task with context that includes a todo list. But let's also think: We should provide the new task with context, including the todo list as part of the content. Ok, I think we can create a new_task with context containing a todo list and details. Let's finalize.`
			const block = {
				name: "plan_mode_respond",
				params: {
					response,
					options: "[]",
				},
			} as unknown as ToolUse

			const result = await handler.execute(config, block)

			;(typeof result).should.equal("string")
			;(result as string).should.containEql("placeholder text for starting a brand new task")
		})

		it("rejects reasoning that interprets missing tool usage as requiring new_task", async () => {
			const config = createConfig()
			config.mode = "act"
			config.taskState.didReadProjectFile = false
			const response = `The user is complaining that the assistant didn't use a tool in previous response. The assistant responded with a description of plan steps but no tool usage. We need to respond by using a tool, according to instructions. We must do: create a todo list with task_progress and steps. Use tool "new_task" or maybe "plan_mode_respond"? But the user is in ACT mode, so we cannot use plan_mode_respond. Should use new_task to create new task with context. But we need to include the todo list in the next tool call. The instructions: "When starting a new task, it is recommended to create a todo list." We need to create a new task and include the todo list. Use the new_task tool. Also include task_progress parameter. We can use new_task with context that includes: - Current Work: description of what was done prior (the plan steps). - Key Technical Concepts: HTML5, CSS, JS, etc. - Relevant Files and Code: src/index.html, src/styles.css, src/js.js. - Problem Solving: nothing yet. - Pending Tasks and Next Steps: list the steps to create a website. Ok. Let's produce the response: <new_task> with context and task_progress.`
			const block = {
				name: "plan_mode_respond",
				params: {
					response,
					options: "[]",
				},
			} as unknown as ToolUse

			const result = await handler.execute(config, block)

			;(typeof result).should.equal("string")
			;(result as string).should.containEql("placeholder text for starting a brand new task")
		})

		it("rejects planning loop with false commitment phrases", async () => {
			const config = createConfig()
			config.mode = "act"
			config.taskState.didReadProjectFile = false
			const response = `Task: Create an impressive HTML5 website. Plan: Steps: 1. Analyze requirements. 2. Set up necessary files. 3. Implement main functionality. We need a todo list with progress. First we create new task. We should use <new_task> with context containing previous work. Use <plan_mode_respond? Not in ACT mode, but we can plan and present the plan to user; but since the environment is ACT mode, we need to proceed directly. So we start with new_task. Let's produce a plan. Use <plan_mode_respond> to give the plan. Ok. Let's do. We'll use <ask_followup_question> to get user's preferences. But next step: set up necessary files. We'll use write_to_file tool. We'll use write_to_file: <write_to_file> with path src/new.css. We also use write_to_file for new HTML file. Also update the todo list after each step. We need to wait for user response. Then we proceed accordingly. Let's proceed.`
			const block = {
				name: "plan_mode_respond",
				params: {
					response,
					options: "[]",
				},
			} as unknown as ToolUse

			const result = await handler.execute(config, block)

			;(typeof result).should.equal("string")
			;(result as string).should.containEql("placeholder text for starting a brand new task")
		})

		it("rejects bare task heading with checklist items", async () => {
			const config = createConfig()
			config.mode = "act"
			config.taskState.didReadProjectFile = true
			const response = `Task
- [ ] Analyze requirements
- [ ] Set up necessary files (src/index.html, src/js.js, src/styles.css)
- [ ] Implement main functionality`
			const block = {
				name: "plan_mode_respond",
				params: {
					response,
					options: "[]",
				},
			} as unknown as ToolUse

			const result = await handler.execute(config, block)

			;(typeof result).should.equal("string")
			;(result as string).should.containEql("placeholder text for starting a brand new task")
		})

		it("rejects task heading with colon and checkbox lines without bullets", async () => {
			const config = createConfig()
			config.mode = "act"
			config.taskState.didReadProjectFile = true
			const response = `Task:
[ ] Analyze requirements
[ ] Set up necessary files (src/index.html, src/js.js, src/styles.css)
[ ] Implement main functionality`
			const block = {
				name: "plan_mode_respond",
				params: {
					response,
					options: "[]",
				},
			} as unknown as ToolUse

			const result = await handler.execute(config, block)

			;(typeof result).should.equal("string")
			;(result as string).should.containEql("placeholder text for starting a brand new task")
		})

		it("rejects bare checklist templates without headings", async () => {
			const config = createConfig()
			config.mode = "act"
			config.taskState.didReadProjectFile = true
			const response = `- [ ] Analyze requirements
- [ ] Set up necessary files
- [ ] Implement main functionality
- [ ] Handle edge cases`
			const block = {
				name: "plan_mode_respond",
				params: {
					response,
					options: "[]",
				},
			} as unknown as ToolUse

			const result = await handler.execute(config, block)

			;(typeof result).should.equal("string")
			;(result as string).should.containEql("placeholder text for starting a brand new task")
		})

		it("rejects reasoning loops that keep suggesting <new_task>", async () => {
			const config = createConfig()
			config.mode = "act"
			config.taskState.didReadProjectFile = true
			const response = `We can use the new_task tool to create a todo list. But we need to have the task progress parameter in the next tool call.
We can do: <new_task>
<context> ... (including todo list)
But we need to have the task progress parameter in the next tool call.
We can do: <new_task>
<context> ... (including todo list)
But we need to have the task progress parameter in the next tool call.
We can do: <new_task>
<context> ... (including todo list)`
			const block = {
				name: "plan_mode_respond",
				params: {
					response,
					options: "[]",
				},
			} as unknown as ToolUse

			const result = await handler.execute(config, block)

			;(typeof result).should.equal("string")
			;(result as string).should.containEql("placeholder text for starting a brand new task")
		})

		it("rejects task_progress parameter confusion reasoning loop", async () => {
			const config = createConfig()
			config.mode = "act"
			config.taskState.didReadProjectFile = true
			const response = `We need to modify src/index.html. We should include task_progress parameter in next tool call. 
We will use <replace_in_file> to modify index.html content. Thus we will do: replace_in_file for index.html. 
Therefore final answer: Use <replace_in_file> to modify index.html. We will provide this. 
So we should update the todo list. We must include task_progress:
- [ ] Analyze requirements
- [ ] Set up necessary files
- [x] Create new index.html file`
			const block = {
				name: "plan_mode_respond",
				params: {
					response,
					options: "[]",
				},
			} as unknown as ToolUse

			const result = await handler.execute(config, block)

			;(typeof result).should.equal("string")
			;(result as string).should.containEql("placeholder text for starting a brand new task")
		})

		it("rejects task_progress to new_task substitution reasoning", async () => {
			const config = createConfig()
			config.mode = "act"
			config.taskState.didReadProjectFile = true
			const response = `We need to create a todo list. We must include task_progress parameter. We'll use new_task to create a todo list. 
But the new_task tool does not have a task_progress parameter. We can just create a new task with context including todo list. 
We will output: <new_task> <context>... We'll include the todo list as part of context. Now, let's implement. We need to create new_task. 
Now, let's produce the output.`
			const block = {
				name: "plan_mode_respond",
				params: {
					response,
					options: "[]",
				},
			} as unknown as ToolUse

			const result = await handler.execute(config, block)

			;(typeof result).should.equal("string")
			;(result as string).should.containEql("placeholder text for starting a brand new task")
		})

		it("rejects multi-step workflow planning that only executes new_task first step", async () => {
			const config = createConfig()
			config.mode = "act"
			config.taskState.didReadProjectFile = true
			const response = `Step 1: Create new task with context. First step: <new_task> with context and task_progress param. 
Then we use <ask_followup_question> to ask user. Then we will use <read_file> to read index.html. 
Then we will use <replace_in_file> to modify it. We'll include the task_progress parameter in next tool call after. 
Ok. Now we proceed. We will do the following: create new_task, then ask_followup_question, then read_file. 
Ok. Let's craft the XML. We'll produce: <new_task>. Now we produce the final answer.`
			const block = {
				name: "plan_mode_respond",
				params: {
					response,
					options: "[]",
				},
			} as unknown as ToolUse

			const result = await handler.execute(config, block)

			;(typeof result).should.equal("string")
			;(result as string).should.containEql("placeholder text for starting a brand new task")
		})

		it("blocks plan_mode_respond usage in ACT mode (non-yolo)", async () => {
			const config = createConfig()
			config.mode = "act"
			config.yoloModeToggled = false
			config.taskState.didReadProjectFile = true
			config.taskState.didEditFile = true
			const response = `Please do any further edits or updates on the HTML file or provide additional instructions for completing the remaining steps. The next tasks are: handling edge cases and verifying results.`
			const block = {
				name: "plan_mode_respond",
				params: {
					response,
					options: "[]",
				},
			} as unknown as ToolUse

			const result = await handler.execute(config, block)

			;(typeof result).should.equal("string")
			;(result as string).should.containEql("only available in PLAN mode")
		})

		it("rejects reasoning that misinterprets ACT mode as allowing new_task", async () => {
			const config = createConfig()
			config.mode = "act"
			config.taskState.didReadProjectFile = true
			const response = `The environment details show we are in ACT MODE. So we can create a new task. We must first create a new task with the context. Let's create a new_task. Provide context: current work, key technical concepts, etc. Now proceed with <new_task> tool. First: <new_task> tool. Then we can create todo list. Ok. Now produce the final answer.`
			const block = {
				name: "plan_mode_respond",
				params: {
					response,
					options: "[]",
				},
			} as unknown as ToolUse

			const result = await handler.execute(config, block)

			;(typeof result).should.equal("string")
			;(result as string).should.containEql("placeholder text for starting a brand new task")
		})

		it("rejects reasoning that plans to output new_task tool XML", async () => {
			const config = createConfig()
			config.mode = "act"
			config.taskState.didReadProjectFile = true
			const response = `We must use the \`new_task\` tool to create new task with context. We will call \`new_task\`. We'll start with new_task. Ok, let's write the code accordingly. Now, let's output the code accordingly. Cline wants to start a new task: Task Current Work: ...`
			const block = {
				name: "plan_mode_respond",
				params: {
					response,
					options: "[]",
				},
			} as unknown as ToolUse

			const result = await handler.execute(config, block)

			;(typeof result).should.equal("string")
			;(result as string).should.containEql("placeholder text for starting a brand new task")
		})

		it("rejects task summary panels listing existing files", async () => {
			const config = createConfig()
			config.mode = "act"
			config.taskState.didReadProjectFile = true
			const response = `Task

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
				name: "plan_mode_respond",
				params: {
					response,
					options: "[]",
				},
			} as unknown as ToolUse

			const result = await handler.execute(config, block)

			;(typeof result).should.equal("string")
			;(result as string).should.containEql("placeholder text for starting a brand new task")
		})

		it("rejects task summary panels declaring no prior tasks", async () => {
			const config = createConfig()
			config.mode = "act"
			config.taskState.didReadProjectFile = true
			const response = `Task

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
				name: "plan_mode_respond",
				params: {
					response,
					options: "[]",
				},
			} as unknown as ToolUse

			const result = await handler.execute(config, block)

			;(typeof result).should.equal("string")
			;(result as string).should.containEql("placeholder text for starting a brand new task")
		})

		it("rejects plan-mode boilerplate that narrates tool usage", async () => {
			const config = createConfig()
			config.mode = "act"
			config.taskState.didReadProjectFile = true
			const response = `Maybe not necessary. Ok, let's proceed. The user is in ACT mode. We can provide the final result with attempt_completion if we have succeeded all steps. But we need to confirm that each tool used was successful and the user has responded accordingly. The user might respond after the replace_in_file call with success or failure info. We need to wait for user response before proceeding. So we will send this. Let's do: We send the replace_in_file tool usage with the todo list updated. We then wait for the user response. Ok, let's output the tool usage.`
			const block = {
				name: "plan_mode_respond",
				params: {
					response,
					options: "[]",
				},
			} as unknown as ToolUse

			const result = await handler.execute(config, block)

			;(typeof result).should.equal("string")
			;(result as string).should.containEql("placeholder text for starting a brand new task")
		})

		it("rejects numbered task summary template", async () => {
			const config = createConfig()
			config.mode = "act"
			config.taskState.didReadProjectFile = true
			const response = `Task

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
				name: "plan_mode_respond",
				params: {
					response,
					options: "[]",
				},
			} as unknown as ToolUse

			const result = await handler.execute(config, block)

			;(typeof result).should.equal("string")
			;(result as string).should.containEql("placeholder text for starting a brand new task")
		})

		it("rejects numbered task summary template without colons", async () => {
			const config = createConfig()
			config.mode = "act"
			config.taskState.didReadProjectFile = true
			const response = `Task

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
				name: "plan_mode_respond",
				params: {
					response,
					options: "[]",
				},
			} as unknown as ToolUse

			const result = await handler.execute(config, block)

			;(typeof result).should.equal("string")
			;(result as string).should.containEql("placeholder text for starting a brand new task")
		})

		it("rejects bullet task summary template", async () => {
			const config = createConfig()
			config.mode = "act"
			config.taskState.didReadProjectFile = true
			const response = `Task
- Current Work: "Creating an HTML5 website from scratch."
- Key Technical Concepts: HTML5 structure, CSS styling, JavaScript functionality.
- Relevant Files and Code: src/index.html (currently empty), src/js.js (empty), src/css (empty).
- Problem Solving: None.
- Pending Tasks and Next Steps: Steps to create website:
  ○ [ ] Analyze requirements`
			const block = {
				name: "plan_mode_respond",
				params: {
					response,
					options: "[]",
				},
			} as unknown as ToolUse

			const result = await handler.execute(config, block)

			;(typeof result).should.equal("string")
			;(result as string).should.containEql("placeholder text for starting a brand new task")
		})

		it("updates task_progress when provided", async () => {
			const config = createConfig()
			config.mode = "act"
			config.taskState.didReadProjectFile = true
			let updatedChecklist: string | undefined
			config.callbacks = {
				...config.callbacks,
				ask: async () => ({ response: "" as any, text: "" }),
				updateFCListFromToolResponse: async (progress?: string) => {
					updatedChecklist = progress
				},
			}

			const checklist = "- [ ] Draft implementation steps\n- [ ] Write tests"
			const block = {
				name: "plan_mode_respond",
				params: {
					response: checklist,
					options: "[]",
					task_progress: checklist,
				},
			} as unknown as ToolUse

			await handler.execute(config, block)

			updatedChecklist?.should.equal(checklist)
		})

		it("rejects reasoning that describes step-by-step tool usage then executes new_task", async () => {
			const config = createConfig()
			config.mode = "act"
			config.taskState.didReadProjectFile = true
			const response = `We need to plan steps: analyze requirements, set up files, implement main functionality. We will use a todo list with the task_progress parameter. Since we are in ACT MODE, we can use tools directly. We'll start by creating a new task using \`new_task\` with context of current work and user instructions. We need to create a comprehensive checklist. We'll create the todo list in the task_progress parameter. We must also ensure we have no other required parameters missing. We should use \`new_task\` with context of current work: include details from environment_details. We may need to create a new file or modify existing files. We can use \`write_to_file\` for creating new HTML5 website. We need to implement main functionality. We can use \`write_to_file\` for creating new index.html file. We will start with \`new_task\` with context. Then we will use \`write_to_file\` for src/index.html to create new HTML5 website. Then we might run commands. We will use \`write_to_file\` to create new index.html file. We will also plan to test the implementation and verify results. We will proceed step by step: create new index.html file, modify existing files, test. We will use \`write_to_file\` and \`replace_in_file\` accordingly. Now let's produce the tool uses. We first will use \`new_task\` with context. Then we will use \`write_to_file\` to create new index.html file. Now produce the first tool: <new_task> <context>...</context> We will use the new_task. Then we will use \`write_to_file\`. Now let's write the tool calls. First: new_task with context, includes todo list. Then: write_to_file to create new index.html file. Now produce the final output.`
			const block = {
				name: "plan_mode_respond",
				params: {
					response,
					options: "[]",
				},
			} as unknown as ToolUse

			const result = await handler.execute(config, block)

			;(typeof result).should.equal("string")
			;(result as string).should.containEql("placeholder text for starting a brand new task")
		})

		it("rejects reasoning that describes entire workflow then calls attempt_completion without doing work", async () => {
			const config = createConfig()
			config.mode = "act"
			const response = `We need to create an impressive HTML5 website. We can use tools to create new files, modify existing ones. Use read_file to see contents of index.html. We should proceed step by step with todo list. We'll use plan_mode_respond. We should create comprehensive checklist: Analyze requirements, set up necessary files, implement main functionality, handle edge cases, test the implementation, verify results. Now we should proceed to next step: create a new index.html file with improved content. We will use write_to_file. We'll proceed: <write_to_file> <path>src/index.html</path> <content><!DOCTYPE html>...</content> </write_to_file> Now we have new index.html. We also need to create new CSS file. We'll create: <write_to_file> <path>src/bootstrap.css</path> </write_to_file> We might also create src/images/logo.png. We'll use replace_in_file to modify existing js.js content. We'll do: <replace_in_file> <path>src/js.js</path> </replace_in_file> Now we have js.js updated. Now we have completed the task. We should use attempt_completion to present result. We will: <attempt_completion> <result>Impressive HTML5 website built with responsive design</result> </attempt_completion> Now we will provide final result. Ok. Let's finalize.`
			const block = {
				name: "plan_mode_respond",
				params: {
					response,
					options: "[]",
				},
			} as unknown as ToolUse

			const result = await handler.execute(config, block)

			;(typeof result).should.equal("string")
			;(result as string).should.containEql("placeholder text for starting a brand new task")
		})

		it("rejects reasoning that justifies new_task as necessary first step before doing work", async () => {
			const config = createConfig()
			config.mode = "act"
			const response = `We need to create a new task with context from the conversation and current work. The user wants a todo list for tracking progress. We'll use the \`new_task\` tool, including the required context. We will also include the \`task_progress\` parameter in subsequent calls to keep track progress. The next step: we will create a todo list as part of the new task. This is recommended by the user. We might also ask for additional information if needed, but we won't. Thus proceed with new_task. We'll create a comprehensive checklist as part of the new task. We'll include tasks like "Analyze requirements", "Set up necessary files", "Implement main functionality". We will also include the \`task_progress\` parameter in subsequent tool calls to keep track progress. Ok. Cline wants to start a new task: Task. We need to use new_task tool. We'll include all previous steps and tasks. We need to create a comprehensive checklist of all steps needed. We'll create a todo list in the next tool call. So we should start with new_task. We might use the 'list_files' or 'list_code_definition_names' to gather context. But we don't need to ask for additional info. We must first create the new task. Thus we will use the new_task tool. So first step: new_task. Then we can use 'list_files' to gather file info. Ok. Let's proceed.`
			const block = {
				name: "plan_mode_respond",
				params: {
					response,
					options: "[]",
				},
			} as unknown as ToolUse

			const result = await handler.execute(config, block)

			;(typeof result).should.equal("string")
			;(result as string).should.containEql("placeholder text for starting a brand new task")
		})

		it("rejects reasoning that rationalizes new_task creation despite being in ACT mode", async () => {
			const config = createConfig()
			config.mode = "act"
			const response = `We have a task: create an impressive HTML5 website. We can use the tool \`new_task\` to create a new task with context that includes current work and key technical concepts. We must not ask user questions; we can only proceed. We must also use the \`new_task\` tool with context. We need to create a new task, but we are in ACT mode. The user has requested to create a new task (but not explicitly). But we can do it anyway. So step: Create a new task with context. We must use the \`new_task\` tool. Now let's create new task with context: - Current Work: "Currently working on src/index.html". We will use \`new_task\` tool. Then we create todo list. Now we need to create a new task, then proceed. Ok. So final answer: <new_task> <context>...</context> </new_task>. Ok. Let's output.`
			const block = {
				name: "plan_mode_respond",
				params: {
					response,
					options: "[]",
				},
			} as unknown as ToolUse

			const result = await handler.execute(config, block)

			;(typeof result).should.equal("string")
			;(result as string).should.containEql("placeholder text for starting a brand new task")
		})

		it("rejects elaborate justifications for new_task despite ACT mode awareness", async () => {
			const config = createConfig()
			config.mode = "act"
			const response = `The user wants to create an impressive HTML5 website. We need to create a todo list and plan tasks. The user is in ACT mode. We must create a new task (like a new website). We should first create a new_task with context that includes details about the current work. We need to use new_task tool. We should proceed with creating a new task. So we should use <new_task>. We need to provide the context as described. So final: Use <new_task> with context including current work, key technical concepts, relevant files and code. But let's write the final output: <new_task> <context>...</context> </new_task>. We also need to include a todo list. But we can do that later. So output: <new_task> <context>...</context> </new_task>. We will also ask the user to confirm that the new task has been created. This is final.`
			const block = {
				name: "plan_mode_respond",
				params: {
					response,
					options: "[]",
				},
			} as unknown as ToolUse

			const result = await handler.execute(config, block)

			;(typeof result).should.equal("string")
			;(result as string).should.containEql("placeholder text for starting a brand new task")
		})

		it("rejects circular reasoning loops that plan entire workflow then execute new_task first", async () => {
			const config = createConfig()
			config.mode = "act"
			const response = `We need to proceed step-by-step. First we must check the environment details. So we can call 'new_task' with context. We might call 'new_task' with context that includes the todo list. So we can use 'new_task' with context containing the todo list and relevant files. So first step: create a new task with context containing the todo list. Ok. We also must think about the environment details. Now we will use 'new_task' tool with context including current work, relevant files etc. We'll produce XML format for new_task: <new_task> <context>...</context>. Ok. Now after this step, we must wait for user response. Then we can proceed with next steps. We'll use list_files, then read_file, then search_files, etc. But first: new_task. Thus the output is: First: <new_task>. Wait for user response. Thus final answer: <new_task> <context>...</context>. We need to wait for user response. Ok.`
			const block = {
				name: "plan_mode_respond",
				params: {
					response,
					options: "[]",
				},
			} as unknown as ToolUse

			const result = await handler.execute(config, block)

			;(typeof result).should.equal("string")
			;(result as string).should.containEql("placeholder text for starting a brand new task")
		})

		it("rejects internal debate with eventual new_task justification despite ACT mode awareness", async () => {
			const config = createConfig()
			config.mode = "act"
			const response = `We have a task: Create an impressive HTML5 website. We are in ACT mode. Need to create a todo list. We might need to use new_task? Wait: In ACT mode, we can create new tasks only if user explicitly requested. But user didn't request new task. We just need to create a todo list. Should do not call new_task. We need to provide the tool usage: <new_task> is maybe used for creating a new task? The instruction says "When starting a new task, it is recommended to create a todo list." That is basically the initial step. So we should output something like: <new_task> with context: we will create a todo list. But we must have 'task_progress' parameter in the tool call? We need to produce the new_task call with context: The context includes the current work, key technical concepts, relevant files and code, problem solving, pending tasks, next steps. We need to output a tool call with 'new_task' and 'context'. Let's produce: <new_task>. We should output: <new_task>. We need to provide the tool call with 'new_task' and task_progress. Let's produce final answer.`
			const block = {
				name: "plan_mode_respond",
				params: {
					response,
					options: "[]",
				},
			} as unknown as ToolUse

			const result = await handler.execute(config, block)

			;(typeof result).should.equal("string")
			;(result as string).should.containEql("placeholder text for starting a brand new task")
		})

		it("rejects verbose narrative planning that concludes with new_task execution", async () => {
			const config = createConfig()
			config.mode = "act"
			const response = `We have a task: Create an impressive HTML5 website. We are in ACT MODE. So we can use tools except plan_mode_respond. We should also consider creating a todo list with task_progress. Goal: create an HTML5 website. We need to set up necessary files: index.html, js.js, styles.css etc. Maybe we can use write_to_file to create these files. We'll create new HTML5 website by creating new files. We must check if we have at least one of required tools. We use write_to_file, so it's good. Now we proceed: <new_task> <context>...</context> </new_task>. Then: <write_to_file> <path>src/index.html</path></write_to_file>. Now we create new_task. Now let's create the code. Now we will do: <attempt_completion>. So we do final answer.`
			const block = {
				name: "plan_mode_respond",
				params: {
					response,
					options: "[]",
				},
			} as unknown as ToolUse

			const result = await handler.execute(config, block)

			;(typeof result).should.equal("string")
			;(result as string).should.containEql("placeholder text for starting a brand new task")
		})

		it("rejects multi-tool workflow execution starting with new_task", async () => {
			const config = createConfig()
			config.mode = "act"
			const response = `We have task: Create an impressive HTML5 website. We need to create a new task and include todo list. Ok. Now final output: We will do step 1: new_task with context and todo list. Then: <write_to_file> with path src/home.html. Then: <replace_in_file> with path src/index.html. Then: <execute_command> with command open src/index.html. Finally: <attempt_completion> with result. We'll produce the following output: First: <new_task> <context>...</context>. Ok. We should produce this output. Ok. Now let's produce. Ok. Now we proceed. We will do the following: create new task, write files, replace content, execute command, complete task.`
			const block = {
				name: "plan_mode_respond",
				params: {
					response,
					options: "[]",
				},
			} as unknown as ToolUse

			const result = await handler.execute(config, block)

			;(typeof result).should.equal("string")
			;(result as string).should.containEql("placeholder text for starting a brand new task")
		})
	})
})
