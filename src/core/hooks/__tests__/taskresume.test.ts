import { afterEach, beforeEach, describe, it } from "mocha"
import "should"
import fs from "fs/promises"
import path from "path"
import sinon from "sinon"
import { HookFactory } from "../hook-factory"
import { createHookTestEnv, HookTestEnv, stubHookDirs, writeHookScriptForPlatform } from "./test-utils"

describe("TaskResume Hook", () => {
	let tempDir: string
	let sandbox: sinon.SinonSandbox
	let hookTestEnv: HookTestEnv
	const WINDOWS_HOOK_TEST_TIMEOUT_MS = 15000

	const writeHookScript = async (hookPath: string, nodeScript: string): Promise<void> => {
		await writeHookScriptForPlatform(hookPath, nodeScript)
	}

	beforeEach(async () => {
		hookTestEnv = await createHookTestEnv()
		tempDir = hookTestEnv.tempDir
		sandbox = hookTestEnv.sandbox
	})

	afterEach(async () => {
		await hookTestEnv.cleanup()
	})

	describe("Hook Input Format", () => {
		it("should receive all required taskResume fields", async () => {
			const hookPath = path.join(tempDir, ".clinerules", "hooks", "TaskResume")
			const hookScript = `#!/usr/bin/env node
const input = JSON.parse(require('fs').readFileSync(0, 'utf-8'));
const hasRequiredFields = 
  input.taskResume && 
  input.taskResume.taskMetadata &&
  input.taskResume.previousState &&
  typeof input.taskResume.taskMetadata.taskId === 'string' &&
  typeof input.taskResume.previousState.messageCount === 'string';
console.log(JSON.stringify({
  cancel: false,
  contextModification: hasRequiredFields ? "All fields present" : "Missing fields"
}))`

			await writeHookScript(hookPath, hookScript)

			const factory = new HookFactory()
			const runner = await factory.create("TaskResume")

			const result = await runner.run({
				taskId: "test-task",
				taskResume: {
					taskMetadata: {
						taskId: "test-task",
						ulid: "test-ulid",
					},
					previousState: {
						lastMessageTs: Date.now().toString(),
						messageCount: "5",
						conversationHistoryDeleted: "false",
					},
				},
			})

			result.cancel.should.be.false()
			result.contextModification?.should.equal("All fields present")
		})

		it("should receive all common hook input fields", async () => {
			const hookPath = path.join(tempDir, ".clinerules", "hooks", "TaskResume")
			const hookScript = `#!/usr/bin/env node
const input = JSON.parse(require('fs').readFileSync(0, 'utf-8'));
const hasAllFields = input.clineVersion && input.hookName && input.timestamp && 
                     input.taskId && input.workspaceRoots !== undefined;
console.log(JSON.stringify({
  cancel: false,
  contextModification: hasAllFields ? "All fields present" : "Missing fields"
}))`

			await writeHookScript(hookPath, hookScript)

			const factory = new HookFactory()
			const runner = await factory.create("TaskResume")

			const result = await runner.run({
				taskId: "test-task",
				taskResume: {
					taskMetadata: { taskId: "test-task", ulid: "test-ulid" },
					previousState: {
						lastMessageTs: Date.now().toString(),
						messageCount: "5",
						conversationHistoryDeleted: "false",
					},
				},
			})

			result.contextModification?.should.equal("All fields present")
		})
	})

	describe("Time-Based Calculations", () => {
		it("should correctly calculate minutes ago for recent resumes", async function () {
			if (process.platform === "win32") {
				this.timeout(WINDOWS_HOOK_TEST_TIMEOUT_MS)
			}

			const hookPath = path.join(tempDir, ".clinerules", "hooks", "TaskResume")
			const hookScript = `#!/usr/bin/env node
const input = JSON.parse(require('fs').readFileSync(0, 'utf-8'));
const lastTs = parseInt(input.taskResume.previousState.lastMessageTs);
const now = Date.now();
const minutesAgo = Math.floor((now - lastTs) / 60000);
console.log(JSON.stringify({
  cancel: false,
  contextModification: "Minutes ago: " + minutesAgo
}))`

			await writeHookScript(hookPath, hookScript)

			const factory = new HookFactory()
			const runner = await factory.create("TaskResume")

			// Test various time intervals
			const testCases = [
				{ offset: 2 * 60 * 1000, expected: 2 }, // 2 minutes
				{ offset: 30 * 60 * 1000, expected: 30 }, // 30 minutes
				{ offset: 90 * 60 * 1000, expected: 90 }, // 90 minutes
			]

			for (const { offset, expected } of testCases) {
				const timestamp = Date.now() - offset
				const result = await runner.run({
					taskId: "test-task",
					taskResume: {
						taskMetadata: { taskId: "test-task", ulid: "test-ulid" },
						previousState: {
							lastMessageTs: timestamp.toString(),
							messageCount: "5",
							conversationHistoryDeleted: "false",
						},
					},
				})

				result.contextModification?.should.equal(`Minutes ago: ${expected}`)
			}
		})

		it("should handle very old timestamps (days ago)", async () => {
			const hookPath = path.join(tempDir, ".clinerules", "hooks", "TaskResume")
			const hookScript = `#!/usr/bin/env node
const input = JSON.parse(require('fs').readFileSync(0, 'utf-8'));
const lastTs = parseInt(input.taskResume.previousState.lastMessageTs);
const now = Date.now();
const daysAgo = Math.floor((now - lastTs) / (24 * 60 * 60 * 1000));
console.log(JSON.stringify({
  cancel: false,
  contextModification: daysAgo > 0 ? "Days ago: " + daysAgo : "Recent"
}))`

			await writeHookScript(hookPath, hookScript)

			const factory = new HookFactory()
			const runner = await factory.create("TaskResume")

			// Test 7 days ago
			const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
			const result = await runner.run({
				taskId: "test-task",
				taskResume: {
					taskMetadata: { taskId: "test-task", ulid: "test-ulid" },
					previousState: {
						lastMessageTs: sevenDaysAgo.toString(),
						messageCount: "5",
						conversationHistoryDeleted: "false",
					},
				},
			})

			result.contextModification?.should.equal("Days ago: 7")
		})

		it("should handle edge case: future timestamp", async () => {
			const hookPath = path.join(tempDir, ".clinerules", "hooks", "TaskResume")
			const hookScript = `#!/usr/bin/env node
const input = JSON.parse(require('fs').readFileSync(0, 'utf-8'));
const lastTs = parseInt(input.taskResume.previousState.lastMessageTs);
const now = Date.now();
const isFuture = lastTs > now;
console.log(JSON.stringify({
  cancel: false,
  contextModification: isFuture ? "Future timestamp detected" : "Normal timestamp"
}))`

			await writeHookScript(hookPath, hookScript)

			const factory = new HookFactory()
			const runner = await factory.create("TaskResume")

			const futureTimestamp = Date.now() + 60 * 60 * 1000 // 1 hour in future
			const result = await runner.run({
				taskId: "test-task",
				taskResume: {
					taskMetadata: { taskId: "test-task", ulid: "test-ulid" },
					previousState: {
						lastMessageTs: futureTimestamp.toString(),
						messageCount: "5",
						conversationHistoryDeleted: "false",
					},
				},
			})

			result.contextModification?.should.equal("Future timestamp detected")
		})
	})

	describe("Message Count Analysis", () => {
		it("should analyze message count thresholds", async () => {
			const hookPath = path.join(tempDir, ".clinerules", "hooks", "TaskResume")
			const hookScript = `#!/usr/bin/env node
const input = JSON.parse(require('fs').readFileSync(0, 'utf-8'));
const count = parseInt(input.taskResume.previousState.messageCount);
let category;
if (count < 5) category = "short";
else if (count < 20) category = "medium";
else category = "long";
console.log(JSON.stringify({
  cancel: false,
  contextModification: "Conversation length: " + category + " (" + count + " messages)"
}))`

			await writeHookScript(hookPath, hookScript)

			const factory = new HookFactory()
			const runner = await factory.create("TaskResume")

			const testCases = [
				{ count: "2", expected: "short (2 messages)" },
				{ count: "10", expected: "medium (10 messages)" },
				{ count: "50", expected: "long (50 messages)" },
			]

			for (const { count, expected } of testCases) {
				const result = await runner.run({
					taskId: "test-task",
					taskResume: {
						taskMetadata: { taskId: "test-task", ulid: "test-ulid" },
						previousState: {
							lastMessageTs: Date.now().toString(),
							messageCount: count,
							conversationHistoryDeleted: "false",
						},
					},
				})

				result.contextModification?.should.equal(`Conversation length: ${expected}`)
			}
		})

		it("should handle zero message count", async () => {
			const hookPath = path.join(tempDir, ".clinerules", "hooks", "TaskResume")
			const hookScript = `#!/usr/bin/env node
const input = JSON.parse(require('fs').readFileSync(0, 'utf-8'));
const count = parseInt(input.taskResume.previousState.messageCount);
console.log(JSON.stringify({
  cancel: false,
  contextModification: count === 0 ? "Empty conversation" : "Has messages"
}))`

			await writeHookScript(hookPath, hookScript)

			const factory = new HookFactory()
			const runner = await factory.create("TaskResume")

			const result = await runner.run({
				taskId: "test-task",
				taskResume: {
					taskMetadata: { taskId: "test-task", ulid: "test-ulid" },
					previousState: {
						lastMessageTs: Date.now().toString(),
						messageCount: "0",
						conversationHistoryDeleted: "false",
					},
				},
			})

			result.contextModification?.should.equal("Empty conversation")
		})
	})

	describe("State Combination Analysis", () => {
		it("should analyze combination of long pause and many messages", async () => {
			const hookPath = path.join(tempDir, ".clinerules", "hooks", "TaskResume")
			const hookScript = `#!/usr/bin/env node
const input = JSON.parse(require('fs').readFileSync(0, 'utf-8'));
const lastTs = parseInt(input.taskResume.previousState.lastMessageTs);
const count = parseInt(input.taskResume.previousState.messageCount);
const hoursAgo = Math.floor((Date.now() - lastTs) / (60 * 60 * 1000));
const isStale = hoursAgo > 24 && count > 20;
console.log(JSON.stringify({
  cancel: false,
  contextModification: isStale ? "STALE_TASK: Long conversation paused for extended time" : "Active task"
}))`

			await writeHookScript(hookPath, hookScript)

			const factory = new HookFactory()
			const runner = await factory.create("TaskResume")

			const oneDayAgo = Date.now() - 25 * 60 * 60 * 1000
			const result = await runner.run({
				taskId: "test-task",
				taskResume: {
					taskMetadata: { taskId: "test-task", ulid: "test-ulid" },
					previousState: {
						lastMessageTs: oneDayAgo.toString(),
						messageCount: "30",
						conversationHistoryDeleted: "false",
					},
				},
			})

			result.contextModification?.should.equal("STALE_TASK: Long conversation paused for extended time")
		})

		it("should combine context deletion with other state", async () => {
			const hookPath = path.join(tempDir, ".clinerules", "hooks", "TaskResume")
			const hookScript = `#!/usr/bin/env node
const input = JSON.parse(require('fs').readFileSync(0, 'utf-8'));
const deleted = input.taskResume.previousState.conversationHistoryDeleted === 'true';
const count = parseInt(input.taskResume.previousState.messageCount);
console.log(JSON.stringify({
  cancel: false,
  contextModification: deleted && count > 10 
    ? "CONTEXT_WARNING: Large conversation with truncated history" 
    : "Normal state"
}))`

			await writeHookScript(hookPath, hookScript)

			const factory = new HookFactory()
			const runner = await factory.create("TaskResume")

			const result = await runner.run({
				taskId: "test-task",
				taskResume: {
					taskMetadata: { taskId: "test-task", ulid: "test-ulid" },
					previousState: {
						lastMessageTs: Date.now().toString(),
						messageCount: "25",
						conversationHistoryDeleted: "true",
					},
				},
			})

			result.contextModification?.should.equal("CONTEXT_WARNING: Large conversation with truncated history")
		})
	})

	describe("Error Handling", () => {
		it("should handle malformed JSON output", async () => {
			const hookPath = path.join(tempDir, ".clinerules", "hooks", "TaskResume")
			const hookScript = `#!/usr/bin/env node
console.log("not valid json")`

			await writeHookScript(hookPath, hookScript)

			const factory = new HookFactory()
			const runner = await factory.create("TaskResume")

			// When hook exits 0 but has malformed JSON, it returns success without context
			const result = await runner.run({
				taskId: "test-task",
				taskResume: {
					taskMetadata: { taskId: "test-task", ulid: "test-ulid" },
					previousState: {
						lastMessageTs: Date.now().toString(),
						messageCount: "5",
						conversationHistoryDeleted: "false",
					},
				},
			})

			// Hook succeeded (exit 0) but couldn't parse JSON, so returns success without context
			result.cancel.should.be.false()
			;(result.contextModification === undefined || result.contextModification === "").should.be.true()
		})

		it("should handle invalid timestamp gracefully", async () => {
			const hookPath = path.join(tempDir, ".clinerules", "hooks", "TaskResume")
			const hookScript = `#!/usr/bin/env node
const input = JSON.parse(require('fs').readFileSync(0, 'utf-8'));
const lastTs = parseInt(input.taskResume.previousState.lastMessageTs);
const isValid = !isNaN(lastTs) && lastTs > 0;
console.log(JSON.stringify({
  cancel: false,
  contextModification: isValid ? "Valid timestamp" : "Invalid timestamp"
}))`

			await writeHookScript(hookPath, hookScript)

			const factory = new HookFactory()
			const runner = await factory.create("TaskResume")

			const result = await runner.run({
				taskId: "test-task",
				taskResume: {
					taskMetadata: { taskId: "test-task", ulid: "test-ulid" },
					previousState: {
						lastMessageTs: "invalid",
						messageCount: "5",
						conversationHistoryDeleted: "false",
					},
				},
			})

			result.contextModification?.should.equal("Invalid timestamp")
		})
	})

	describe("Global and Workspace Hooks", () => {
		let globalHooksDir: string
		let workspaceHooksDir: string

		beforeEach(async () => {
			globalHooksDir = path.join(tempDir, "global-hooks")
			await fs.mkdir(globalHooksDir, { recursive: true })
			workspaceHooksDir = path.join(tempDir, ".clinerules", "hooks")

			stubHookDirs(sandbox, [globalHooksDir, workspaceHooksDir])
		})

		it("should execute both global and workspace TaskResume hooks", async () => {
			const globalHookPath = path.join(globalHooksDir, "TaskResume")
			const globalHookScript = `#!/usr/bin/env node
console.log(JSON.stringify({
  cancel: false,
  contextModification: "GLOBAL: Task resumed"
}))`
			await writeHookScript(globalHookPath, globalHookScript)

			const workspaceHookPath = path.join(tempDir, ".clinerules", "hooks", "TaskResume")
			const workspaceHookScript = `#!/usr/bin/env node
console.log(JSON.stringify({
  cancel: false,
  contextModification: "WORKSPACE: Task resumed"
}))`
			await writeHookScript(workspaceHookPath, workspaceHookScript)

			const factory = new HookFactory()
			const runner = await factory.create("TaskResume")

			const result = await runner.run({
				taskId: "test-task",
				taskResume: {
					taskMetadata: { taskId: "test-task", ulid: "test-ulid" },
					previousState: {
						lastMessageTs: Date.now().toString(),
						messageCount: "5",
						conversationHistoryDeleted: "false",
					},
				},
			})

			result.cancel.should.be.false()
			result.contextModification?.should.match(/GLOBAL: Task resumed/)
			result.contextModification?.should.match(/WORKSPACE: Task resumed/)
		})

		it("should combine context modifications from both hooks with time analysis", async () => {
			const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000

			const globalHookPath = path.join(globalHooksDir, "TaskResume")
			const globalHookScript = `#!/usr/bin/env node
const input = JSON.parse(require('fs').readFileSync(0, 'utf-8'));
const lastTs = parseInt(input.taskResume.previousState.lastMessageTs);
const daysAgo = Math.floor((Date.now() - lastTs) / (24 * 60 * 60 * 1000));
console.log(JSON.stringify({
  cancel: false,
  contextModification: "GLOBAL_POLICY: " + (daysAgo > 0 ? "Review task context" : "Continue")
}))`
			await writeHookScript(globalHookPath, globalHookScript)

			const workspaceHookPath = path.join(tempDir, ".clinerules", "hooks", "TaskResume")
			const workspaceHookScript = `#!/usr/bin/env node
const input = JSON.parse(require('fs').readFileSync(0, 'utf-8'));
const count = parseInt(input.taskResume.previousState.messageCount);
console.log(JSON.stringify({
  cancel: false,
  contextModification: "PROJECT_NOTE: " + count + " messages in history"
}))`
			await writeHookScript(workspaceHookPath, workspaceHookScript)

			const factory = new HookFactory()
			const runner = await factory.create("TaskResume")

			const result = await runner.run({
				taskId: "test-task",
				taskResume: {
					taskMetadata: { taskId: "test-task", ulid: "test-ulid" },
					previousState: {
						lastMessageTs: oneDayAgo.toString(),
						messageCount: "15",
						conversationHistoryDeleted: "false",
					},
				},
			})

			result.contextModification?.should.match(/GLOBAL_POLICY: Review task context/)
			result.contextModification?.should.match(/PROJECT_NOTE: 15 messages in history/)
		})
	})

	describe("No Hook Behavior", () => {
		it("should allow resume when no hook exists", async () => {
			const factory = new HookFactory()
			const runner = await factory.create("TaskResume")

			const result = await runner.run({
				taskId: "test-task",
				taskResume: {
					taskMetadata: { taskId: "test-task", ulid: "test-ulid" },
					previousState: {
						lastMessageTs: Date.now().toString(),
						messageCount: "5",
						conversationHistoryDeleted: "false",
					},
				},
			})

			result.cancel.should.be.false()
		})
	})

	describe("Fixture-Based Tests", () => {
		const loadFixtureAndCreateRunner = async (fixtureName: string) => {
			const { loadFixture } = await import("./test-utils")
			await loadFixture(`hooks/taskresume/${fixtureName}`, tempDir)

			const factory = new HookFactory()
			return await factory.create("TaskResume")
		}

		it("should work with success fixture", async () => {
			const runner = await loadFixtureAndCreateRunner("success")

			const result = await runner.run({
				taskId: "test-task",
				taskResume: {
					taskMetadata: { taskId: "test-task", ulid: "test-ulid" },
					previousState: {
						lastMessageTs: Date.now().toString(),
						messageCount: "5",
						conversationHistoryDeleted: "false",
					},
				},
			})

			result.cancel.should.be.false()
			result.contextModification?.should.equal("TaskResume hook executed successfully")
		})

		it("should work with recent-resume fixture", async () => {
			const runner = await loadFixtureAndCreateRunner("recent-resume")

			const twoMinutesAgo = Date.now() - 2 * 60 * 1000
			const result = await runner.run({
				taskId: "test-task",
				taskResume: {
					taskMetadata: { taskId: "test-task", ulid: "test-ulid" },
					previousState: {
						lastMessageTs: twoMinutesAgo.toString(),
						messageCount: "5",
						conversationHistoryDeleted: "false",
					},
				},
			})

			result.cancel.should.be.false()
			result.contextModification?.should.match(/Recently paused task/)
		})

		it("should work with long-pause fixture", async () => {
			const runner = await loadFixtureAndCreateRunner("long-pause")

			const twoDaysAgo = Date.now() - 48 * 60 * 60 * 1000
			const result = await runner.run({
				taskId: "test-task",
				taskResume: {
					taskMetadata: { taskId: "test-task", ulid: "test-ulid" },
					previousState: {
						lastMessageTs: twoDaysAgo.toString(),
						messageCount: "5",
						conversationHistoryDeleted: "false",
					},
				},
			})

			result.cancel.should.be.false()
			result.contextModification?.should.match(/paused 48 hours ago/)
		})

		it("should work with context-deleted fixture", async () => {
			const runner = await loadFixtureAndCreateRunner("context-deleted")

			const result = await runner.run({
				taskId: "test-task",
				taskResume: {
					taskMetadata: { taskId: "test-task", ulid: "test-ulid" },
					previousState: {
						lastMessageTs: Date.now().toString(),
						messageCount: "50",
						conversationHistoryDeleted: "true",
					},
				},
			})

			result.cancel.should.be.false()
			result.contextModification?.should.match(/truncated/)
		})

		it("should work with message-count fixture", async () => {
			const runner = await loadFixtureAndCreateRunner("message-count")

			const result = await runner.run({
				taskId: "test-task",
				taskResume: {
					taskMetadata: { taskId: "test-task", ulid: "test-ulid" },
					previousState: {
						lastMessageTs: Date.now().toString(),
						messageCount: "25",
						conversationHistoryDeleted: "false",
					},
				},
			})

			result.cancel.should.be.false()
			result.contextModification?.should.equal("TASK_CONTEXT: Resuming task with 25 previous messages")
		})

		it("should work with context-injection fixture", async () => {
			const runner = await loadFixtureAndCreateRunner("context-injection")

			const result = await runner.run({
				taskId: "test-task",
				taskResume: {
					taskMetadata: { taskId: "test-task", ulid: "test-ulid" },
					previousState: {
						lastMessageTs: Date.now().toString(),
						messageCount: "5",
						conversationHistoryDeleted: "false",
					},
				},
			})

			result.cancel.should.be.false()
			result.contextModification?.should.equal("WORKSPACE_RULES: Task test-task resumed - review previous context")
		})

		it("should work with error fixture", async () => {
			const runner = await loadFixtureAndCreateRunner("error")

			try {
				await runner.run({
					taskId: "test-task",
					taskResume: {
						taskMetadata: { taskId: "test-task", ulid: "test-ulid" },
						previousState: {
							lastMessageTs: Date.now().toString(),
							messageCount: "5",
							conversationHistoryDeleted: "false",
						},
					},
				})
				throw new Error("Should have thrown")
			} catch (error: any) {
				error.message.should.match(/exited with code 1/)
			}
		})
	})
})
