import { expect } from "chai"
import * as chokidar from "chokidar"
import * as sinon from "sinon"
import { Task } from "../index"

describe("Task.contextConfigWatcher", () => {
	let task: Task
	let mockContextConfigLoader: any
	let chokidarWatchStub: sinon.SinonStub
	let mockWatcher: any

	beforeEach(() => {
		// Create mock watcher with event handlers
		mockWatcher = {
			on: sinon.stub().returnsThis(),
			close: sinon.stub().resolves(),
		}

		// Stub chokidar.watch to return our mock watcher
		chokidarWatchStub = sinon.stub(chokidar, "watch").returns(mockWatcher)

		// Create mock context config loader
		mockContextConfigLoader = {
			loadConfig: sinon.stub().resolves({
				includeVisibleFiles: true,
				includeOpenTabs: true,
				includeFileTree: true,
			}),
		}

		// Create a minimal task instance for testing
		task = {
			taskId: "test-task-id",
			cwd: "/test/workspace",
			contextConfigLoader: mockContextConfigLoader,
			contextConfigWatcher: undefined,
			setupContextConfigWatcher: Task.prototype["setupContextConfigWatcher"],
		} as any
	})

	afterEach(() => {
		sinon.restore()
	})

	describe("setupContextConfigWatcher", () => {
		it("should initialize chokidar watcher with correct path", async () => {
			await task["setupContextConfigWatcher"]()

			expect(chokidarWatchStub.calledOnce).to.be.true
			expect(chokidarWatchStub.firstCall.args[0]).to.equal("/test/workspace/.cline/context.json")
		})

		it("should configure watcher with correct options", async () => {
			await task["setupContextConfigWatcher"]()

			const options = chokidarWatchStub.firstCall.args[1]
			expect(options.persistent).to.be.true
			expect(options.ignoreInitial).to.be.true
			expect(options.awaitWriteFinish).to.deep.equal({
				stabilityThreshold: 300,
				pollInterval: 100,
			})
		})

		it("should register event handlers for add, change, unlink, and error", async () => {
			await task["setupContextConfigWatcher"]()

			expect(mockWatcher.on.callCount).to.equal(4)
			expect(mockWatcher.on.calledWith("add")).to.be.true
			expect(mockWatcher.on.calledWith("change")).to.be.true
			expect(mockWatcher.on.calledWith("unlink")).to.be.true
			expect(mockWatcher.on.calledWith("error")).to.be.true
		})

		it("should call loadConfig when file is added", async () => {
			await task["setupContextConfigWatcher"]()

			// Get the 'add' event handler
			const addHandler = mockWatcher.on.getCalls().find((call: any) => call.args[0] === "add")?.args[1]
			expect(addHandler).to.exist

			// Trigger the add event
			await addHandler()

			expect(mockContextConfigLoader.loadConfig.calledOnce).to.be.true
			expect(mockContextConfigLoader.loadConfig.calledWith("/test/workspace")).to.be.true
		})

		it("should call loadConfig when file is changed", async () => {
			await task["setupContextConfigWatcher"]()

			// Get the 'change' event handler
			const changeHandler = mockWatcher.on.getCalls().find((call: any) => call.args[0] === "change")?.args[1]
			expect(changeHandler).to.exist

			// Trigger the change event
			await changeHandler()

			expect(mockContextConfigLoader.loadConfig.calledOnce).to.be.true
			expect(mockContextConfigLoader.loadConfig.calledWith("/test/workspace")).to.be.true
		})

		it("should call loadConfig when file is deleted", async () => {
			await task["setupContextConfigWatcher"]()

			// Get the 'unlink' event handler
			const unlinkHandler = mockWatcher.on.getCalls().find((call: any) => call.args[0] === "unlink")?.args[1]
			expect(unlinkHandler).to.exist

			// Trigger the unlink event
			await unlinkHandler()

			expect(mockContextConfigLoader.loadConfig.calledOnce).to.be.true
			expect(mockContextConfigLoader.loadConfig.calledWith("/test/workspace")).to.be.true
		})

		it("should handle errors gracefully", async () => {
			const consoleErrorStub = sinon.stub(console, "error")

			await task["setupContextConfigWatcher"]()

			// Get the 'error' event handler
			const errorHandler = mockWatcher.on.getCalls().find((call: any) => call.args[0] === "error")?.args[1]
			expect(errorHandler).to.exist

			// Trigger the error event
			const testError = new Error("Test watcher error")
			errorHandler(testError)

			expect(consoleErrorStub.called).to.be.true
			consoleErrorStub.restore()
		})

		it("should store watcher instance on task", async () => {
			await task["setupContextConfigWatcher"]()

			expect((task as any).contextConfigWatcher).to.equal(mockWatcher)
		})

		it("should handle setup errors gracefully", async () => {
			const consoleErrorStub = sinon.stub(console, "error")
			chokidarWatchStub.throws(new Error("Setup failed"))

			await task["setupContextConfigWatcher"]()

			expect(consoleErrorStub.called).to.be.true
			consoleErrorStub.restore()
		})
	})

	describe("abortTask cleanup", () => {
		it("should close watcher when task is aborted", async () => {
			// Setup watcher first
			await task["setupContextConfigWatcher"]()
			expect((task as any).contextConfigWatcher).to.exist

			// Simulate abortTask cleanup
			if ((task as any).contextConfigWatcher) {
				;(task as any).contextConfigWatcher.close()
				;(task as any).contextConfigWatcher = undefined
			}

			expect(mockWatcher.close.calledOnce).to.be.true
			expect((task as any).contextConfigWatcher).to.be.undefined
		})

		it("should handle missing watcher gracefully during cleanup", () => {
			// Ensure no watcher exists
			;(task as any).contextConfigWatcher = undefined

			// Simulate abortTask cleanup - should not throw
			expect(() => {
				if ((task as any).contextConfigWatcher) {
					;(task as any).contextConfigWatcher.close()
					;(task as any).contextConfigWatcher = undefined
				}
			}).to.not.throw()
		})
	})
})
