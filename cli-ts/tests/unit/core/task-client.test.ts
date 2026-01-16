/**
 * Tests for TaskStorage class
 */

import { expect } from "chai"
import fs from "fs"
import os from "os"
import path from "path"
import { createTaskStorage, TaskStorage } from "../../../src/core/task-client.js"

describe("TaskStorage", () => {
	let tempDir: string
	let storage: TaskStorage

	beforeEach(() => {
		// Create a temporary directory for each test
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cline-test-"))
		storage = createTaskStorage(tempDir)
	})

	afterEach(() => {
		// Clean up temporary directory
		fs.rmSync(tempDir, { recursive: true, force: true })
	})

	describe("create", () => {
		it("should create a new task with required fields", () => {
			const task = storage.create({ prompt: "Test task prompt" })

			expect(task.id).to.be.a("string")
			expect(task.id.length).to.equal(16) // 8 bytes = 16 hex chars
			expect(task.prompt).to.equal("Test task prompt")
			expect(task.status).to.equal("active")
			expect(task.mode).to.equal("act")
			expect(task.messageCount).to.equal(0)
			expect(task.createdAt).to.be.a("number")
			expect(task.updatedAt).to.be.a("number")
		})

		it("should create task with custom mode", () => {
			const task = storage.create({ prompt: "Plan task", mode: "plan" })

			expect(task.mode).to.equal("plan")
		})

		it("should create task with custom settings", () => {
			const task = storage.create({
				prompt: "Task with settings",
				settings: { key1: "value1", key2: "value2" },
			})

			expect(task.settings).to.deep.equal({ key1: "value1", key2: "value2" })
		})

		it("should persist task to disk", () => {
			const task = storage.create({ prompt: "Persisted task" })
			const taskPath = path.join(tempDir, "tasks", `${task.id}.json`)

			expect(fs.existsSync(taskPath)).to.be.true
			const savedTask = JSON.parse(fs.readFileSync(taskPath, "utf-8"))
			expect(savedTask.id).to.equal(task.id)
			expect(savedTask.prompt).to.equal("Persisted task")
		})

		it("should add task to index", () => {
			const task = storage.create({ prompt: "Indexed task" })
			const indexPath = path.join(tempDir, "tasks", "index.json")

			expect(fs.existsSync(indexPath)).to.be.true
			const index = JSON.parse(fs.readFileSync(indexPath, "utf-8"))
			expect(index).to.be.an("array").with.lengthOf(1)
			expect(index[0].id).to.equal(task.id)
		})
	})

	describe("get", () => {
		it("should retrieve task by full ID", () => {
			const created = storage.create({ prompt: "Get test" })
			const retrieved = storage.get(created.id)

			expect(retrieved).to.not.be.null
			expect(retrieved!.id).to.equal(created.id)
			expect(retrieved!.prompt).to.equal("Get test")
		})

		it("should retrieve task by partial ID", () => {
			const created = storage.create({ prompt: "Partial ID test" })
			const partialId = created.id.slice(0, 6)
			const retrieved = storage.get(partialId)

			expect(retrieved).to.not.be.null
			expect(retrieved!.id).to.equal(created.id)
		})

		it("should return null for non-existent task", () => {
			const retrieved = storage.get("nonexistent123456")

			expect(retrieved).to.be.null
		})
	})

	describe("update", () => {
		it("should update task fields", () => {
			const task = storage.create({ prompt: "Update test" })
			const updated = storage.update(task.id, { messageCount: 5 })

			expect(updated).to.not.be.null
			expect(updated!.messageCount).to.equal(5)
			expect(updated!.updatedAt).to.be.at.least(task.updatedAt)
		})

		it("should not change task ID", () => {
			const task = storage.create({ prompt: "ID test" })
			const updated = storage.update(task.id, { id: "new-id" } as any)

			expect(updated!.id).to.equal(task.id)
		})

		it("should persist updates to disk", () => {
			const task = storage.create({ prompt: "Persist update test" })
			storage.update(task.id, { status: "completed" })

			const taskPath = path.join(tempDir, "tasks", `${task.id}.json`)
			const saved = JSON.parse(fs.readFileSync(taskPath, "utf-8"))
			expect(saved.status).to.equal("completed")
		})

		it("should return null for non-existent task", () => {
			const result = storage.update("nonexistent", { messageCount: 1 })

			expect(result).to.be.null
		})
	})

	describe("updateStatus", () => {
		it("should update task status", () => {
			const task = storage.create({ prompt: "Status test" })
			const updated = storage.updateStatus(task.id, "paused")

			expect(updated!.status).to.equal("paused")
		})
	})

	describe("updateMode", () => {
		it("should update task mode", () => {
			const task = storage.create({ prompt: "Mode test" })
			const updated = storage.updateMode(task.id, "plan")

			expect(updated!.mode).to.equal("plan")
		})
	})

	describe("incrementMessageCount", () => {
		it("should increment message count", () => {
			const task = storage.create({ prompt: "Message count test" })
			expect(task.messageCount).to.equal(0)

			storage.incrementMessageCount(task.id)
			const updated = storage.get(task.id)
			expect(updated!.messageCount).to.equal(1)

			storage.incrementMessageCount(task.id)
			const updated2 = storage.get(task.id)
			expect(updated2!.messageCount).to.equal(2)
		})
	})

	describe("delete", () => {
		it("should delete task file", () => {
			const task = storage.create({ prompt: "Delete test" })
			const taskPath = path.join(tempDir, "tasks", `${task.id}.json`)

			expect(fs.existsSync(taskPath)).to.be.true
			const result = storage.delete(task.id)
			expect(result).to.be.true
			expect(fs.existsSync(taskPath)).to.be.false
		})

		it("should remove task from index", () => {
			const task = storage.create({ prompt: "Delete index test" })
			storage.delete(task.id)

			const index = storage.list()
			expect(index).to.be.an("array").with.lengthOf(0)
		})

		it("should return false for non-existent task", () => {
			const result = storage.delete("nonexistent")

			expect(result).to.be.false
		})
	})

	describe("list", () => {
		it("should return empty array when no tasks", () => {
			const tasks = storage.list()

			expect(tasks).to.be.an("array").with.lengthOf(0)
		})

		it("should return all tasks", () => {
			storage.create({ prompt: "Task 1" })
			storage.create({ prompt: "Task 2" })
			storage.create({ prompt: "Task 3" })

			const tasks = storage.list()
			expect(tasks).to.have.lengthOf(3)
		})

		it("should return tasks in most-recent-first order", () => {
			storage.create({ prompt: "First" })
			storage.create({ prompt: "Second" })
			storage.create({ prompt: "Third" })

			const tasks = storage.list()
			expect(tasks[0].prompt).to.equal("Third")
			expect(tasks[1].prompt).to.equal("Second")
			expect(tasks[2].prompt).to.equal("First")
		})

		it("should respect limit parameter", () => {
			storage.create({ prompt: "Task 1" })
			storage.create({ prompt: "Task 2" })
			storage.create({ prompt: "Task 3" })

			const tasks = storage.list(2)
			expect(tasks).to.have.lengthOf(2)
		})
	})

	describe("listForDisplay", () => {
		it("should return formatted task items", () => {
			storage.create({ prompt: "Display test task with a longer prompt" })

			const items = storage.listForDisplay()
			expect(items).to.have.lengthOf(1)
			expect(items[0].id.length).to.equal(8) // Truncated ID
			expect(items[0].fullId.length).to.equal(16) // Full ID
			expect(items[0].promptSnippet).to.be.a("string")
			expect(items[0].timeAgo).to.be.a("string")
		})

		it("should truncate long prompts", () => {
			const longPrompt = "A".repeat(100)
			storage.create({ prompt: longPrompt })

			const items = storage.listForDisplay(undefined, 8, 50)
			expect(items[0].promptSnippet.length).to.be.at.most(50)
			expect(items[0].promptSnippet.endsWith("...")).to.be.true
		})
	})

	describe("findByPartialId", () => {
		it("should find task by partial ID", () => {
			const task = storage.create({ prompt: "Find test" })
			const found = storage.findByPartialId(task.id.slice(0, 4))

			expect(found).to.not.be.null
			expect(found!.id).to.equal(task.id)
		})

		it("should return null for no match", () => {
			storage.create({ prompt: "Test" })
			const found = storage.findByPartialId("xyz")

			expect(found).to.be.null
		})
	})

	describe("clear", () => {
		it("should delete all tasks", () => {
			storage.create({ prompt: "Task 1" })
			storage.create({ prompt: "Task 2" })
			storage.create({ prompt: "Task 3" })

			expect(storage.list()).to.have.lengthOf(3)
			storage.clear()
			expect(storage.list()).to.have.lengthOf(0)
		})
	})
})
