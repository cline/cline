/* eslint-disable @typescript-eslint/no-explicit-any */

// npx vitest run src/__tests__/TelemetryClient.test.ts

import { type TelemetryPropertiesProvider, TelemetryEventName } from "@roo-code/types"

import { TelemetryClient } from "../TelemetryClient"

const mockFetch = vi.fn()
global.fetch = mockFetch as any

describe("TelemetryClient", () => {
	const getPrivateProperty = <T>(instance: any, propertyName: string): T => {
		return instance[propertyName]
	}

	let mockAuthService: any
	let mockSettingsService: any

	beforeEach(() => {
		vi.clearAllMocks()

		// Create a mock AuthService instead of using the singleton
		mockAuthService = {
			getSessionToken: vi.fn().mockReturnValue("mock-token"),
			getState: vi.fn().mockReturnValue("active-session"),
			isAuthenticated: vi.fn().mockReturnValue(true),
			hasActiveSession: vi.fn().mockReturnValue(true),
		}

		// Create a mock SettingsService
		mockSettingsService = {
			getSettings: vi.fn().mockReturnValue({
				cloudSettings: {
					recordTaskMessages: true,
				},
			}),
		}

		mockFetch.mockResolvedValue({
			ok: true,
			json: vi.fn().mockResolvedValue({}),
		})

		vi.spyOn(console, "info").mockImplementation(() => {})
		vi.spyOn(console, "error").mockImplementation(() => {})
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	describe("isEventCapturable", () => {
		it("should return true for events not in exclude list", () => {
			const client = new TelemetryClient(mockAuthService, mockSettingsService)

			const isEventCapturable = getPrivateProperty<(eventName: TelemetryEventName) => boolean>(
				client,
				"isEventCapturable",
			).bind(client)

			expect(isEventCapturable(TelemetryEventName.TASK_CREATED)).toBe(true)
			expect(isEventCapturable(TelemetryEventName.LLM_COMPLETION)).toBe(true)
			expect(isEventCapturable(TelemetryEventName.MODE_SWITCH)).toBe(true)
			expect(isEventCapturable(TelemetryEventName.TOOL_USED)).toBe(true)
		})

		it("should return false for events in exclude list", () => {
			const client = new TelemetryClient(mockAuthService, mockSettingsService)

			const isEventCapturable = getPrivateProperty<(eventName: TelemetryEventName) => boolean>(
				client,
				"isEventCapturable",
			).bind(client)

			expect(isEventCapturable(TelemetryEventName.TASK_CONVERSATION_MESSAGE)).toBe(false)
		})

		it("should return true for TASK_MESSAGE events when recordTaskMessages is true", () => {
			mockSettingsService.getSettings.mockReturnValue({
				cloudSettings: {
					recordTaskMessages: true,
				},
			})

			const client = new TelemetryClient(mockAuthService, mockSettingsService)

			const isEventCapturable = getPrivateProperty<(eventName: TelemetryEventName) => boolean>(
				client,
				"isEventCapturable",
			).bind(client)

			expect(isEventCapturable(TelemetryEventName.TASK_MESSAGE)).toBe(true)
		})

		it("should return false for TASK_MESSAGE events when recordTaskMessages is false", () => {
			mockSettingsService.getSettings.mockReturnValue({
				cloudSettings: {
					recordTaskMessages: false,
				},
			})

			const client = new TelemetryClient(mockAuthService, mockSettingsService)

			const isEventCapturable = getPrivateProperty<(eventName: TelemetryEventName) => boolean>(
				client,
				"isEventCapturable",
			).bind(client)

			expect(isEventCapturable(TelemetryEventName.TASK_MESSAGE)).toBe(false)
		})

		it("should return false for TASK_MESSAGE events when recordTaskMessages is undefined", () => {
			mockSettingsService.getSettings.mockReturnValue({
				cloudSettings: {},
			})

			const client = new TelemetryClient(mockAuthService, mockSettingsService)

			const isEventCapturable = getPrivateProperty<(eventName: TelemetryEventName) => boolean>(
				client,
				"isEventCapturable",
			).bind(client)

			expect(isEventCapturable(TelemetryEventName.TASK_MESSAGE)).toBe(false)
		})

		it("should return false for TASK_MESSAGE events when cloudSettings is undefined", () => {
			mockSettingsService.getSettings.mockReturnValue({})

			const client = new TelemetryClient(mockAuthService, mockSettingsService)

			const isEventCapturable = getPrivateProperty<(eventName: TelemetryEventName) => boolean>(
				client,
				"isEventCapturable",
			).bind(client)

			expect(isEventCapturable(TelemetryEventName.TASK_MESSAGE)).toBe(false)
		})

		it("should return false for TASK_MESSAGE events when getSettings returns undefined", () => {
			mockSettingsService.getSettings.mockReturnValue(undefined)

			const client = new TelemetryClient(mockAuthService, mockSettingsService)

			const isEventCapturable = getPrivateProperty<(eventName: TelemetryEventName) => boolean>(
				client,
				"isEventCapturable",
			).bind(client)

			expect(isEventCapturable(TelemetryEventName.TASK_MESSAGE)).toBe(false)
		})
	})

	describe("getEventProperties", () => {
		it("should merge provider properties with event properties", async () => {
			const client = new TelemetryClient(mockAuthService, mockSettingsService)

			const mockProvider: TelemetryPropertiesProvider = {
				getTelemetryProperties: vi.fn().mockResolvedValue({
					appVersion: "1.0.0",
					vscodeVersion: "1.60.0",
					platform: "darwin",
					editorName: "vscode",
					language: "en",
					mode: "code",
				}),
			}

			client.setProvider(mockProvider)

			const getEventProperties = getPrivateProperty<
				(event: { event: TelemetryEventName; properties?: Record<string, any> }) => Promise<Record<string, any>>
			>(client, "getEventProperties").bind(client)

			const result = await getEventProperties({
				event: TelemetryEventName.TASK_CREATED,
				properties: {
					customProp: "value",
					mode: "override", // This should override the provider's mode.
				},
			})

			expect(result).toEqual({
				appVersion: "1.0.0",
				vscodeVersion: "1.60.0",
				platform: "darwin",
				editorName: "vscode",
				language: "en",
				mode: "override", // Event property takes precedence.
				customProp: "value",
			})

			expect(mockProvider.getTelemetryProperties).toHaveBeenCalledTimes(1)
		})

		it("should handle errors from provider gracefully", async () => {
			const client = new TelemetryClient(mockAuthService, mockSettingsService)

			const mockProvider: TelemetryPropertiesProvider = {
				getTelemetryProperties: vi.fn().mockRejectedValue(new Error("Provider error")),
			}

			const consoleErrorSpy = vi.spyOn(console, "error")

			client.setProvider(mockProvider)

			const getEventProperties = getPrivateProperty<
				(event: { event: TelemetryEventName; properties?: Record<string, any> }) => Promise<Record<string, any>>
			>(client, "getEventProperties").bind(client)

			const result = await getEventProperties({
				event: TelemetryEventName.TASK_CREATED,
				properties: { customProp: "value" },
			})

			expect(result).toEqual({ customProp: "value" })
			expect(consoleErrorSpy).toHaveBeenCalledWith(
				expect.stringContaining("Error getting telemetry properties: Provider error"),
			)
		})

		it("should return event properties when no provider is set", async () => {
			const client = new TelemetryClient(mockAuthService, mockSettingsService)

			const getEventProperties = getPrivateProperty<
				(event: { event: TelemetryEventName; properties?: Record<string, any> }) => Promise<Record<string, any>>
			>(client, "getEventProperties").bind(client)

			const result = await getEventProperties({
				event: TelemetryEventName.TASK_CREATED,
				properties: { customProp: "value" },
			})

			expect(result).toEqual({ customProp: "value" })
		})
	})

	describe("capture", () => {
		it("should not capture events that are not capturable", async () => {
			const client = new TelemetryClient(mockAuthService, mockSettingsService)

			await client.capture({
				event: TelemetryEventName.TASK_CONVERSATION_MESSAGE, // In exclude list.
				properties: { test: "value" },
			})

			expect(mockFetch).not.toHaveBeenCalled()
		})

		it("should not capture TASK_MESSAGE events when recordTaskMessages is false", async () => {
			mockSettingsService.getSettings.mockReturnValue({
				cloudSettings: {
					recordTaskMessages: false,
				},
			})

			const client = new TelemetryClient(mockAuthService, mockSettingsService)

			await client.capture({
				event: TelemetryEventName.TASK_MESSAGE,
				properties: {
					taskId: "test-task-id",
					message: {
						ts: 1,
						type: "say",
						say: "text",
						text: "test message",
					},
				},
			})

			expect(mockFetch).not.toHaveBeenCalled()
		})

		it("should not capture TASK_MESSAGE events when recordTaskMessages is undefined", async () => {
			mockSettingsService.getSettings.mockReturnValue({
				cloudSettings: {},
			})

			const client = new TelemetryClient(mockAuthService, mockSettingsService)

			await client.capture({
				event: TelemetryEventName.TASK_MESSAGE,
				properties: {
					taskId: "test-task-id",
					message: {
						ts: 1,
						type: "say",
						say: "text",
						text: "test message",
					},
				},
			})

			expect(mockFetch).not.toHaveBeenCalled()
		})

		it("should not send request when schema validation fails", async () => {
			const client = new TelemetryClient(mockAuthService, mockSettingsService)

			await client.capture({
				event: TelemetryEventName.TASK_CREATED,
				properties: { test: "value" },
			})

			expect(mockFetch).not.toHaveBeenCalled()
			expect(console.error).toHaveBeenCalledWith(expect.stringContaining("Invalid telemetry event"))
		})

		it("should send request when event is capturable and validation passes", async () => {
			const client = new TelemetryClient(mockAuthService, mockSettingsService)

			const providerProperties = {
				appName: "roo-code",
				appVersion: "1.0.0",
				vscodeVersion: "1.60.0",
				platform: "darwin",
				editorName: "vscode",
				language: "en",
				mode: "code",
			}

			const eventProperties = {
				taskId: "test-task-id",
			}

			const mockValidatedData = {
				type: TelemetryEventName.TASK_CREATED,
				properties: {
					...providerProperties,
					taskId: "test-task-id",
				},
			}

			const mockProvider: TelemetryPropertiesProvider = {
				getTelemetryProperties: vi.fn().mockResolvedValue(providerProperties),
			}

			client.setProvider(mockProvider)

			await client.capture({
				event: TelemetryEventName.TASK_CREATED,
				properties: eventProperties,
			})

			expect(mockFetch).toHaveBeenCalledWith(
				"https://app.roocode.com/api/events",
				expect.objectContaining({
					method: "POST",
					body: JSON.stringify(mockValidatedData),
				}),
			)
		})

		it("should attempt to capture TASK_MESSAGE events when recordTaskMessages is true", async () => {
			mockSettingsService.getSettings.mockReturnValue({
				cloudSettings: {
					recordTaskMessages: true,
				},
			})

			const eventProperties = {
				appName: "roo-code",
				appVersion: "1.0.0",
				vscodeVersion: "1.60.0",
				platform: "darwin",
				editorName: "vscode",
				language: "en",
				mode: "code",
				taskId: "test-task-id",
				message: {
					ts: 1,
					type: "say",
					say: "text",
					text: "test message",
				},
			}

			const mockValidatedData = {
				type: TelemetryEventName.TASK_MESSAGE,
				properties: eventProperties,
			}

			const client = new TelemetryClient(mockAuthService, mockSettingsService)

			await client.capture({
				event: TelemetryEventName.TASK_MESSAGE,
				properties: eventProperties,
			})

			expect(mockFetch).toHaveBeenCalledWith(
				"https://app.roocode.com/api/events",
				expect.objectContaining({
					method: "POST",
					body: JSON.stringify(mockValidatedData),
				}),
			)
		})

		it("should handle fetch errors gracefully", async () => {
			const client = new TelemetryClient(mockAuthService, mockSettingsService)

			mockFetch.mockRejectedValue(new Error("Network error"))

			await expect(
				client.capture({
					event: TelemetryEventName.TASK_CREATED,
					properties: { test: "value" },
				}),
			).resolves.not.toThrow()
		})
	})

	describe("telemetry state methods", () => {
		it("should always return true for isTelemetryEnabled", () => {
			const client = new TelemetryClient(mockAuthService, mockSettingsService)
			expect(client.isTelemetryEnabled()).toBe(true)
		})

		it("should have empty implementations for updateTelemetryState and shutdown", async () => {
			const client = new TelemetryClient(mockAuthService, mockSettingsService)
			client.updateTelemetryState(true)
			await client.shutdown()
		})
	})

	describe("backfillMessages", () => {
		it("should not send request when not authenticated", async () => {
			mockAuthService.isAuthenticated.mockReturnValue(false)
			const client = new TelemetryClient(mockAuthService, mockSettingsService)

			const messages = [
				{
					ts: 1,
					type: "say" as const,
					say: "text" as const,
					text: "test message",
				},
			]

			await client.backfillMessages(messages, "test-task-id")

			expect(mockFetch).not.toHaveBeenCalled()
		})

		it("should not send request when no session token available", async () => {
			mockAuthService.getSessionToken.mockReturnValue(null)
			const client = new TelemetryClient(mockAuthService, mockSettingsService)

			const messages = [
				{
					ts: 1,
					type: "say" as const,
					say: "text" as const,
					text: "test message",
				},
			]

			await client.backfillMessages(messages, "test-task-id")

			expect(mockFetch).not.toHaveBeenCalled()
			expect(console.error).toHaveBeenCalledWith(
				"[TelemetryClient#backfillMessages] Unauthorized: No session token available.",
			)
		})

		it("should send FormData request with correct structure when authenticated", async () => {
			const client = new TelemetryClient(mockAuthService, mockSettingsService)

			const providerProperties = {
				appName: "roo-code",
				appVersion: "1.0.0",
				vscodeVersion: "1.60.0",
				platform: "darwin",
				editorName: "vscode",
				language: "en",
				mode: "code",
			}

			const mockProvider: TelemetryPropertiesProvider = {
				getTelemetryProperties: vi.fn().mockResolvedValue(providerProperties),
			}

			client.setProvider(mockProvider)

			const messages = [
				{
					ts: 1,
					type: "say" as const,
					say: "text" as const,
					text: "test message 1",
				},
				{
					ts: 2,
					type: "ask" as const,
					ask: "followup" as const,
					text: "test question",
				},
			]

			await client.backfillMessages(messages, "test-task-id")

			expect(mockFetch).toHaveBeenCalledWith(
				"https://app.roocode.com/api/events/backfill",
				expect.objectContaining({
					method: "POST",
					headers: {
						Authorization: "Bearer mock-token",
					},
					body: expect.any(FormData),
				}),
			)

			// Verify FormData contents
			const call = mockFetch.mock.calls[0]
			const formData = call[1].body as FormData

			expect(formData.get("taskId")).toBe("test-task-id")

			// Parse and compare properties as objects since JSON.stringify order can vary
			const propertiesJson = formData.get("properties") as string
			const parsedProperties = JSON.parse(propertiesJson)
			expect(parsedProperties).toEqual({
				taskId: "test-task-id",
				...providerProperties,
			})
			// The messages are stored as a File object under the "file" key
			const fileField = formData.get("file") as File
			expect(fileField).toBeInstanceOf(File)
			expect(fileField.name).toBe("task.json")
			expect(fileField.type).toBe("application/json")

			// Read the file content to verify the messages
			const fileContent = await fileField.text()
			expect(fileContent).toBe(JSON.stringify(messages))
		})

		it("should handle provider errors gracefully", async () => {
			const client = new TelemetryClient(mockAuthService, mockSettingsService)

			const mockProvider: TelemetryPropertiesProvider = {
				getTelemetryProperties: vi.fn().mockRejectedValue(new Error("Provider error")),
			}

			client.setProvider(mockProvider)

			const messages = [
				{
					ts: 1,
					type: "say" as const,
					say: "text" as const,
					text: "test message",
				},
			]

			await client.backfillMessages(messages, "test-task-id")

			expect(mockFetch).toHaveBeenCalledWith(
				"https://app.roocode.com/api/events/backfill",
				expect.objectContaining({
					method: "POST",
					headers: {
						Authorization: "Bearer mock-token",
					},
					body: expect.any(FormData),
				}),
			)

			// Verify FormData contents - should still work with just taskId
			const call = mockFetch.mock.calls[0]
			const formData = call[1].body as FormData

			expect(formData.get("taskId")).toBe("test-task-id")
			expect(formData.get("properties")).toBe(
				JSON.stringify({
					taskId: "test-task-id",
				}),
			)
			// The messages are stored as a File object under the "file" key
			const fileField = formData.get("file") as File
			expect(fileField).toBeInstanceOf(File)
			expect(fileField.name).toBe("task.json")
			expect(fileField.type).toBe("application/json")

			// Read the file content to verify the messages
			const fileContent = await fileField.text()
			expect(fileContent).toBe(JSON.stringify(messages))
		})

		it("should work without provider set", async () => {
			const client = new TelemetryClient(mockAuthService, mockSettingsService)

			const messages = [
				{
					ts: 1,
					type: "say" as const,
					say: "text" as const,
					text: "test message",
				},
			]

			await client.backfillMessages(messages, "test-task-id")

			expect(mockFetch).toHaveBeenCalledWith(
				"https://app.roocode.com/api/events/backfill",
				expect.objectContaining({
					method: "POST",
					headers: {
						Authorization: "Bearer mock-token",
					},
					body: expect.any(FormData),
				}),
			)

			// Verify FormData contents - should work with just taskId
			const call = mockFetch.mock.calls[0]
			const formData = call[1].body as FormData

			expect(formData.get("taskId")).toBe("test-task-id")
			expect(formData.get("properties")).toBe(
				JSON.stringify({
					taskId: "test-task-id",
				}),
			)
			// The messages are stored as a File object under the "file" key
			const fileField = formData.get("file") as File
			expect(fileField).toBeInstanceOf(File)
			expect(fileField.name).toBe("task.json")
			expect(fileField.type).toBe("application/json")

			// Read the file content to verify the messages
			const fileContent = await fileField.text()
			expect(fileContent).toBe(JSON.stringify(messages))
		})

		it("should handle fetch errors gracefully", async () => {
			const client = new TelemetryClient(mockAuthService, mockSettingsService)

			mockFetch.mockRejectedValue(new Error("Network error"))

			const messages = [
				{
					ts: 1,
					type: "say" as const,
					say: "text" as const,
					text: "test message",
				},
			]

			await expect(client.backfillMessages(messages, "test-task-id")).resolves.not.toThrow()

			expect(console.error).toHaveBeenCalledWith(
				expect.stringContaining(
					"[TelemetryClient#backfillMessages] Error uploading messages: Error: Network error",
				),
			)
		})

		it("should handle HTTP error responses", async () => {
			const client = new TelemetryClient(mockAuthService, mockSettingsService)

			mockFetch.mockResolvedValue({
				ok: false,
				status: 404,
				statusText: "Not Found",
			})

			const messages = [
				{
					ts: 1,
					type: "say" as const,
					say: "text" as const,
					text: "test message",
				},
			]

			await client.backfillMessages(messages, "test-task-id")

			expect(console.error).toHaveBeenCalledWith(
				"[TelemetryClient#backfillMessages] POST events/backfill -> 404 Not Found",
			)
		})

		it("should log debug information when debug is enabled", async () => {
			const client = new TelemetryClient(mockAuthService, mockSettingsService, true)

			const messages = [
				{
					ts: 1,
					type: "say" as const,
					say: "text" as const,
					text: "test message",
				},
			]

			await client.backfillMessages(messages, "test-task-id")

			expect(console.info).toHaveBeenCalledWith(
				"[TelemetryClient#backfillMessages] Uploading 1 messages for task test-task-id",
			)
			expect(console.info).toHaveBeenCalledWith(
				"[TelemetryClient#backfillMessages] Successfully uploaded messages for task test-task-id",
			)
		})

		it("should handle empty messages array", async () => {
			const client = new TelemetryClient(mockAuthService, mockSettingsService)

			await client.backfillMessages([], "test-task-id")

			expect(mockFetch).toHaveBeenCalledWith(
				"https://app.roocode.com/api/events/backfill",
				expect.objectContaining({
					method: "POST",
					headers: {
						Authorization: "Bearer mock-token",
					},
					body: expect.any(FormData),
				}),
			)

			// Verify FormData contents
			const call = mockFetch.mock.calls[0]
			const formData = call[1].body as FormData

			// The messages are stored as a File object under the "file" key
			const fileField = formData.get("file") as File
			expect(fileField).toBeInstanceOf(File)
			expect(fileField.name).toBe("task.json")
			expect(fileField.type).toBe("application/json")

			// Read the file content to verify the empty messages array
			const fileContent = await fileField.text()
			expect(fileContent).toBe("[]")
		})
	})
})
