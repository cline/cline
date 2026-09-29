import * as p from "@clack/prompts";
import {
	cancelComposioConnect,
	connectComposioToolkit,
	getComposioStatus,
	listComposioToolkits,
	parseComposioToolkitSlug,
} from "@cline/core";
import { Command } from "commander";
import open from "open";

type ConnectorIo = {
	writeln: (text: string) => void;
	writeErr: (text: string) => void;
};
const unavailable =
	"Sign in with cline auth to use connectors. Connectors must be enabled for your Cline account.";

export async function runInstalledConnectorsCommand(
	json: boolean,
	io: ConnectorIo,
): Promise<number> {
	try {
		const status = await getComposioStatus({ refresh: true });
		if (!status.configured) throw new Error(unavailable);
		const installed = status.integrations.filter(
			(entry) => entry.status === "connected",
		);
		if (json) io.writeln(JSON.stringify(installed));
		else {
			io.writeln(
				installed.length
					? "Installed connectors:"
					: "No connectors installed. Run cline connector list to browse the marketplace.",
			);
			for (const entry of installed)
				io.writeln(
					`  ${entry.name} (${entry.toolkit}) — ${entry.toolNames?.length ?? 0} tools${entry.error ? ` — ${entry.error}` : ""}`,
				);
		}
		return 0;
	} catch (error) {
		io.writeErr(error instanceof Error ? error.message : String(error));
		return 1;
	}
}

export async function installConnector(
	slug: string,
	io: ConnectorIo,
	json = false,
): Promise<void> {
	const toolkit = parseComposioToolkitSlug(slug);
	let cancelled = false;
	const interrupt = () => {
		cancelled = true;
	};
	process.on("SIGINT", interrupt);
	try {
		const result = await connectComposioToolkit(toolkit);
		if (result.redirectUrl) {
			// Keep JSON stdout machine-readable while still making headless auth possible.
			(json ? io.writeErr : io.writeln)(
				`Authorize ${toolkit}: ${result.redirectUrl}`,
			);
			try {
				await open(result.redirectUrl);
			} catch {
				/* The printed URL works on headless hosts. */
			}
		}
		let status = result.status;
		const deadline = Date.now() + 5 * 60 * 1000;
		while (true) {
			if (cancelled) throw new Error("Connector installation cancelled.");
			const entry = status.integrations.find(
				(item) => item.toolkit === toolkit,
			);
			if (entry?.status === "connected") {
				if (entry.error) throw new Error(entry.error);
				io.writeln(
					json
						? JSON.stringify(entry)
						: `Installed ${entry.name}. Start a new session to use its tools.`,
				);
				return;
			}
			if (!status.configured || entry?.status !== "pending")
				throw new Error(
					entry?.error ?? "Connector installation did not complete.",
				);
			if (Date.now() >= deadline)
				throw new Error("Connector authorization timed out.");
			await new Promise((resolve) => setTimeout(resolve, 500));
			status = await getComposioStatus();
		}
	} catch (error) {
		await cancelComposioConnect(toolkit);
		throw error;
	} finally {
		process.removeListener("SIGINT", interrupt);
	}
}

export function createConnectorCommand(
	io: ConnectorIo,
	setExitCode: (code: number) => void,
	globalJson: () => boolean,
): Command {
	const command = new Command("connector").description(
		"Browse and install Cline marketplace connectors",
	);
	const run = async (action: () => Promise<void>) => {
		try {
			await action();
			setExitCode(0);
		} catch (error) {
			io.writeErr(error instanceof Error ? error.message : String(error));
			setExitCode(1);
		}
	};
	command
		.command("list")
		.description(
			"Browse the connector marketplace and choose a connector to install",
		)
		.option("--json", "Output the catalog as JSON without prompting")
		.action(async (options: { json?: boolean }) =>
			run(async () => {
				const catalog = await listComposioToolkits();
				if (!catalog.configured) throw new Error(unavailable);
				const json = options.json || globalJson();
				if (json) {
					io.writeln(JSON.stringify(catalog.toolkits));
					return;
				}
				if (!catalog.toolkits.length) {
					io.writeln("No connectors available.");
					return;
				}
				if (!process.stdin.isTTY || !process.stdout.isTTY) {
					io.writeln("Cline connector marketplace:");
					for (const entry of catalog.toolkits)
						io.writeln(
							`  ${entry.slug} — ${entry.name}${entry.description ? `: ${entry.description}` : ""}`,
						);
					io.writeln("Install with: cline connector install <slug>");
					return;
				}
				const selected = await p.select({
					message: "Choose a connector to install",
					options: catalog.toolkits.map((entry) => ({
						value: entry.slug,
						label: entry.name,
						hint: entry.slug,
					})),
				});
				if (p.isCancel(selected)) return;
				await installConnector(selected, io);
			}),
		);
	command
		.command("install <slug>")
		.description("Install a connector using browser authorization")
		.option("--json", "Output the installed connector as JSON")
		.action(async (slug: string, options: { json?: boolean }) =>
			run(() => installConnector(slug, io, options.json || globalJson())),
		);
	return command;
}
