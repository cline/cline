import { describe, expect, it } from "vitest";
import { checkScheduleDelivery } from "./schedule-delivery";

describe("checkScheduleDelivery", () => {
	it.each([
		{ adapter: "telegram", threadId: "telegram:1" },
		{ adapter: "slack", bindingKey: "C1" },
		{ adapter: "discord", participantKey: "discord:user:1", label: "x" },
	])("accepts a delivery a connector can post: %j", (delivery) => {
		expect(checkScheduleDelivery(delivery)).toEqual([]);
	});

	it.each([
		null,
		"telegram",
		["telegram"],
		1,
	])("rejects %j, which isn't an object", (delivery) => {
		expect(checkScheduleDelivery(delivery)).toEqual([
			{ kind: "notObject", field: "delivery" },
		]);
	});

	it("reports a missing adapter and a missing chat together", () => {
		expect(checkScheduleDelivery({ userName: "my_bot" })).toEqual([
			{ kind: "missingAdapter", field: "adapter" },
			{ kind: "missingTarget", field: "threadId" },
		]);
	});

	it("treats null and blank strings as unset, as the connectors do", () => {
		expect(
			checkScheduleDelivery({ adapter: " ", threadId: null, bindingKey: "" }),
		).toEqual([
			{ kind: "missingAdapter", field: "adapter" },
			{ kind: "missingTarget", field: "threadId" },
		]);
	});

	it("rejects an adapter no connector answers to, matching names exactly", () => {
		expect(
			checkScheduleDelivery({ adapter: "Telegram", threadId: "telegram:1" }),
		).toEqual([
			{ kind: "unknownAdapter", field: "adapter", value: "Telegram" },
		]);
	});

	it("reports a field of the wrong type once, not also as missing", () => {
		expect(checkScheduleDelivery({ adapter: 7, threadId: 8 })).toEqual([
			{ kind: "notString", field: "adapter" },
			{ kind: "notString", field: "threadId" },
		]);
	});
});
