// Compiled into the executable as the plugin worker (script/compile-binary.ts).
// Plugin installs drop their @cline/* dependencies, so serve those imports
// from this build instead of expecting packages on disk beside the binary.
import { registerHostPluginModules } from "@cline/core/plugin-worker";

registerHostPluginModules({
	"@cline/sdk": () => require("@cline/core"),
	"@cline/core": () => require("@cline/core"),
	"@cline/core/hub": () => require("@cline/core/hub"),
	"@cline/core/telemetry": () => require("@cline/core/telemetry"),
	"@cline/agents": () => require("@cline/agents"),
	"@cline/llms": () => require("@cline/llms"),
	"@cline/shared": () => require("@cline/shared"),
	"@cline/shared/db": () => require("@cline/shared/db"),
	"@cline/shared/storage": () => require("@cline/shared/storage"),
});
