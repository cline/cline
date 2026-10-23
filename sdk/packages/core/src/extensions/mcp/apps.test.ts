import { describe, expect, it } from "vitest";
import {
	createMcpAppsClientCapabilities,
	getMcpAppToolMeta,
	isMcpAppResourceUri,
	isMcpToolVisibleToApp,
	isMcpToolVisibleToModel,
} from "./apps";

describe("MCP Apps tool metadata", () => {
	it("advertises the HTML app profile under the UI extension", () => {
		expect(createMcpAppsClientCapabilities()).toEqual({
			extensions: {
				"io.modelcontextprotocol/ui": {
					mimeTypes: ["text/html;profile=mcp-app"],
				},
			},
		});
	});

	it("accepts only ui:// resource URIs", () => {
		expect(isMcpAppResourceUri("ui://weather/view.html")).toBe(true);
		expect(isMcpAppResourceUri("https://example.test/view.html")).toBe(false);
		expect(isMcpAppResourceUri("not a uri")).toBe(false);
	});

	it("treats tools without UI metadata as plain model tools", () => {
		expect(getMcpAppToolMeta({})).toBeUndefined();
		expect(isMcpToolVisibleToModel({})).toBe(true);
		expect(isMcpToolVisibleToApp({})).toBe(true);
	});

	it("defaults visibility to model and app when only a resource is declared", () => {
		const tool = { _meta: { ui: { resourceUri: "ui://weather/view.html" } } };
		expect(getMcpAppToolMeta(tool)).toEqual({
			resourceUri: "ui://weather/view.html",
			visibility: ["model", "app"],
		});
		expect(isMcpToolVisibleToModel(tool)).toBe(true);
		expect(isMcpToolVisibleToApp(tool)).toBe(true);
	});

	it("hides app-only tools from the model", () => {
		const tool = { _meta: { ui: { visibility: ["app"] } } };
		expect(isMcpToolVisibleToModel(tool)).toBe(false);
		expect(isMcpToolVisibleToApp(tool)).toBe(true);
	});

	it("keeps model-only tools away from apps", () => {
		const tool = { _meta: { ui: { visibility: ["model"] } } };
		expect(isMcpToolVisibleToModel(tool)).toBe(true);
		expect(isMcpToolVisibleToApp(tool)).toBe(false);
	});

	it("drops unknown visibility entries and non-ui resource URIs", () => {
		expect(
			getMcpAppToolMeta({
				_meta: {
					ui: {
						resourceUri: "https://example.test/view.html",
						visibility: ["app", "everyone"],
					},
				},
			}),
		).toEqual({ resourceUri: undefined, visibility: ["app"] });
	});

	it("falls back to the default visibility when visibility is not an array", () => {
		const tool = { _meta: { ui: { visibility: "app" } } };
		expect(getMcpAppToolMeta(tool)?.visibility).toEqual(["model", "app"]);
		expect(isMcpToolVisibleToModel(tool)).toBe(true);
	});

	it("treats an explicit visibility array as authoritative even when empty", () => {
		for (const visibility of [[], ["everyone"]]) {
			const tool = { _meta: { ui: { visibility } } };
			expect(getMcpAppToolMeta(tool)?.visibility).toEqual([]);
			expect(isMcpToolVisibleToModel(tool)).toBe(false);
			expect(isMcpToolVisibleToApp(tool)).toBe(false);
		}
	});
});
