import type { ITelemetryService } from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import {
	captureMarketplaceInstallEvent,
	marketplaceInstallEventFromFailure,
	marketplaceInstallEventFromResult,
	requestedMarketplaceType,
} from "./marketplace-telemetry";

function telemetryStub(enabled = true) {
	const capture = vi.fn();
	const telemetry = {
		isEnabled: () => enabled,
		capture,
	} as unknown as ITelemetryService;
	return { telemetry, capture };
}

describe("marketplace install telemetry", () => {
	it("maps install results to one event with the path taken", () => {
		expect(
			marketplaceInstallEventFromResult({
				type: "skill",
				details: { method: "github-download", cli_failure: "git-missing" },
			}),
		).toEqual({
			type: "skill",
			outcome: "installed",
			method: "github-download",
			cli_failure: "git-missing",
		});
		expect(
			marketplaceInstallEventFromResult({
				type: "skill",
				details: { method: "already-installed" },
			}),
		).toMatchObject({ outcome: "already_installed" });
		expect(
			marketplaceInstallEventFromResult({
				type: "plugin",
				details: { installPath: "/x" },
			}),
		).toEqual({ type: "plugin", outcome: "installed" });
	});

	it("maps failures, keeping only the coarse classification", () => {
		expect(
			marketplaceInstallEventFromFailure("skill", {
				method: "skills-cli",
				cli_failure: "npx-missing",
				raw_output: "'npx' is not recognized...",
			}),
		).toEqual({
			type: "skill",
			outcome: "failed",
			method: "skills-cli",
			cli_failure: "npx-missing",
		});
		expect(marketplaceInstallEventFromFailure("mcp", undefined)).toEqual({
			type: "mcp",
			outcome: "failed",
		});
	});

	it("reads the requested type from either request shape", () => {
		expect(
			requestedMarketplaceType({ entry: { id: "x", type: "skill" } }),
		).toBe("skill");
		expect(requestedMarketplaceType({ id: "x", type: "mcp" })).toBe("mcp");
		expect(requestedMarketplaceType(undefined)).toBe("unknown");
	});

	it("captures desktop.marketplace.install without undefined properties", () => {
		const { telemetry, capture } = telemetryStub();

		captureMarketplaceInstallEvent(telemetry, {
			type: "skill",
			outcome: "failed",
			method: "github-download",
			cli_failure: "node-too-old",
			fallback_failed: true,
		});

		expect(capture).toHaveBeenCalledWith({
			event: "desktop.marketplace.install",
			properties: {
				type: "skill",
				outcome: "failed",
				method: "github-download",
				cli_failure: "node-too-old",
				fallback_failed: true,
			},
		});
	});

	it("is a no-op when telemetry is disabled or missing, and never throws", () => {
		const disabled = telemetryStub(false);
		captureMarketplaceInstallEvent(disabled.telemetry, {
			type: "skill",
			outcome: "installed",
		});
		expect(disabled.capture).not.toHaveBeenCalled();

		captureMarketplaceInstallEvent(undefined, {
			type: "skill",
			outcome: "installed",
		});

		const throwing = {
			isEnabled: () => true,
			capture: () => {
				throw new Error("provider down");
			},
		} as unknown as ITelemetryService;
		expect(() =>
			captureMarketplaceInstallEvent(throwing, {
				type: "skill",
				outcome: "installed",
			}),
		).not.toThrow();
	});
});
