import { describe, expect, it } from "vitest";
import { PLATFORMS } from "./platforms";

describe("connect wizard platform security fields", () => {
	it("does not ask Telegram users to re-enter the bot username", () => {
		const telegram = PLATFORMS.find((platform) => platform.id === "telegram");

		expect(telegram?.fields.map((field) => field.label)).toEqual(["Bot token"]);
		expect(telegram?.fields.map((field) => field.flag)).toEqual(["-k"]);
	});

	it("rejects unsafe Telegram and Slack access restriction identifiers", () => {
		const agentphone = PLATFORMS.find(
			(platform) => platform.id === "agentphone",
		);
		const telegram = PLATFORMS.find((platform) => platform.id === "telegram");
		const slack = PLATFORMS.find((platform) => platform.id === "slack");

		const agentphoneParticipant = agentphone?.security?.fields.find(
			(field) => field.key === "participant",
		);
		const telegramUser = telegram?.security?.fields.find(
			(field) => field.key === "userId",
		);
		const slackTeam = slack?.security?.fields.find(
			(field) => field.key === "teamId",
		);
		const slackUser = slack?.security?.fields.find(
			(field) => field.key === "userId",
		);

		expect(agentphoneParticipant?.validate?.("+15551234567")).toBeUndefined();
		expect(
			agentphoneParticipant?.validate?.("alice@example.com"),
		).toBeUndefined();
		expect(agentphoneParticipant?.validate?.("alice; rm -rf /")).toContain(
			"AgentPhone participant",
		);
		expect(telegramUser?.validate?.("123456")).toBeUndefined();
		expect(telegramUser?.validate?.("123; rm -rf /")).toContain("digits");
		expect(slackTeam?.validate?.("T01ABC123")).toBeUndefined();
		expect(slackTeam?.validate?.("T01;bad")).toContain("Slack workspace");
		expect(slackUser?.validate?.("U01ABC123")).toBeUndefined();
		expect(slackUser?.validate?.("U01$(bad)")).toContain("Slack member");
	});
});
