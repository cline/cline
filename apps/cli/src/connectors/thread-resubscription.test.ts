import { describe, expect, it } from "vitest";

import { collectThreadKeysToResubscribe } from "./thread-resubscription";

describe("collectThreadKeysToResubscribe", () => {
	it("picks the group conversations this connector serves", () => {
		const keys = collectThreadKeysToResubscribe({
			"telegram:-100:49": {
				kind: "conversation",
				isDM: false,
				serializedThread: "{}",
			},
			"telegram:-100:186": {
				kind: "conversation",
				isDM: false,
				serializedThread: "{}",
			},
		});
		expect(keys).toEqual(["telegram:-100:49", "telegram:-100:186"]);
	});

	it("leaves direct messages alone", () => {
		// They arrive without a subscription, so re-subscribing them would be noise.
		expect(
			collectThreadKeysToResubscribe({
				"telegram:946217355": {
					kind: "conversation",
					isDM: true,
					serializedThread: "{}",
				},
			}),
		).toEqual([]);
	});

	it("skips bookkeeping rows that are not a conversation to join", () => {
		expect(
			collectThreadKeysToResubscribe({
				"telegram:-100:49": {
					kind: "thread-participant-mute",
					isDM: false,
					serializedThread: "{}",
				},
				"telegram:-100:50": {
					kind: "participant",
					isDM: false,
					serializedThread: "{}",
				},
			}),
		).toEqual([]);
	});

	it("skips a row with no thread to deserialize", () => {
		expect(
			collectThreadKeysToResubscribe({
				"telegram:-100:49": { kind: "conversation", isDM: false },
			}),
		).toEqual([]);
	});

	it("skips a row that does not say whether it is a direct message", () => {
		// Guessing wrong either way is worse than skipping: subscribing a DM is noise, and
		// treating a group as a DM leaves the very gap this exists to close.
		expect(
			collectThreadKeysToResubscribe({
				"telegram:-100:49": { kind: "conversation", serializedThread: "{}" },
			}),
		).toEqual([]);
	});
});
