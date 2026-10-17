import { describe, expect, test } from "bun:test";
import { sourceOff } from "../context/policy";
import { defaultSettings } from "../settings/settings";
import { connectorAccess } from "./access";
import { settingsWith } from "./github/github.fixtures";

describe("access and the provider rule", () => {
	test("Mention by default once detected, Off when not; Read needs scopes and the chat's own provider", () => {
		expect(
			connectorAccess(defaultSettings(), "github", true, "anthropic"),
		).toEqual({ role: "mention", scopes: [], readAllowed: false });
		expect(
			connectorAccess(
				settingsWith("read", ["pr"]),
				"github",
				false,
				"anthropic",
			).role,
		).toBe("off");
		expect(
			connectorAccess(settingsWith("read", []), "github", true, "anthropic")
				.readAllowed,
		).toBe(false);
		expect(
			connectorAccess(settingsWith("read", ["pr"]), "github", true, "anthropic")
				.readAllowed,
		).toBe(true);
		const otherModel = settingsWith("read", ["pr"]);
		otherModel.planner.model = {
			kind: "model",
			providerId: "openai",
			modelId: "fast",
		};
		expect(connectorAccess(otherModel, "github", true, "anthropic")).toEqual({
			role: "read",
			scopes: ["pr"],
			readAllowed: false,
		});
		const chosen = defaultSettings();
		chosen.connectors["composio:gmail"] = { role: "mention", scopes: [] };
		expect(
			connectorAccess(defaultSettings(), "composio:gmail", true, "anthropic")
				.role,
		).toBe("off");
		expect(
			connectorAccess(chosen, "composio:gmail", true, "anthropic").role,
		).toBe("mention");
		expect(sourceOff(settingsWith("off"), {})({ id: "github" })).toBe(true);
	});
});
