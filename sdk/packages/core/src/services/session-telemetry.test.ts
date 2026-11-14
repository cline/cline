import type { ITelemetryService } from "@cline/shared";
import * as storage from "@cline/shared/storage";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as hookConfig from "../hooks/hook-file-config";
import { captureHookDiscoveryTelemetry } from "./session-telemetry";
import * as coreEvents from "./telemetry/core-events";

describe("captureHookDiscoveryTelemetry", () => {
	const mockTelemetry = {} as ITelemetryService;

	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it("correctly identifies global vs workspace hooks with POSIX path separators", () => {
		const captureSpy = vi
			.spyOn(coreEvents, "captureHookDiscovery")
			.mockImplementation(() => {});
		vi.spyOn(storage, "resolveDocumentsExtensionPath").mockReturnValue(
			"/Users/test/Documents/Cline/Hooks",
		);

		vi.spyOn(hookConfig, "listHookConfigFiles").mockReturnValue([
			{
				path: "/Users/test/Documents/Cline/Hooks/TaskStart.sh",
				hookEventName: "agent_start",
			},
			{
				path: "/workspace/.clinerules/hooks/TaskStart.sh",
				hookEventName: "agent_start",
			},
			{
				path: "/workspace/.clinerules/hooks/PreToolUse.sh",
				hookEventName: "tool_call",
			},
		] as ReturnType<typeof hookConfig.listHookConfigFiles>);

		captureHookDiscoveryTelemetry(mockTelemetry, {
			workspacePath: "/workspace",
		});

		expect(captureSpy).toHaveBeenCalledWith(mockTelemetry, "agent_start", 1, 1);
		expect(captureSpy).toHaveBeenCalledWith(mockTelemetry, "tool_call", 0, 1);
	});

	it("correctly identifies global vs workspace hooks with Windows backslash path separators", () => {
		const captureSpy = vi
			.spyOn(coreEvents, "captureHookDiscovery")
			.mockImplementation(() => {});
		vi.spyOn(storage, "resolveDocumentsExtensionPath").mockReturnValue(
			"C:\\Users\\test\\Documents\\Cline\\Hooks",
		);

		vi.spyOn(hookConfig, "listHookConfigFiles").mockReturnValue([
			{
				path: "C:\\Users\\test\\Documents\\Cline\\Hooks\\TaskStart.ps1",
				hookEventName: "agent_start",
			},
			{
				path: "C:\\projects\\my-app\\.clinerules\\hooks\\TaskStart.ps1",
				hookEventName: "agent_start",
			},
			{
				path: "C:\\Users\\test\\Documents\\Cline\\Hooks\\PreToolUse.ps1",
				hookEventName: "tool_call",
			},
		] as ReturnType<typeof hookConfig.listHookConfigFiles>);

		captureHookDiscoveryTelemetry(mockTelemetry, {
			workspacePath: "C:\\projects\\my-app",
		});

		expect(captureSpy).toHaveBeenCalledWith(mockTelemetry, "agent_start", 1, 1);
		expect(captureSpy).toHaveBeenCalledWith(mockTelemetry, "tool_call", 1, 0);
	});

	it("handles mixed forward and backward slashes on Windows", () => {
		const captureSpy = vi
			.spyOn(coreEvents, "captureHookDiscovery")
			.mockImplementation(() => {});
		vi.spyOn(storage, "resolveDocumentsExtensionPath").mockReturnValue(
			"C:/Users/test/Documents/Cline/Hooks",
		);

		vi.spyOn(hookConfig, "listHookConfigFiles").mockReturnValue([
			{
				path: "C:\\Users\\test\\Documents\\Cline\\Hooks\\TaskStart.ps1",
				hookEventName: "agent_start",
			},
		] as ReturnType<typeof hookConfig.listHookConfigFiles>);

		captureHookDiscoveryTelemetry(mockTelemetry, {
			workspacePath: "C:\\projects\\my-app",
		});

		expect(captureSpy).toHaveBeenCalledWith(mockTelemetry, "agent_start", 1, 0);
	});
});
