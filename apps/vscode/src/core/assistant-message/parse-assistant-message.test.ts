import { expect } from "chai";
import { describe, it } from "mocha";
import { parseAssistantMessageV2 } from "./parse-assistant-message";

describe("parseAssistantMessageV2", () => {
	it("detects a truncated tool opening tag", () => {
		const result = parseAssistantMessageV2("Let me run that.\n<execute_c");

		expect(result).to.have.length(2);
		expect(result[0]).to.deep.include({
			type: "text",
			content: "Let me run that.",
			partial: true,
		});
		expect(result[1]).to.deep.include({
			type: "tool_use",
			partial: true,
			isTruncatedOpenTag: true,
		});
	});

	it("keeps ordinary partial tool uses distinct from truncated opening tags", () => {
		const result = parseAssistantMessageV2(
			"Some text <execute_command><command>ls</command>",
		);

		expect(result).to.have.length(2);
		expect(result[0]).to.deep.include({
			type: "text",
			content: "Some text",
			partial: false,
		});
		expect(result[1]).to.deep.include({
			type: "tool_use",
			name: "execute_command",
			partial: true,
		});
		expect(result[1]).to.not.have.property("isTruncatedOpenTag");
	});
});
