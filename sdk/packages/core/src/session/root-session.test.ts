import { describe, expect, it } from "vitest";
import { isRootSessionRow } from "../cloud/snapshots";
import { isRootSessionRecord } from "./root-session";

describe("root session classification", () => {
	it.each([
		{ isSubagent: true },
		{ metadata: { isSubagent: true } },
		{ parentSessionId: " parent " },
		{ metadata: { parentSessionId: " parent " } },
		{ parentSessionId: "parent", metadata: { parentSessionId: "" } },
		{ parentSessionId: "", metadata: { parentSessionId: "parent" } },
		{ isSubagent: false, metadata: { isSubagent: true } },
		{ isSubagent: true, metadata: { isSubagent: false } },
	])("excludes a child marked by %j in both paths", (row) => {
		expect(isRootSessionRecord(row)).toBe(false);
		expect(isRootSessionRow(row)).toBe(false);
	});
	it.each([
		{},
		{ metadata: null },
		{
			isSubagent: false,
			parentSessionId: " ",
			metadata: { parentSessionId: "" },
		},
	])("accepts a root %j", (row) => {
		expect(isRootSessionRecord(row)).toBe(true);
		expect(isRootSessionRow(row)).toBe(true);
	});
});
