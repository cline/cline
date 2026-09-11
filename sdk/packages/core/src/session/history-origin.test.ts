import { describe, expect, it } from "vitest";
import {
	readSessionHistoryOriginMetadata,
	resolveClientSessionSource,
	withSessionHistoryOriginMetadata,
} from "./history-origin";

describe("session history origin", () => {
	it("keeps provenance in a typed metadata namespace", () => {
		const metadata = withSessionHistoryOriginMetadata(
			{ title: "Investigate the SDK" },
			{ mode: "automation", version: "3.99.0" },
		);

		expect(metadata).toEqual({
			title: "Investigate the SDK",
			sessionHistoryOrigin: {
				mode: "automation",
				version: "3.99.0",
			},
		});
		expect(readSessionHistoryOriginMetadata(metadata)).toEqual({
			mode: "automation",
			version: "3.99.0",
		});
	});

	it("preserves stored values when a later boundary has no override", () => {
		const metadata = withSessionHistoryOriginMetadata(undefined, {
			mode: "automation",
			version: "3.98.1",
			trigger: "hub-schedule",
		});

		expect(withSessionHistoryOriginMetadata(metadata, {})).toEqual(metadata);
	});

	it("records the trigger that initiated an automation session", () => {
		const metadata = withSessionHistoryOriginMetadata(undefined, {
			mode: "automation",
			trigger: "custom-trigger",
		});

		expect(readSessionHistoryOriginMetadata(metadata)).toEqual({
			mode: "automation",
			trigger: "custom-trigger",
		});
	});

	it("falls back to user when no mode is provided", () => {
		expect(withSessionHistoryOriginMetadata(undefined, {})).toEqual({
			sessionHistoryOrigin: { mode: "user" },
		});
	});

	it.each([
		{ name: "VSCode Extension", source: "vscode" },
		{ name: "Cline for JetBrains", source: "jetbrains" },
		{ name: "Cline", source: "jetbrains", platform: "WebStorm" },
		{ name: "cline-cli", source: "cli" },
		{ name: "cline-acp", source: "cli" },
		{ name: "cline-sdk", source: "core" },
		{ name: "cline-kanban", source: "kanban" },
		{ name: "Cline Desktop", source: "desktop" },
	])("maps the $name client to the $source session source", (testCase) => {
		expect(resolveClientSessionSource(testCase)).toBe(testCase.source);
	});
});
