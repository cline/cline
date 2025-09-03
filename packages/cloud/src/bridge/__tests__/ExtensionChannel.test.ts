/* eslint-disable @typescript-eslint/no-explicit-any */

import type { Socket } from "socket.io-client"

import {
	type TaskProviderLike,
	type TaskProviderEvents,
	type StaticAppProperties,
	RooCodeEventName,
	ExtensionBridgeEventName,
	ExtensionSocketEvents,
} from "@roo-code/types"

import { ExtensionChannel } from "../ExtensionChannel.js"

describe("ExtensionChannel", () => {
	let mockSocket: Socket
	let mockProvider: TaskProviderLike
	let extensionChannel: ExtensionChannel
	const instanceId = "test-instance-123"
	const userId = "test-user-456"

	const appProperties: StaticAppProperties = {
		appName: "roo-code",
		appVersion: "1.0.0",
		vscodeVersion: "1.0.0",
		platform: "darwin",
		editorName: "Roo Code",
		hostname: "test-host",
	}

	// Track registered event listeners
	const eventListeners = new Map<keyof TaskProviderEvents, Set<(...args: unknown[]) => unknown>>()

	beforeEach(() => {
		// Reset the event listeners tracker
		eventListeners.clear()

		// Create mock socket
		mockSocket = {
			emit: vi.fn(),
			on: vi.fn(),
			off: vi.fn(),
			disconnect: vi.fn(),
		} as unknown as Socket

		// Create mock provider with event listener tracking
		mockProvider = {
			cwd: "/test/workspace",
			appProperties: {
				version: "1.0.0",
				extensionVersion: "1.0.0",
			},
			gitProperties: undefined,
			getCurrentTask: vi.fn().mockReturnValue(undefined),
			getCurrentTaskStack: vi.fn().mockReturnValue([]),
			getRecentTasks: vi.fn().mockReturnValue([]),
			createTask: vi.fn(),
			cancelTask: vi.fn(),
			clearTask: vi.fn(),
			resumeTask: vi.fn(),
			getState: vi.fn(),
			postStateToWebview: vi.fn(),
			postMessageToWebview: vi.fn(),
			getTelemetryProperties: vi.fn(),
			getMode: vi.fn().mockResolvedValue("code"),
			getModes: vi.fn().mockResolvedValue([
				{ slug: "code", name: "Code", description: "Code mode" },
				{ slug: "architect", name: "Architect", description: "Architect mode" },
			]),
			getProviderProfile: vi.fn().mockResolvedValue("default"),
			getProviderProfiles: vi.fn().mockResolvedValue([{ name: "default", description: "Default profile" }]),
			on: vi.fn((event: keyof TaskProviderEvents, listener: (...args: unknown[]) => unknown) => {
				if (!eventListeners.has(event)) {
					eventListeners.set(event, new Set())
				}
				eventListeners.get(event)!.add(listener)
				return mockProvider
			}),
			off: vi.fn((event: keyof TaskProviderEvents, listener: (...args: unknown[]) => unknown) => {
				const listeners = eventListeners.get(event)
				if (listeners) {
					listeners.delete(listener)
					if (listeners.size === 0) {
						eventListeners.delete(event)
					}
				}
				return mockProvider
			}),
		} as unknown as TaskProviderLike

		// Create extension channel instance
		extensionChannel = new ExtensionChannel({
			instanceId,
			appProperties,
			userId,
			provider: mockProvider,
		})
	})

	afterEach(() => {
		vi.clearAllMocks()
	})

	describe("Event Listener Management", () => {
		it("should register event listeners on initialization", () => {
			// Verify that listeners were registered for all expected events
			const expectedEvents: RooCodeEventName[] = [
				RooCodeEventName.TaskCreated,
				RooCodeEventName.TaskStarted,
				RooCodeEventName.TaskCompleted,
				RooCodeEventName.TaskAborted,
				RooCodeEventName.TaskFocused,
				RooCodeEventName.TaskUnfocused,
				RooCodeEventName.TaskActive,
				RooCodeEventName.TaskInteractive,
				RooCodeEventName.TaskResumable,
				RooCodeEventName.TaskIdle,
				RooCodeEventName.TaskPaused,
				RooCodeEventName.TaskUnpaused,
				RooCodeEventName.TaskSpawned,
				RooCodeEventName.TaskUserMessage,
				RooCodeEventName.TaskTokenUsageUpdated,
			]

			// Check that on() was called for each event
			expect(mockProvider.on).toHaveBeenCalledTimes(expectedEvents.length)

			// Verify each event was registered
			expectedEvents.forEach((eventName) => {
				expect(mockProvider.on).toHaveBeenCalledWith(eventName, expect.any(Function))
			})

			// Verify listeners are tracked in our Map
			expect(eventListeners.size).toBe(expectedEvents.length)
		})

		it("should remove all event listeners during cleanup", async () => {
			// Verify initial state - listeners are registered
			const initialListenerCount = eventListeners.size
			expect(initialListenerCount).toBeGreaterThan(0)

			// Get the count of listeners for each event before cleanup
			const listenerCountsBefore = new Map<keyof TaskProviderEvents, number>()
			eventListeners.forEach((listeners, event) => {
				listenerCountsBefore.set(event, listeners.size)
			})

			// Perform cleanup
			await extensionChannel.cleanup(mockSocket)

			// Verify that off() was called for each registered event
			expect(mockProvider.off).toHaveBeenCalledTimes(initialListenerCount)

			// Verify all listeners were removed from our tracking Map
			expect(eventListeners.size).toBe(0)

			// Verify that the same listener functions that were added were removed
			const onCalls = (mockProvider.on as any).mock.calls
			const offCalls = (mockProvider.off as any).mock.calls

			// Each on() call should have a corresponding off() call with the same listener
			onCalls.forEach(([eventName, listener]: [keyof TaskProviderEvents, any]) => {
				const hasMatchingOff = offCalls.some(
					([offEvent, offListener]: [keyof TaskProviderEvents, any]) =>
						offEvent === eventName && offListener === listener,
				)
				expect(hasMatchingOff).toBe(true)
			})
		})

		it("should not have duplicate listeners after multiple channel creations", () => {
			// Create a second channel with the same provider
			const secondChannel = new ExtensionChannel({
				instanceId: "instance-2",
				appProperties,
				userId,
				provider: mockProvider,
			})

			// Each event should have exactly 2 listeners (one from each channel)
			eventListeners.forEach((listeners) => {
				expect(listeners.size).toBe(2)
			})

			// Clean up the first channel
			extensionChannel.cleanup(mockSocket)

			// Each event should now have exactly 1 listener (from the second channel)
			eventListeners.forEach((listeners) => {
				expect(listeners.size).toBe(1)
			})

			// Clean up the second channel
			secondChannel.cleanup(mockSocket)

			// All listeners should be removed
			expect(eventListeners.size).toBe(0)
		})

		it("should handle cleanup even if called multiple times", async () => {
			// First cleanup
			await extensionChannel.cleanup(mockSocket)
			const firstOffCallCount = (mockProvider.off as any).mock.calls.length

			// Second cleanup (should be safe to call again)
			await extensionChannel.cleanup(mockSocket)
			const secondOffCallCount = (mockProvider.off as any).mock.calls.length

			// The second cleanup shouldn't try to remove listeners again
			// since the internal Map was cleared
			expect(secondOffCallCount).toBe(firstOffCallCount)
		})

		it("should properly forward events to socket when listeners are triggered", async () => {
			// Connect the socket to enable publishing
			await extensionChannel.onConnect(mockSocket)

			// Clear the mock calls from the connection (which emits a register event)
			;(mockSocket.emit as any).mockClear()

			// Get a listener that was registered for TaskStarted
			const taskStartedListeners = eventListeners.get(RooCodeEventName.TaskStarted)
			expect(taskStartedListeners).toBeDefined()
			expect(taskStartedListeners!.size).toBe(1)

			// Trigger the listener
			const listener = Array.from(taskStartedListeners!)[0]
			if (listener) {
				await listener("test-task-id")
			}

			// Verify the event was published to the socket
			expect(mockSocket.emit).toHaveBeenCalledWith(
				ExtensionSocketEvents.EVENT,
				expect.objectContaining({
					type: ExtensionBridgeEventName.TaskStarted,
					instance: expect.objectContaining({
						instanceId,
						userId,
					}),
					timestamp: expect.any(Number),
				}),
				undefined,
			)
		})
	})

	describe("Memory Leak Prevention", () => {
		it("should not accumulate listeners over multiple connect/disconnect cycles", async () => {
			// Simulate multiple connect/disconnect cycles
			for (let i = 0; i < 5; i++) {
				await extensionChannel.onConnect(mockSocket)
				extensionChannel.onDisconnect()
			}

			// Listeners should still be the same count (not accumulated)
			expect(eventListeners.size).toBe(15)

			// Each event should have exactly 1 listener
			eventListeners.forEach((listeners) => {
				expect(listeners.size).toBe(1)
			})
		})

		it("should properly clean up heartbeat interval", async () => {
			// Spy on setInterval and clearInterval
			const setIntervalSpy = vi.spyOn(global, "setInterval")
			const clearIntervalSpy = vi.spyOn(global, "clearInterval")

			// Connect to start heartbeat
			await extensionChannel.onConnect(mockSocket)
			expect(setIntervalSpy).toHaveBeenCalled()

			// Get the interval ID
			const intervalId = setIntervalSpy.mock.results[0]?.value

			// Cleanup should stop the heartbeat
			await extensionChannel.cleanup(mockSocket)
			expect(clearIntervalSpy).toHaveBeenCalledWith(intervalId)

			setIntervalSpy.mockRestore()
			clearIntervalSpy.mockRestore()
		})
	})
})
