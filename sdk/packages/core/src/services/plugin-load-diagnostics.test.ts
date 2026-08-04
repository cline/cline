import { afterEach, describe, expect, it } from "vitest";
import {
	clearPluginLoadReport,
	getLatestPluginLoadReport,
	recordPluginLoadReport,
} from "./plugin-load-diagnostics";

describe("plugin load diagnostics", () => {
	afterEach(() => {
		clearPluginLoadReport();
	});

	it("reports nothing until a session has loaded plugins", () => {
		expect(getLatestPluginLoadReport()).toBeUndefined();
	});

	it("keeps only the most recent report", () => {
		recordPluginLoadReport({
			pluginPaths: ["/a.ts"],
			failures: [{ pluginPath: "/a.ts", phase: "load", message: "first" }],
			warnings: [],
		});
		recordPluginLoadReport({
			pluginPaths: ["/b.ts"],
			failures: [],
			warnings: [],
		});

		const report = getLatestPluginLoadReport();
		expect(report?.pluginPaths).toEqual(["/b.ts"]);
		expect(report?.failures).toEqual([]);
	});

	it("hands out copies so a reader cannot disturb the stored report", () => {
		recordPluginLoadReport({
			pluginPaths: ["/a.ts"],
			failures: [{ pluginPath: "/a.ts", phase: "load", message: "boom" }],
			warnings: [],
		});

		getLatestPluginLoadReport()?.failures.pop();

		expect(getLatestPluginLoadReport()?.failures).toHaveLength(1);
	});
});
