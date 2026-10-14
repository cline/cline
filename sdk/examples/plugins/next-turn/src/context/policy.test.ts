import { describe, expect, test } from "bun:test";
import { emptyFold } from "../hub/fold";
import { HubLink } from "../hub/link";
import { defaultSettings } from "../settings/settings";
import { sourceOff } from "./policy";
import { ClineSetupSource } from "./sources/cline-setup";
import { historySource } from "./sources/history";
import { clineSources } from "./sources/index";
import { gitSource } from "./sources/workspace";

const link = new HubLink({
	resolveEndpoint: async () => undefined,
	createClient: () => {
		throw new Error("never connects");
	},
	sleep: async () => {},
});

describe("source policy", () => {
	test("history is off when the planner would send it to another provider, or when the person turned it off", () => {
		const settings = defaultSettings();
		const history = historySource(link, emptyFold);
		expect(sourceOff(settings, { providerId: "anthropic" })(history)).toBe(
			false,
		);
		settings.planner.model = {
			kind: "model",
			providerId: "openai",
			modelId: "fast",
		};
		expect(sourceOff(settings, { providerId: "anthropic" })(history)).toBe(
			true,
		);
		expect(sourceOff(settings, { providerId: "openai" })(history)).toBe(false);
		settings.context.clineSetup = false;
		expect(sourceOff(settings, {})(new ClineSetupSource(link))).toBe(true);
		expect(sourceOff(settings, {})(gitSource)).toBe(false);
	});

	test("every context setting turns off one of the Cline-first sources", () => {
		const cline = clineSources(link, emptyFold, {});
		const toggled: string[] = cline.sources.flatMap(
			(source) => source.settingsToggle ?? [],
		);
		cline.stop();
		expect(toggled.sort()).toEqual(
			Object.keys(defaultSettings().context).sort(),
		);
	});
});
