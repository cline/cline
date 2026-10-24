import type { RuntimeStatus } from "@/lib/sandbox/types";

type RuntimeSpec = {
	probe: string;
	label: string;
	packages: string[];
};

/**
 * Runtimes are detected, never assumed. The TypeScript and Python Daytona base
 * snapshots already contain their toolchains; compiled languages are installed
 * on demand with apt when the sandbox allows it. Failures are surfaced verbatim.
 */
const RUNTIMES: Record<string, RuntimeSpec> = {
	typescript: {
		probe: "node --version && npm --version",
		label: "Node.js",
		packages: ["nodejs", "npm"],
	},
	javascript: {
		probe: "node --version && npm --version",
		label: "Node.js",
		packages: ["nodejs", "npm"],
	},
	python: {
		probe: "python3 --version && pip3 --version",
		label: "Python 3",
		packages: ["python3", "python3-pip", "python3-venv"],
	},
	java: {
		probe: "javac -version && java -version",
		label: "OpenJDK",
		packages: ["default-jdk-headless"],
	},
	c: {
		probe: "gcc --version",
		label: "GCC",
		packages: ["build-essential"],
	},
	cpp: {
		probe: "g++ --version",
		label: "G++",
		packages: ["build-essential"],
	},
	go: {
		probe: "go version",
		label: "Go",
		packages: ["golang-go"],
	},
	rust: {
		probe: "rustc --version && cargo --version",
		label: "Rust",
		packages: ["rustc", "cargo"],
	},
	php: {
		probe: "php --version",
		label: "PHP",
		packages: ["php-cli"],
	},
	ruby: {
		probe: "ruby --version",
		label: "Ruby",
		packages: ["ruby-full"],
	},
	html: {
		probe: "node --version",
		label: "Node.js (static preview)",
		packages: ["nodejs", "npm"],
	},
	blank: {
		probe: "node --version",
		label: "Node.js",
		packages: ["nodejs", "npm"],
	},
};

export function runtimeSpec(language: string): RuntimeSpec {
	return RUNTIMES[language] ?? RUNTIMES.blank;
}

export function runtimeLabel(language: string): string {
	return runtimeSpec(language).label;
}

export function runtimeInstallCommand(language: string): string {
	const spec = runtimeSpec(language);
	const packages = spec.packages.join(" ");
	return [
		"set -e",
		"SUDO=''",
		"if [ \"$(id -u)\" -ne 0 ]; then SUDO='sudo -n'; fi",
		"$SUDO apt-get update -y",
		`$SUDO apt-get install -y ${packages}`,
		`echo "runtime installed: ${spec.label}"`,
	].join(" && ");
}

export function missingRuntimeStatus(language: string, detail: string): RuntimeStatus {
	return { language, ready: false, detail };
}
