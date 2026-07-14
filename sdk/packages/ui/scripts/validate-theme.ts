import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const packageRoot = join(import.meta.dir, "..");
const readThemeFile = (name: string) =>
	readFileSync(join(packageRoot, "theme", name), "utf8");

const tokens = readThemeFile("tokens.css");
const theme = readThemeFile("theme.css");
const base = readThemeFile("base.css");
const index = readThemeFile("index.css");
const manifest = JSON.parse(
	readFileSync(join(packageRoot, "package.json"), "utf8"),
) as { exports?: Record<string, string> };

const requiredTokens = [
	"--background",
	"--foreground",
	"--primary",
	"--border",
	"--font-sans",
	"--font-mono",
	"--font-weight-normal",
	"--text-xs",
	"--text-6xl",
	"--sidebar",
];

for (const token of requiredTokens) {
	if (!tokens.includes(`${token}:`)) {
		throw new Error(`tokens.css is missing ${token}`);
	}
}

if (
	tokens.includes("--cline-") ||
	theme.includes("--cline-") ||
	base.includes("--cline-")
) {
	throw new Error("theme contract must not expose --cline-* variables");
}
if (
	tokens.includes("@theme") ||
	tokens.includes("@apply") ||
	tokens.includes("@layer")
) {
	throw new Error("tokens.css must remain framework-neutral");
}
if (theme.includes("tokens.css") || !theme.includes("@theme inline")) {
	throw new Error(
		"theme.css must contain only the Tailwind mapping and variants",
	);
}
if (base.includes("#__next") || base.includes("@source")) {
	throw new Error("base.css must not contain consumer-specific shell policy");
}
if (
	!index.includes('@import "./tokens.css";') ||
	!index.includes('@import "./theme.css";') ||
	!index.includes('@import "./base.css";')
) {
	throw new Error("theme entry point must compose tokens, theme, and base CSS");
}
for (const subpath of [
	"./theme/index.css",
	"./theme/tokens.css",
	"./theme/theme.css",
	"./theme/base.css",
]) {
	const target = manifest.exports?.[subpath];
	if (!target || !existsSync(join(packageRoot, target))) {
		throw new Error(`package.json export ${subpath} is missing or invalid`);
	}
}

console.log("@cline/ui theme contract is valid");
