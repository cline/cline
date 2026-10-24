import { describe, expect, it } from "vitest";
import { scheduleMetadata } from "./delivery-input";

const flags = (values: Record<string, string>) => values;

describe("scheduleMetadata", () => {
	it("returns undefined when no input mentions metadata", () => {
		expect(scheduleMetadata({ flags: {} })).toBeUndefined();
	});

	it("keeps a stored delivery the edit doesn't touch, even one that can't be posted", () => {
		expect(
			scheduleMetadata({
				stored: { delivery: { adapter: "telegram" }, owner: "a" },
				metadata: { object: { owner: "b" }, label: "--metadata-json" },
			}),
		).toEqual({ delivery: { adapter: "telegram" }, owner: "b" });
	});

	it("checks a stored delivery once a flag changes it", () => {
		expect(() =>
			scheduleMetadata({
				stored: { delivery: { adapter: "telegram" } },
				flags: flags({ deliveryBot: "my_bot" }),
			}),
		).toThrow(
			"schedule delivery needs --delivery-thread <id>: send /whereami in the chat to get it",
		);
	});

	it("starts a new delivery from flags over a removed one", () => {
		expect(
			scheduleMetadata({
				stored: { delivery: null },
				flags: flags({
					deliveryAdapter: "telegram",
					deliveryThread: "telegram:1",
				}),
			}),
		).toEqual({ delivery: { adapter: "telegram", threadId: "telegram:1" } });
	});

	it("names a stored field the flags don't set by its metadata path", () => {
		expect(() =>
			scheduleMetadata({
				stored: { delivery: { adapter: "telegram", bindingKey: 7 } },
				flags: flags({ deliveryBot: "my_bot" }),
			}),
		).toThrow("metadata delivery.bindingKey must be a string");
	});

	it("reports a stored delivery that isn't an object, which flags can't fix", () => {
		expect(() =>
			scheduleMetadata({
				stored: { delivery: "telegram" },
				flags: flags({ deliveryThread: "telegram:1" }),
			}),
		).toThrow(
			"metadata delivery must be an object, or null to remove the delivery",
		);
	});
});
