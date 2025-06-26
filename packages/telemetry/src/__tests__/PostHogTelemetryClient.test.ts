/* eslint-disable @typescript-eslint/no-explicit-any */

// npx vitest run src/__tests__/PostHogTelemetryClient.test.ts

import * as vscode from "vscode"
import { PostHog } from "posthog-node"

import { type TelemetryPropertiesProvider, TelemetryEventName } from "@roo-code/types"

import { PostHogTelemetryClient } from "../PostHogTelemetryClient"

vi.mock("posthog-node")

vi.mock("vscode", () => ({
	env: {
		machineId: "test-machine-id",
	},
	workspace: {
		getConfiguration: vi.fn(),
	},
}))

describe("PostHogTelemetryClient", () => {
	const getPrivateProperty = <T>(instance: any, propertyName: string): T => {
		return instance[propertyName]
	}

	let mockPostHogClient: any

	beforeEach(() => {
		vi.clearAllMocks()

		mockPostHogClient = {
			capture: vi.fn(),
			optIn: vi.fn(),
			optOut: vi.fn(),
			shutdown: vi.fn().mockResolvedValue(undefined),
		}
		;(PostHog as any).mockImplementation(() => mockPostHogClient)

		// @ts-expect-error - Accessing private static property for testing
		PostHogTelemetryClient._instance = undefined
		;(vscode.workspace.getConfiguration as any).mockReturnValue({
			get: vi.fn().mockReturnValue("all"),
		})
	})

	describe("isEventCapturable", () => {
		it("should return true for events not in exclude list", () => {
			const client = new PostHogTelemetryClient()

			const isEventCapturable = getPrivateProperty<(eventName: TelemetryEventName) => boolean>(
				client,
				"isEventCapturable",
			).bind(client)

			expect(isEventCapturable(TelemetryEventName.TASK_CREATED)).toBe(true)
			expect(isEventCapturable(TelemetryEventName.MODE_SWITCH)).toBe(true)
		})

		it("should return false for events in exclude list", () => {
			const client = new PostHogTelemetryClient()

			const isEventCapturable = getPrivateProperty<(eventName: TelemetryEventName) => boolean>(
				client,
				"isEventCapturable",
			).bind(client)

			expect(isEventCapturable(TelemetryEventName.LLM_COMPLETION)).toBe(false)
		})
	})

	describe("isPropertyCapturable", () => {
		it("should filter out git repository properties", () => {
			const client = new PostHogTelemetryClient()

			const isPropertyCapturable = getPrivateProperty<(propertyName: string) => boolean>(
				client,
				"isPropertyCapturable",
			).bind(client)

			// Git properties should be filtered out
			expect(isPropertyCapturable("repositoryUrl")).toBe(false)
			expect(isPropertyCapturable("repositoryName")).toBe(false)
			expect(isPropertyCapturable("defaultBranch")).toBe(false)

			// Other properties should be included
			expect(isPropertyCapturable("appVersion")).toBe(true)
			expect(isPropertyCapturable("vscodeVersion")).toBe(true)
			expect(isPropertyCapturable("platform")).toBe(true)
			expect(isPropertyCapturable("mode")).toBe(true)
			expect(isPropertyCapturable("customProperty")).toBe(true)
		})
	})

	describe("getEventProperties", () => {
		it("should merge provider properties with event properties", async () => {
			const client = new PostHogTelemetryClient()

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

		it("should filter out git repository properties", async () => {
			const client = new PostHogTelemetryClient()

			const mockProvider: TelemetryPropertiesProvider = {
				getTelemetryProperties: vi.fn().mockResolvedValue({
					appVersion: "1.0.0",
					vscodeVersion: "1.60.0",
					platform: "darwin",
					editorName: "vscode",
					language: "en",
					mode: "code",
					// Git properties that should be filtered out
					repositoryUrl: "https://github.com/example/repo",
					repositoryName: "example/repo",
					defaultBranch: "main",
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
				},
			})

			// Git properties should be filtered out
			expect(result).not.toHaveProperty("repositoryUrl")
			expect(result).not.toHaveProperty("repositoryName")
			expect(result).not.toHaveProperty("defaultBranch")

			// Other properties should be included
			expect(result).toEqual({
				appVersion: "1.0.0",
				vscodeVersion: "1.60.0",
				platform: "darwin",
				editorName: "vscode",
				language: "en",
				mode: "code",
				customProp: "value",
			})
		})

		it("should handle errors from provider gracefully", async () => {
			const client = new PostHogTelemetryClient()

			const mockProvider: TelemetryPropertiesProvider = {
				getTelemetryProperties: vi.fn().mockRejectedValue(new Error("Provider error")),
			}

			const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
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

			consoleErrorSpy.mockRestore()
		})

		it("should return event properties when no provider is set", async () => {
			const client = new PostHogTelemetryClient()

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
		it("should not capture events when telemetry is disabled", async () => {
			const client = new PostHogTelemetryClient()
			client.updateTelemetryState(false)

			await client.capture({
				event: TelemetryEventName.TASK_CREATED,
				properties: { test: "value" },
			})

			expect(mockPostHogClient.capture).not.toHaveBeenCalled()
		})

		it("should not capture events that are not capturable", async () => {
			const client = new PostHogTelemetryClient()
			client.updateTelemetryState(true)

			await client.capture({
				event: TelemetryEventName.LLM_COMPLETION, // This is in the exclude list.
				properties: { test: "value" },
			})

			expect(mockPostHogClient.capture).not.toHaveBeenCalled()
		})

		it("should capture events when telemetry is enabled and event is capturable", async () => {
			const client = new PostHogTelemetryClient()
			client.updateTelemetryState(true)

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

			await client.capture({
				event: TelemetryEventName.TASK_CREATED,
				properties: { test: "value" },
			})

			expect(mockPostHogClient.capture).toHaveBeenCalledWith({
				distinctId: "test-machine-id",
				event: TelemetryEventName.TASK_CREATED,
				properties: expect.objectContaining({
					appVersion: "1.0.0",
					test: "value",
				}),
			})
		})

		it("should filter out git repository properties when capturing events", async () => {
			const client = new PostHogTelemetryClient()
			client.updateTelemetryState(true)

			const mockProvider: TelemetryPropertiesProvider = {
				getTelemetryProperties: vi.fn().mockResolvedValue({
					appVersion: "1.0.0",
					vscodeVersion: "1.60.0",
					platform: "darwin",
					editorName: "vscode",
					language: "en",
					mode: "code",
					// Git properties that should be filtered out
					repositoryUrl: "https://github.com/example/repo",
					repositoryName: "example/repo",
					defaultBranch: "main",
				}),
			}

			client.setProvider(mockProvider)

			await client.capture({
				event: TelemetryEventName.TASK_CREATED,
				properties: { test: "value" },
			})

			expect(mockPostHogClient.capture).toHaveBeenCalledWith({
				distinctId: "test-machine-id",
				event: TelemetryEventName.TASK_CREATED,
				properties: expect.objectContaining({
					appVersion: "1.0.0",
					test: "value",
				}),
			})

			// Verify git properties are not included
			const captureCall = mockPostHogClient.capture.mock.calls[0][0]
			expect(captureCall.properties).not.toHaveProperty("repositoryUrl")
			expect(captureCall.properties).not.toHaveProperty("repositoryName")
			expect(captureCall.properties).not.toHaveProperty("defaultBranch")
		})
	})

	describe("updateTelemetryState", () => {
		it("should enable telemetry when user opts in and global telemetry is enabled", () => {
			const client = new PostHogTelemetryClient()

			;(vscode.workspace.getConfiguration as any).mockReturnValue({
				get: vi.fn().mockReturnValue("all"),
			})

			client.updateTelemetryState(true)

			expect(client.isTelemetryEnabled()).toBe(true)
			expect(mockPostHogClient.optIn).toHaveBeenCalled()
		})

		it("should disable telemetry when user opts out", () => {
			const client = new PostHogTelemetryClient()

			;(vscode.workspace.getConfiguration as any).mockReturnValue({
				get: vi.fn().mockReturnValue("all"),
			})

			client.updateTelemetryState(false)

			expect(client.isTelemetryEnabled()).toBe(false)
			expect(mockPostHogClient.optOut).toHaveBeenCalled()
		})

		it("should disable telemetry when global telemetry is disabled, regardless of user opt-in", () => {
			const client = new PostHogTelemetryClient()

			;(vscode.workspace.getConfiguration as any).mockReturnValue({
				get: vi.fn().mockReturnValue("off"),
			})

			client.updateTelemetryState(true)
			expect(client.isTelemetryEnabled()).toBe(false)
			expect(mockPostHogClient.optOut).toHaveBeenCalled()
		})
	})

	describe("shutdown", () => {
		it("should call shutdown on the PostHog client", async () => {
			const client = new PostHogTelemetryClient()
			await client.shutdown()
			expect(mockPostHogClient.shutdown).toHaveBeenCalled()
		})
	})
})
