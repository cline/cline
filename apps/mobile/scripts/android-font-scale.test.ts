import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
	applyFontScaleManifest,
	applyFontScaleActivity,
} = require("../plugins/with-android-font-scale.cjs");

describe("Android live font-scale lifecycle", () => {
	it("preserves the other activity flags and is safe to prebuild repeatedly", () => {
		const manifest = {
			manifest: {
				application: [
					{
						activity: [
							{
								$: {
									"android:name": ".MainActivity",
									"android:configChanges": "keyboard|orientation|uiMode",
								},
							},
						],
					},
				],
			},
		};
		applyFontScaleManifest(manifest);
		applyFontScaleManifest(manifest);
		expect(
			manifest.manifest.application[0].activity[0].$["android:configChanges"],
		).toBe("keyboard|orientation|uiMode|fontScale");
	});

	it("retains existing native lifecycle code and publishes the updated JS font scale once", () => {
		const original =
			"class MainActivity : ReactActivity() {\n override fun onCreate(state: Bundle?) { super.onCreate(null) }\n}";
		const modified = applyFontScaleActivity(original);
		expect(modified).toContain("super.onCreate(null)");
		expect(modified).toContain("super.onConfigurationChanged(newConfig)");
		expect(modified).toContain('getNativeModule("DeviceInfo")');
		expect(modified).toContain("?.onHostResume()");
		expect(applyFontScaleActivity(modified)).toBe(modified);
	});

	it("requires an explicit merge rather than overwriting another configuration callback", () => {
		expect(() =>
			applyFontScaleActivity(
				"class MainActivity : ReactActivity() { override fun onConfigurationChanged(x: Configuration) {} }",
			),
		).toThrow("Merge Cline font-scale handling");
	});
});
