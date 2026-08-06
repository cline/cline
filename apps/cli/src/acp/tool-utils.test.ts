import { describe, expect, it } from "vitest";
import { mapToolKind } from "./tool-utils";

describe("mapToolKind", () => {
	it("maps known file-edit tools to edit", () => {
		expect(mapToolKind("Edit")).toBe("edit");
		expect(mapToolKind("Write")).toBe("edit");
		expect(mapToolKind("editor")).toBe("edit");
		expect(mapToolKind("apply_patch")).toBe("edit");
	});

	it("falls back to other for unmapped tool names", () => {
		expect(mapToolKind("some_unknown_tool")).toBe("other");
	});
});
