import { describe, expect, it } from "vitest";
import { assertValidPluginSetupCtx } from "./plugin-sandbox-validation";

describe("assertValidPluginSetupCtx", () => {
	const update = () => {};

	it("accepts a context without ui, and a well-formed ui", () => {
		expect(() => assertValidPluginSetupCtx({})).not.toThrow();
		expect(() =>
			assertValidPluginSetupCtx({
				ui: { slots: ["composer.suggestions"], update },
			}),
		).not.toThrow();
	});

	it("rejects a malformed ui", () => {
		expect(() =>
			assertValidPluginSetupCtx({ ui: "composer.suggestions" }),
		).toThrow("Plugin setup context ui must be an object");
		expect(() =>
			assertValidPluginSetupCtx({
				ui: { slots: "composer.suggestions", update },
			}),
		).toThrow("Plugin setup context ui.slots must be a string array");
		expect(() =>
			assertValidPluginSetupCtx({
				ui: { slots: ["composer.suggestions", 1], update },
			}),
		).toThrow("Plugin setup context ui.slots must be a string array");
		expect(() =>
			assertValidPluginSetupCtx({ ui: { slots: ["composer.suggestions"] } }),
		).toThrow("Plugin setup context ui.update must be a function");
	});

	it("keeps rejecting the fields it checked before", () => {
		expect(() => assertValidPluginSetupCtx(null)).toThrow(
			"Plugin setup context must be an object",
		);
		expect(() =>
			assertValidPluginSetupCtx({ automation: { ingestEvent: "no" } }),
		).toThrow("Plugin setup context automation.ingestEvent must be a function");
	});
});
