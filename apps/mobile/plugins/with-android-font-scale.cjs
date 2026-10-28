const {
	withAndroidManifest,
	withMainActivity,
} = require("expo/config-plugins");

const MARKER =
	"// Cline: preserve the active conversation on system font changes.";
const HANDLER = `
  ${MARKER}
  override fun onConfigurationChanged(newConfig: android.content.res.Configuration) {
    super.onConfigurationChanged(newConfig)
    // RN updates native text metrics, but DeviceInfo caches the JS font scale
    // until resume. Publish it here as well when the activity stays mounted.
    (reactHost?.currentReactContext?.getNativeModule("DeviceInfo")
      as? com.facebook.react.bridge.LifecycleEventListener)?.onHostResume()
  }
`;

function applyFontScaleManifest(manifest) {
	const activity = manifest.manifest.application?.[0]?.activity?.find(
		(entry) => entry.$?.["android:name"] === ".MainActivity",
	);
	if (!activity) throw new Error("Cline MainActivity is missing.");
	const changes = new Set(
		(activity.$["android:configChanges"] ?? "").split("|").filter(Boolean),
	);
	changes.add("fontScale");
	activity.$["android:configChanges"] = [...changes].join("|");
	return manifest;
}

function applyFontScaleActivity(source) {
	if (source.includes(MARKER)) return source;
	if (source.includes("override fun onConfigurationChanged("))
		throw new Error(
			"Merge Cline font-scale handling into the existing activity callback.",
		);
	const start = /class MainActivity\s*:\s*ReactActivity\(\)\s*\{/;
	if (!start.test(source))
		throw new Error("Unsupported Cline MainActivity template.");
	return source.replace(start, (match) => `${match}\n${HANDLER}`);
}

function withAndroidFontScale(config) {
	config = withAndroidManifest(config, (mod) => {
		mod.modResults = applyFontScaleManifest(mod.modResults);
		return mod;
	});
	return withMainActivity(config, (mod) => {
		if (mod.modResults.language !== "kt")
			throw new Error(
				"Cline font-scale handling requires Kotlin MainActivity.",
			);
		mod.modResults.contents = applyFontScaleActivity(mod.modResults.contents);
		return mod;
	});
}

module.exports = withAndroidFontScale;
module.exports.applyFontScaleManifest = applyFontScaleManifest;
module.exports.applyFontScaleActivity = applyFontScaleActivity;
