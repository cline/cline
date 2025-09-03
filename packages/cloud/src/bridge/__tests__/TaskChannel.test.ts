/* eslint-disable @typescript-eslint/no-unsafe-function-type */
/* eslint-disable @typescript-eslint/no-explicit-any */

import type { Socket } from "socket.io-client"

import {
	type TaskLike,
	type ClineMessage,
	type StaticAppProperties,
	RooCodeEventName,
	TaskBridgeEventName,
	TaskBridgeCommandName,
	TaskSocketEvents,
	TaskStatus,
} from "@roo-code/types"

import { TaskChannel } from "../TaskChannel.js"

describe("TaskChannel", () => {
	let mockSocket: Socket
	let taskChannel: TaskChannel
	let mockTask: TaskLike
	const instanceId = "test-instance-123"
	const taskId = "test-task-456"

	const appProperties: StaticAppProperties = {
		appName: "roo-code",
		appVersion: "1.0.0",
		vscodeVersion: "1.0.0",
		platform: "darwin",
		editorName: "Roo Code",
		hostname: "test-host",
	}

	beforeEach(() => {
		// Create mock socket
		mockSocket = {
			emit: vi.fn(),
			on: vi.fn(),
			off: vi.fn(),
			disconnect: vi.fn(),
		} as unknown as Socket

		// Create mock task with event emitter functionality
		const listeners = new Map<string, Set<(...args: unknown[]) => unknown>>()
		mockTask = {
			taskId,
			taskStatus: TaskStatus.Running,
			taskAsk: undefined,
			metadata: {},
			on: vi.fn((event: string, listener: (...args: unknown[]) => unknown) => {
				if (!listeners.has(event)) {
					listeners.set(event, new Set())
				}
				listeners.get(event)!.add(listener)
				return mockTask
			}),
			off: vi.fn((event: string, listener: (...args: unknown[]) => unknown) => {
				const eventListeners = listeners.get(event)
				if (eventListeners) {
					eventListeners.delete(listener)
					if (eventListeners.size === 0) {
						listeners.delete(event)
					}
				}
				return mockTask
			}),
			approveAsk: vi.fn(),
			denyAsk: vi.fn(),
			submitUserMessage: vi.fn(),
			abortTask: vi.fn(),
			// Helper to trigger events in tests
			_triggerEvent: (event: string, ...args: any[]) => {
				const eventListeners = listeners.get(event)
				if (eventListeners) {
					eventListeners.forEach((listener) => listener(...args))
				}
			},
			_getListenerCount: (event: string) => {
				return listeners.get(event)?.size || 0
			},
		} as unknown as TaskLike & {
			_triggerEvent: (event: string, ...args: any[]) => void
			_getListenerCount: (event: string) => number
		}

		// Create task channel instance
		taskChannel = new TaskChannel({
			instanceId,
			appProperties,
		})
	})

	afterEach(() => {
		vi.clearAllMocks()
	})

	describe("Event Mapping Refactoring", () => {
		it("should use the unified event mapping approach", () => {
			// Access the private eventMapping through type assertion
			const channel = taskChannel as any

			// Verify eventMapping exists and has the correct structure
			expect(channel.eventMapping).toBeDefined()
			expect(Array.isArray(channel.eventMapping)).toBe(true)
			expect(channel.eventMapping.length).toBe(3)

			// Verify each mapping has the required properties
			channel.eventMapping.forEach((mapping: any) => {
				expect(mapping).toHaveProperty("from")
				expect(mapping).toHaveProperty("to")
				expect(mapping).toHaveProperty("createPayload")
				expect(typeof mapping.createPayload).toBe("function")
			})

			// Verify specific mappings
			expect(channel.eventMapping[0].from).toBe(RooCodeEventName.Message)
			expect(channel.eventMapping[0].to).toBe(TaskBridgeEventName.Message)

			expect(channel.eventMapping[1].from).toBe(RooCodeEventName.TaskModeSwitched)
			expect(channel.eventMapping[1].to).toBe(TaskBridgeEventName.TaskModeSwitched)

			expect(channel.eventMapping[2].from).toBe(RooCodeEventName.TaskInteractive)
			expect(channel.eventMapping[2].to).toBe(TaskBridgeEventName.TaskInteractive)
		})

		it("should setup listeners using the event mapping", async () => {
			// Mock the publish method to simulate successful subscription
			const channel = taskChannel as any
			channel.publish = vi.fn((event: string, data: any, callback?: Function) => {
				if (event === TaskSocketEvents.JOIN && callback) {
					// Simulate successful join response
					callback({ success: true })
				}
				return true
			})

			// Connect and subscribe to task
			await taskChannel.onConnect(mockSocket)
			await channel.subscribeToTask(mockTask, mockSocket)

			// Wait for async operations
			await new Promise((resolve) => setTimeout(resolve, 0))

			// Verify listeners were registered for all mapped events
			const task = mockTask as any
			expect(task._getListenerCount(RooCodeEventName.Message)).toBe(1)
			expect(task._getListenerCount(RooCodeEventName.TaskModeSwitched)).toBe(1)
			expect(task._getListenerCount(RooCodeEventName.TaskInteractive)).toBe(1)
		})

		it("should correctly transform Message event payloads", async () => {
			// Setup channel with task
			const channel = taskChannel as any
			let publishCalls: any[] = []

			channel.publish = vi.fn((event: string, data: any, callback?: Function) => {
				publishCalls.push({ event, data })

				if (event === TaskSocketEvents.JOIN && callback) {
					callback({ success: true })
				}

				return true
			})

			await taskChannel.onConnect(mockSocket)
			await channel.subscribeToTask(mockTask, mockSocket)
			await new Promise((resolve) => setTimeout(resolve, 0))

			// Clear previous calls
			publishCalls = []

			// Trigger Message event
			const messageData = {
				action: "test-action",
				message: { type: "say", text: "Hello" } as ClineMessage,
			}

			;(mockTask as any)._triggerEvent(RooCodeEventName.Message, messageData)

			// Verify the event was published with correct payload
			expect(publishCalls.length).toBe(1)
			expect(publishCalls[0]).toEqual({
				event: TaskSocketEvents.EVENT,
				data: {
					type: TaskBridgeEventName.Message,
					taskId: taskId,
					action: messageData.action,
					message: messageData.message,
				},
			})
		})

		it("should correctly transform TaskModeSwitched event payloads", async () => {
			// Setup channel with task
			const channel = taskChannel as any
			let publishCalls: any[] = []

			channel.publish = vi.fn((event: string, data: any, callback?: Function) => {
				publishCalls.push({ event, data })

				if (event === TaskSocketEvents.JOIN && callback) {
					callback({ success: true })
				}

				return true
			})

			await taskChannel.onConnect(mockSocket)
			await channel.subscribeToTask(mockTask, mockSocket)
			await new Promise((resolve) => setTimeout(resolve, 0))

			// Clear previous calls
			publishCalls = []

			// Trigger TaskModeSwitched event
			const mode = "architect"
			;(mockTask as any)._triggerEvent(RooCodeEventName.TaskModeSwitched, mode)

			// Verify the event was published with correct payload
			expect(publishCalls.length).toBe(1)
			expect(publishCalls[0]).toEqual({
				event: TaskSocketEvents.EVENT,
				data: {
					type: TaskBridgeEventName.TaskModeSwitched,
					taskId: taskId,
					mode: mode,
				},
			})
		})

		it("should correctly transform TaskInteractive event payloads", async () => {
			// Setup channel with task
			const channel = taskChannel as any
			let publishCalls: any[] = []

			channel.publish = vi.fn((event: string, data: any, callback?: Function) => {
				publishCalls.push({ event, data })
				if (event === TaskSocketEvents.JOIN && callback) {
					callback({ success: true })
				}
				return true
			})

			await taskChannel.onConnect(mockSocket)
			await channel.subscribeToTask(mockTask, mockSocket)
			await new Promise((resolve) => setTimeout(resolve, 0))

			// Clear previous calls
			publishCalls = []

			// Trigger TaskInteractive event
			;(mockTask as any)._triggerEvent(RooCodeEventName.TaskInteractive, taskId)

			// Verify the event was published with correct payload
			expect(publishCalls.length).toBe(1)
			expect(publishCalls[0]).toEqual({
				event: TaskSocketEvents.EVENT,
				data: {
					type: TaskBridgeEventName.TaskInteractive,
					taskId: taskId,
				},
			})
		})

		it("should properly clean up listeners using event mapping", async () => {
			// Setup channel with task
			const channel = taskChannel as any

			channel.publish = vi.fn((event: string, data: any, callback?: Function) => {
				if (event === TaskSocketEvents.JOIN && callback) {
					callback({ success: true })
				}
				if (event === TaskSocketEvents.LEAVE && callback) {
					callback({ success: true })
				}
				return true
			})

			await taskChannel.onConnect(mockSocket)
			await channel.subscribeToTask(mockTask, mockSocket)
			await new Promise((resolve) => setTimeout(resolve, 0))

			// Verify listeners are registered
			const task = mockTask as any
			expect(task._getListenerCount(RooCodeEventName.Message)).toBe(1)
			expect(task._getListenerCount(RooCodeEventName.TaskModeSwitched)).toBe(1)
			expect(task._getListenerCount(RooCodeEventName.TaskInteractive)).toBe(1)

			// Clean up
			await taskChannel.cleanup(mockSocket)

			// Verify all listeners were removed
			expect(task._getListenerCount(RooCodeEventName.Message)).toBe(0)
			expect(task._getListenerCount(RooCodeEventName.TaskModeSwitched)).toBe(0)
			expect(task._getListenerCount(RooCodeEventName.TaskInteractive)).toBe(0)
		})

		it("should handle duplicate listener prevention", async () => {
			// Setup channel with task
			await taskChannel.onConnect(mockSocket)

			// Subscribe to the same task twice
			const channel = taskChannel as any
			channel.subscribedTasks.set(taskId, mockTask)
			channel.setupTaskListeners(mockTask)

			// Try to setup listeners again (should remove old ones first)
			const warnSpy = vi.spyOn(console, "warn")
			channel.setupTaskListeners(mockTask)

			// Verify warning was logged
			expect(warnSpy).toHaveBeenCalledWith(
				`[TaskChannel] Listeners already exist for task, removing old listeners for ${taskId}`,
			)

			// Verify only one set of listeners exists
			const task = mockTask as any
			expect(task._getListenerCount(RooCodeEventName.Message)).toBe(1)
			expect(task._getListenerCount(RooCodeEventName.TaskModeSwitched)).toBe(1)
			expect(task._getListenerCount(RooCodeEventName.TaskInteractive)).toBe(1)

			warnSpy.mockRestore()
		})
	})

	describe("Command Handling", () => {
		beforeEach(async () => {
			// Setup channel with a subscribed task
			await taskChannel.onConnect(mockSocket)
			const channel = taskChannel as any
			channel.subscribedTasks.set(taskId, mockTask)
		})

		it("should handle Message command", async () => {
			const command = {
				type: TaskBridgeCommandName.Message,
				taskId,
				timestamp: Date.now(),
				payload: {
					text: "Hello, world!",
					images: ["image1.png"],
				},
			}

			await taskChannel.handleCommand(command)

			expect(mockTask.submitUserMessage).toHaveBeenCalledWith(
				command.payload.text,
				command.payload.images,
				undefined,
				undefined,
			)
		})

		it("should handle ApproveAsk command", async () => {
			const command = {
				type: TaskBridgeCommandName.ApproveAsk,
				taskId,
				timestamp: Date.now(),
				payload: {
					text: "Approved",
				},
			}

			await taskChannel.handleCommand(command)

			expect(mockTask.approveAsk).toHaveBeenCalledWith(command.payload)
		})

		it("should handle DenyAsk command", async () => {
			const command = {
				type: TaskBridgeCommandName.DenyAsk,
				taskId,
				timestamp: Date.now(),
				payload: {
					text: "Denied",
				},
			}

			await taskChannel.handleCommand(command)

			expect(mockTask.denyAsk).toHaveBeenCalledWith(command.payload)
		})

		it("should log error for unknown task", async () => {
			const errorSpy = vi.spyOn(console, "error")

			const command = {
				type: TaskBridgeCommandName.Message,
				taskId: "unknown-task",
				timestamp: Date.now(),
				payload: {
					text: "Hello",
				},
			}

			await taskChannel.handleCommand(command)

			expect(errorSpy).toHaveBeenCalledWith(`[TaskChannel] Unable to find task unknown-task`)

			errorSpy.mockRestore()
		})
	})
})
