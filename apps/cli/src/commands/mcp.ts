import {
	buildMcpInstallTransport as buildCoreMcpInstallTransport,
	type McpInstallOptions as CoreMcpInstallOptions,
	type McpUninstallOptions as CoreMcpUninstallOptions,
	type McpUninstallResult as CoreMcpUninstallResult,
	installMcpServer,
	type McpInstallResult,
	type McpServerTransportConfig,
	uninstallMcpServer,
} from "@cline/core";
import type { McpAddDefaults } from "../wizards/mcp";

export { buildMcpInstallTransport, uninstallMcpServer } from "@cline/core";

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
	const { name, transport } = buildCoreMcpInstallTransport(options);
	if (transport.type === "stdio") {
		return {
			name,
			type: transport.type,
			command: [transport.command, ...(transport.args ?? [])]
				.map(quoteCommandArg)
				.join(" "),
		};
	}
	return {
		name,
		type: transport.type,
		url: transport.url,
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

export interface McpUninstallOptions extends CoreMcpUninstallOptions {
	io?: McpCommandIo;
	json?: boolean;
}

export interface McpUninstallDirectResult extends CoreMcpUninstallResult {}

export function uninstallMcpServerDirect(
	options: McpUninstallOptions,
): McpUninstallDirectResult {
	const result: CoreMcpUninstallResult = uninstallMcpServer(options);
	return {
		name: result.name,
		status: result.status,
	};
}

export async function runMcpUninstallCommand(
	options: McpUninstallOptions,
): Promise<number> {
	try {
		const name = options.name?.trim() ?? "";
		if (!name) {
			throw new Error("MCP server name is required");
		}
		const result = uninstallMcpServerDirect({ ...options, name });
		if (options.json) {
			options.io?.writeln?.(JSON.stringify(result));
		} else {
			options.io?.writeln?.(`Uninstalled MCP server ${result.name}.`);
		}
		return 0;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		options.io?.writeErr(message);
		return 1;
	}
}
