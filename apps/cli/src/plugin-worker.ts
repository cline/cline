// Compiled into the executable as the plugin worker (script/compile-binary.ts).
// Plugin installs drop their @cline/* dependencies, so serve those imports
// from this build instead of expecting packages on disk beside the binary.
// Mirrors the packages' public exports, minus the Hub daemon entry and this
// worker itself, which must never load inside a plugin.
import { registerHostPluginModules } from "@cline/core/plugin-worker";

registerHostPluginModules({
	"@cline/sdk": () => import("@cline/core"),
	"@cline/core": () => import("@cline/core"),
	"@cline/core/cloud": () => import("@cline/core/cloud"),
	"@cline/core/hub": () => import("@cline/core/hub"),
	"@cline/core/services/feature-flags/posthog": () =>
		import("@cline/core/services/feature-flags/posthog"),
	"@cline/core/telemetry": () => import("@cline/core/telemetry"),
	"@cline/agents": () => import("@cline/agents"),
	"@cline/llms": () => import("@cline/llms"),
	"@cline/llms/browser": () => import("@cline/llms/browser"),
	"@cline/shared": () => import("@cline/shared"),
	"@cline/shared/automation": () => import("@cline/shared/automation"),
	"@cline/shared/browser": () => import("@cline/shared/browser"),
	"@cline/shared/db": () => import("@cline/shared/db"),
	"@cline/shared/node": () => import("@cline/shared/node"),
	"@cline/shared/remote-config": () => import("@cline/shared/remote-config"),
	"@cline/shared/storage": () => import("@cline/shared/storage"),
	"@cline/shared/types": () => import("@cline/shared/types"),
});
