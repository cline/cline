import {
	type McpInstallOptions as CoreMcpInstallOptions,
	installMcpServer,
	type McpInstallResult,
	type McpServerTransportConfig,
} from "@cline/core";
import type { McpAddDefaults } from "../wizards/mcp";

export { buildMcpInstallTransport } from "@cline/core";

export interface McpCommandIo {
	writeln?: (text: string) => void;
	writeErr: (text: string) => void;
}

export interface McpInstallOptions extends CoreMcpInstallOptions {
	io?: McpCommandIo;
	isTty?: boolean;
	json?: boolean;
	runWizard?: (defaults: McpAddDefaults) => Promise<number>;
	yes?: boolean;
}

export interface McpInstallDirectResult {
	name: string;
	status: "installed";
	transport: McpServerTransportConfig;
	warnings: string[];
}

function normalizeTransportType(
	value: string | undefined,
): McpServerTransportConfig["type"] {
	const normalized = (value ?? "stdio").trim();
	if (normalized === "http" || normalized === "streamable-http") {
		return "streamableHttp";
	}
	if (
		normalized === "stdio" ||
		normalized === "sse" ||
		normalized === "streamableHttp"
	) {
		return normalized;
	}
	throw new Error(
		`Unsupported MCP transport "${normalized}". Expected stdio, sse, http, streamable-http, or streamableHttp.`,
	);
}

function assertValidUrl(url: string): void {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		throw new Error(`Invalid MCP server URL: ${url}`);
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		throw new Error(
			`Invalid MCP server URL: ${url} (only http and https are supported)`,
		);
	}
}

function quoteCommandArg(arg: string): string {
	if (/^[^\s"'\\]+$/.test(arg)) {
		return arg;
	}
	return `"${arg.replace(/(["\\])/g, "\\$1")}"`;
}

export function buildMcpInstallDefaults(options: {
	name: string;
	targetArgs?: string[];
	transport?: string;
}): McpAddDefaults {
	const name = options.name.trim();
	if (!name) {
		throw new Error("MCP server name is required");
	}
	const type = normalizeTransportType(options.transport);
	const targetArgs = options.targetArgs ?? [];
	if (type === "stdio") {
		if (targetArgs.length === 0) {
			throw new Error(
				"Stdio MCP install requires a command after the server name, for example: cline mcp install fs -- npx -y @modelcontextprotocol/server-filesystem /tmp",
			);
		}
		return {
			name,
			type,
			command: targetArgs.map(quoteCommandArg).join(" "),
		};
	}

	if (targetArgs.length !== 1) {
		throw new Error(
			"Remote MCP install requires exactly one URL argument after the server name.",
		);
	}
	const url = targetArgs[0]?.trim() ?? "";
	assertValidUrl(url);
	return {
		name,
		type,
		url,
	};
}

export function installMcpServerDirect(
	options: McpInstallOptions,
): McpInstallDirectResult {
	const result: McpInstallResult = installMcpServer(options);
	return {
		name: result.name,
		status: result.status,
		transport: result.transport,
		warnings: result.warnings,
	};
}

async function runPrefilledWizard(defaults: McpAddDefaults): Promise<number> {
	const { runMcpWizard } = await import("../wizards/mcp");
	return runMcpWizard({
		initialAction: "add",
		addDefaults: defaults,
		exitAfterInitialAction: true,
	});
}

export async function runMcpInstallCommand(
	options: McpInstallOptions,
): Promise<number> {
	try {
		if (options.yes) {
			const result = installMcpServerDirect(options);
			if (options.json) {
				options.io?.writeln?.(JSON.stringify(result));
			} else {
				options.io?.writeln?.(`Installed MCP server ${result.name}.`);
				for (const warning of result.warnings) {
					options.io?.writeErr(warning);
				}
			}
			return 0;
		}
		const isTty =
			options.isTty ?? (process.stdin.isTTY && process.stdout.isTTY);
		if (!isTty) {
			throw new Error(
				"cline mcp install opens the MCP wizard and requires a TTY. Pass --yes to install noninteractively.",
			);
		}
		const defaults = buildMcpInstallDefaults(options);
		return await (options.runWizard ?? runPrefilledWizard)(defaults);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		options.io?.writeErr(message);
		return 1;
	}
}
