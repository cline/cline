// Compiled into the executable as the plugin worker (script/compile-binary.ts).
// Plugin installs drop their @cline/* dependencies, so serve those imports
// from this build instead of expecting packages on disk beside the binary.
import { registerHostPluginModules } from "@cline/core/plugin-worker";

registerHostPluginModules({
	"@cline/sdk": () => import("@cline/core"),
	"@cline/core": () => import("@cline/core"),
	"@cline/core/hub": () => import("@cline/core/hub"),
	"@cline/core/telemetry": () => import("@cline/core/telemetry"),
	"@cline/shared": () => import("@cline/shared"),
	"@cline/shared/db": () => import("@cline/shared/db"),
	"@cline/shared/storage": () => import("@cline/shared/storage"),
});
