import { describe, expect, it } from "vitest";
import { PLATFORMS, shouldIncludeField } from "./platforms";

describe("connect wizard platform security fields", () => {
	it("does not ask Telegram users to re-enter the bot username", () => {
		const telegram = PLATFORMS.find((platform) => platform.id === "telegram");

		expect(telegram?.fields.map((field) => field.label)).toEqual(["Bot token"]);
		expect(telegram?.fields.map((field) => field.flag)).toEqual(["-k"]);
	});

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

	it("asks Slack users for mode-specific setup fields", () => {
		const slack = PLATFORMS.find((platform) => platform.id === "slack");
		const fields = slack?.fields ?? [];
		const webhookValues = { "--base-url": "https://example.test" };
		const socketValues = { "--base-url": "" };

		expect(fields.map((field) => field.flag)).toEqual([
			"--bot-token",
			"--base-url",
			"--signing-secret",
			"--app-token",
		]);
		expect(
			fields
				.filter((field) => shouldIncludeField(field, webhookValues))
				.map((field) => field.flag),
		).toEqual(["--bot-token", "--base-url", "--signing-secret"]);
		expect(
			fields
				.filter((field) => shouldIncludeField(field, socketValues))
				.map((field) => field.flag),
		).toEqual(["--bot-token", "--base-url", "--app-token"]);
	});
});
