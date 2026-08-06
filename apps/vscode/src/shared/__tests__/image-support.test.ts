import { expect } from "chai";
import type { ClineStorageMessage } from "../messages/content";
import {
	IMAGE_UNSUPPORTED_PLACEHOLDER,
	prepareMessagesForImageSupport,
} from "../messages/image-support";

describe("prepareMessagesForImageSupport", () => {
	const image = {
		type: "image" as const,
		source: {
			type: "base64" as const,
			media_type: "image/png" as const,
			data: "secret-base64",
		},
	};

	it("substitutes direct and tool-result images without mutating history", () => {
		const history: ClineStorageMessage[] = [
			{ role: "user", content: [{ type: "text", text: "inspect" }, image] },
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "tool-1",
						content: [{ type: "text", text: "read image" }, image],
					},
				],
			},
		];
		const original = JSON.stringify(history);

		const request = prepareMessagesForImageSupport(history, false);
		const serialized = JSON.stringify(request);

		expect(serialized).to.contain(IMAGE_UNSUPPORTED_PLACEHOLDER);
		expect(serialized).not.to.contain("secret-base64");
		expect(serialized).not.to.contain('"type":"image"');
		expect(JSON.stringify(history)).to.equal(original);
	});

	it("treats missing legacy metadata as unsupported", () => {
		const request = prepareMessagesForImageSupport(
			[{ role: "user", content: [image] }],
			undefined,
		);
		expect(JSON.stringify(request)).to.contain(IMAGE_UNSUPPORTED_PLACEHOLDER);
	});

	it("returns the original history for image-capable models", () => {
		const history: ClineStorageMessage[] = [{ role: "user", content: [image] }];
		expect(prepareMessagesForImageSupport(history, true)).to.equal(history);
	});
});
