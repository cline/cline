import { describe, expect, it } from "vitest";
import { getMcpManagerEntryStatus } from "../../views/config-view-helpers";
import { getMcpManagerFooterText } from "./mcp-manager";

describe("mcp manager dialog helpers", () => {
	it("keeps the footer focused on toggling", () => {
		expect(getMcpManagerFooterText(true)).toBe(
			"Space toggle selected, Esc to go back",
		);
		expect(getMcpManagerFooterText(true)).not.toContain("delete");
		expect(getMcpManagerFooterText(false)).toBe("Esc to go back");
	});

	it("shows OAuth errors before general MCP status", () => {
		expect(
			getMcpManagerEntryStatus({
				description: "streamableHttp, oauth authorized",
			}),
		).toBe("streamableHttp, oauth authorized");
		expect(
			getMcpManagerEntryStatus({
				description: "streamableHttp, oauth authorized",
				lastError: "OAuth authorization failed",
			}),
		).toBe("oauth error");
	});
});
