import { describe, expect, it } from "vitest";
import { PLATFORMS } from "./platforms";

describe("connect wizard platform security fields", () => {
	it("rejects unsafe Telegram and Slack access restriction identifiers", () => {
		const telegram = PLATFORMS.find((platform) => platform.id === "telegram");
		const slack = PLATFORMS.find((platform) => platform.id === "slack");

		const telegramUser = telegram?.security?.fields.find(
			(field) => field.key === "userId",
		);
		const slackTeam = slack?.security?.fields.find(
			(field) => field.key === "teamId",
		);
		const slackUser = slack?.security?.fields.find(
			(field) => field.key === "userId",
		);

		expect(telegramUser?.validate?.("123456")).toBeUndefined();
		expect(telegramUser?.validate?.("123; rm -rf /")).toContain("digits");
		expect(slackTeam?.validate?.("T01ABC123")).toBeUndefined();
		expect(slackTeam?.validate?.("T01;bad")).toContain("Slack workspace");
		expect(slackUser?.validate?.("U01ABC123")).toBeUndefined();
		expect(slackUser?.validate?.("U01$(bad)")).toContain("Slack member");
	});
});
