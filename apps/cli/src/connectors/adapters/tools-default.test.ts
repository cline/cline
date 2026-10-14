import { describe, expect, it } from "vitest";
import { discordConnector } from "./discord";
import { gchatConnector } from "./gchat";
import { linearConnector } from "./linear";
import { slackConnector } from "./slack";
import { telegramConnector } from "./telegram";
import { whatsappConnector } from "./whatsapp";

/**
 * Every connector runs with tools enabled unless the operator opts out, so this
 * has to hold for all of them at once rather than per adapter — the whole point
 * is that there is no adapter where the default is different.
 */
const connectors: Array<{
	name: string;
	connector: unknown;
	/** Minimal arguments that parse for this adapter. */
	baseArgs: string[];
}> = [
	{
		name: "slack",
		connector: slackConnector,
		baseArgs: ["--user-name", "bot"],
	},
	{
		name: "discord",
		connector: discordConnector,
		baseArgs: ["--application-id", "app-1", "--bot-token", "token"],
	},
	{
		name: "linear",
		connector: linearConnector,
		baseArgs: [
			"--user-name",
			"bot",
			"--api-key",
			"key",
			"--webhook-secret",
			"secret",
		],
	},
	{
		name: "gchat",
		connector: gchatConnector,
		baseArgs: ["--user-name", "bot"],
	},
	{
		name: "whatsapp",
		connector: whatsappConnector,
		baseArgs: ["--user-name", "bot", "--phone-number-id", "123"],
	},
	{
		name: "telegram",
		connector: telegramConnector,
		baseArgs: ["--bot-token", "123:token"],
	},
];

function parse(
	connector: unknown,
	rawArgs: string[],
): { enableTools: boolean } {
	return (
		connector as {
			parseArgs(rawArgs: string[]): { enableTools: boolean };
		}
	).parseArgs(rawArgs);
}

describe("connector tools default", () => {
	for (const { name, connector, baseArgs } of connectors) {
		it(`${name}: enables tools when nothing is passed`, () => {
			expect(parse(connector, baseArgs).enableTools).toBe(true);
		});

		it(`${name}: disables tools with --no-tools`, () => {
			expect(parse(connector, [...baseArgs, "--no-tools"]).enableTools).toBe(
				false,
			);
		});

		it(`${name}: an explicit --no-tools beats --enable-tools`, () => {
			// Ambiguous input resolves to the safer answer.
			expect(
				parse(connector, [...baseArgs, "--enable-tools", "--no-tools"])
					.enableTools,
			).toBe(false);
		});
	}

	it("keeps accepting --enable-tools so existing invocations still parse", () => {
		// Persisted autostart arguments and deployed scripts carry this flag; it is
		// redundant now but must not become an unknown-option error.
		for (const { connector, baseArgs } of connectors) {
			expect(
				parse(connector, [...baseArgs, "--enable-tools"]).enableTools,
			).toBe(true);
		}
	});
});
