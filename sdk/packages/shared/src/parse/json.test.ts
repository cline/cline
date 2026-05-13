import { describe, expect, it } from "vitest";
import { parseJsonStream } from "./json";

describe("parseJsonStream", () => {
	it("repairs a bare object value into a JSON string", () => {
		const input =
			'{"commands": find /Users/beatrix/dev/sdk -name "user-instruction-config-loader.ts" -o -name "rules.ts" | head -20}';

		expect(parseJsonStream(input)).toEqual({
			commands:
				'find /Users/beatrix/dev/sdk -name "user-instruction-config-loader.ts" -o -name "rules.ts" | head -20',
		});
	});
});
