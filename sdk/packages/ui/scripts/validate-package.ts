import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const packageRoot = join(import.meta.dir, "..");
const manifest = JSON.parse(
	readFileSync(join(packageRoot, "package.json"), "utf8"),
) as {
	exports?: Record<string, string | { import?: string; types?: string }>;
	files?: string[];
	internal?: boolean;
	license?: string;
	private?: boolean;
	publishConfig?: { access?: string };
	version?: string;
};

if (
	manifest.private !== false ||
	manifest.internal !== true ||
	manifest.publishConfig?.access !== "public" ||
	manifest.license !== "Apache-2.0" ||
	!manifest.version ||
	manifest.version === "0.0.0"
) {
	throw new Error(
		"package.json is not configured for standalone public npm publication",
	);
}

const componentExport = manifest.exports?.["./components/agent-chat"];
if (!componentExport || typeof componentExport === "string") {
	throw new Error("package.json is missing the agent-chat component export");
}

for (const [condition, target] of Object.entries(componentExport)) {
	if (!target || !existsSync(join(packageRoot, target))) {
		throw new Error(
			`agent-chat ${condition} export is missing or invalid: ${target}`,
		);
	}
}

const cssExport = manifest.exports?.["./components/agent-chat.css"];
if (
	typeof cssExport !== "string" ||
	!existsSync(join(packageRoot, cssExport))
) {
	throw new Error("package.json is missing the agent-chat CSS export");
}

const componentSource = readFileSync(
	join(packageRoot, "components", "agent-chat", "index.tsx"),
	"utf8",
);
for (const forbiddenImport of ["@/", "@cline/core", 'from "ai"']) {
	if (componentSource.includes(forbiddenImport)) {
		throw new Error(
			`agent-chat components must not import consumer runtime ${forbiddenImport}`,
		);
	}
}

const componentStyles = readFileSync(
	join(packageRoot, "components", "agent-chat", "agent-chat.css"),
	"utf8",
);
if (/@(?:apply|custom-variant|theme)\b/.test(componentStyles)) {
	throw new Error("agent-chat.css must remain framework-neutral");
}

for (const requiredFile of [
	"components",
	"dist",
	"theme",
	"ADOPTION.md",
	"README.md",
]) {
	if (!manifest.files?.includes(requiredFile)) {
		throw new Error(`package files list must include ${requiredFile}`);
	}
}

console.log("@cline/ui package exports and publication metadata are valid");
