"use client";

import { Circle, Eye, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { desktopClient } from "@/lib/desktop-client";
import { cn } from "@/lib/utils";

interface McpServer {
	name: string;
	transportType: "stdio" | "sse" | "streamableHttp";
	disabled: boolean;
	command?: string;
	args?: string[];
	cwd?: string;
	env?: Record<string, string>;
	url?: string;
	headers?: Record<string, string>;
	metadata?: unknown;
}

interface McpServersResponse {
	settingsPath: string;
	hasSettingsFile: boolean;
	servers: McpServer[];
}

interface McpServerUpsertInput {
	name: string;
	transportType: "stdio" | "sse" | "streamableHttp";
	command?: string;
	args?: string[];
	cwd?: string;
	env?: Record<string, string>;
	url?: string;
	headers?: Record<string, string>;
	disabled?: boolean;
	metadata?: unknown;
}

function splitCsv(text: string): string[] {
	return text
		.split(",")
		.map((value) => value.trim())
		.filter((value) => value.length > 0);
}

function parseKeyValuePairs(text: string): Record<string, string> | undefined {
	const pairs = splitCsv(text);
	if (pairs.length === 0) {
		return undefined;
	}
	const out: Record<string, string> = {};
	for (const pair of pairs) {
		const idx = pair.indexOf("=");
		if (idx <= 0) {
			continue;
		}
		const key = pair.slice(0, idx).trim();
		const value = pair.slice(idx + 1).trim();
		if (!key) {
			continue;
		}
		out[key] = value;
	}
	return Object.keys(out).length > 0 ? out : undefined;
}

function stringifyKeyValuePairs(input?: Record<string, string>): string {
	if (!input) {
		return "";
	}
	return Object.entries(input)
		.map(([key, value]) => `${key}=${value}`)
		.join(", ");
}

function getServerInput(existing?: McpServer): McpServerUpsertInput | null {
	const nameInput = window.prompt("MCP server name", existing?.name ?? "");
	if (nameInput == null) {
		return null;
	}
	const name = nameInput.trim();
	if (!name) {
		window.alert("Server name is required.");
		return null;
	}

	const transportInput = window.prompt(
		'Transport type ("stdio", "sse", or "streamableHttp")',
		existing?.transportType ?? "stdio",
	);
	if (transportInput == null) {
		return null;
	}
	const transportType =
		transportInput.trim() as McpServerUpsertInput["transportType"];
	if (
		transportType !== "stdio" &&
		transportType !== "sse" &&
		transportType !== "streamableHttp"
	) {
		window.alert('Transport type must be "stdio", "sse", or "streamableHttp".');
		return null;
	}

	if (transportType === "stdio") {
		const commandInput = window.prompt("Command", existing?.command ?? "");
		if (commandInput == null) {
			return null;
		}
		const command = commandInput.trim();
		if (!command) {
			window.alert("Command is required for stdio transport.");
			return null;
		}
		const argsInput = window.prompt(
			'Args (comma-separated, e.g. "-y, @modelcontextprotocol/server-github")',
			existing?.args?.join(", ") ?? "",
		);
		if (argsInput == null) {
			return null;
		}
		const cwdInput = window.prompt(
			"Working directory (optional)",
			existing?.cwd ?? "",
		);
		if (cwdInput == null) {
			return null;
		}
		const envInput = window.prompt(
			"Environment vars (comma-separated KEY=VALUE pairs, optional)",
			stringifyKeyValuePairs(existing?.env),
		);
		if (envInput == null) {
			return null;
		}
		const args = splitCsv(argsInput);
		return {
			name,
			transportType,
			command,
			args: args.length > 0 ? args : undefined,
			cwd: cwdInput.trim() || undefined,
			env: parseKeyValuePairs(envInput),
			disabled: existing?.disabled ?? false,
			metadata: existing?.metadata,
		};
	}

	const urlInput = window.prompt("Server URL", existing?.url ?? "");
	if (urlInput == null) {
		return null;
	}
	const url = urlInput.trim();
	if (!url) {
		window.alert("URL is required for sse/streamableHttp transport.");
		return null;
	}
	const headersInput = window.prompt(
		"Headers (comma-separated KEY=VALUE pairs, optional)",
		stringifyKeyValuePairs(existing?.headers),
	);
	if (headersInput == null) {
		return null;
	}
	return {
		name,
		transportType,
		url,
		headers: parseKeyValuePairs(headersInput),
		disabled: existing?.disabled ?? false,
		metadata: existing?.metadata,
	};
}

export function McpServersContent() {
	const [servers, setServers] = useState<McpServer[]>([]);
	const [settingsPath, setSettingsPath] = useState("");
	const [hasSettingsFile, setHasSettingsFile] = useState(false);
	const [isLoading, setIsLoading] = useState(true);
	const [isOpeningSettingsFile, setIsOpeningSettingsFile] = useState(false);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const [busyServerName, setBusyServerName] = useState<string | null>(null);

	const applyResponse = useCallback((response: McpServersResponse) => {
		setServers(response.servers);
		setSettingsPath(response.settingsPath);
		setHasSettingsFile(response.hasSettingsFile);
	}, []);

	const refreshServers = useCallback(async () => {
		setIsLoading(true);
		setErrorMessage(null);
		try {
			const response =
				await desktopClient.invoke<McpServersResponse>("list_mcp_servers");
			applyResponse(response);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			setErrorMessage(message);
		} finally {
			setIsLoading(false);
		}
	}, [applyResponse]);

	useEffect(() => {
		void refreshServers();
	}, [refreshServers]);

	const toggleServer = async (server: McpServer, disabled: boolean) => {
		setBusyServerName(server.name);
		setErrorMessage(null);
		try {
			const response = await desktopClient.invoke<McpServersResponse>(
				"set_mcp_server_disabled",
				{
					name: server.name,
					disabled,
				},
			);
			applyResponse(response);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			setErrorMessage(message);
		} finally {
			setBusyServerName(null);
		}
	};

	const upsertServer = async (input: McpServerUpsertInput) => {
		setBusyServerName(input.name);
		setErrorMessage(null);
		try {
			const response = await desktopClient.invoke<McpServersResponse>(
				"upsert_mcp_server",
				{
					input,
				},
			);
			applyResponse(response);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			setErrorMessage(message);
		} finally {
			setBusyServerName(null);
		}
	};

	const deleteServer = async (serverName: string) => {
		setBusyServerName(serverName);
		setErrorMessage(null);
		try {
			const response = await desktopClient.invoke<McpServersResponse>(
				"delete_mcp_server",
				{
					name: serverName,
				},
			);
			applyResponse(response);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			setErrorMessage(message);
		} finally {
			setBusyServerName(null);
		}
	};

	const handleAddServer = async () => {
		const input = getServerInput();
		if (!input) {
			return;
		}
		await upsertServer(input);
	};

	const handleEditServer = async (server: McpServer) => {
		const input = getServerInput(server);
		if (!input) {
			return;
		}
		await upsertServer(input);
	};

	const _openMcpCatalog = () => {
		window.open("https://mcp.so", "_blank", "noopener,noreferrer");
	};

	const openSettingsFile = async () => {
		setIsOpeningSettingsFile(true);
		setErrorMessage(null);
		try {
			const openedPath = await desktopClient.invoke<string>(
				"open_mcp_settings_file",
			);
			if (openedPath.trim().length > 0) {
				setSettingsPath(openedPath);
				setHasSettingsFile(true);
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			setErrorMessage(message);
		} finally {
			setIsOpeningSettingsFile(false);
		}
	};

	const sortedServers = useMemo(
		() =>
			[...servers].sort((a, b) =>
				a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
			),
		[servers],
	);

	return (
		<ScrollArea className="h-full">
			<div className="mx-auto max-w-3xl px-8 py-6">
				<div className="mb-6 flex items-center justify-between gap-3">
					<div className="flex min-w-0 items-center gap-3">
						<h2 className="truncate text-lg font-semibold text-foreground">
							MCP Servers
						</h2>
						<span className="rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground">
							From settings file
						</span>
					</div>
					<div className="flex items-center gap-2">
						<Button
							variant="outline"
							size="sm"
							onClick={() => void refreshServers()}
							disabled={isLoading}
						>
							<RefreshCw
								className={cn("h-4 w-4", isLoading && "animate-spin")}
							/>
							Refresh
						</Button>
						<Button size="sm" onClick={() => void handleAddServer()}>
							<Plus className="h-4 w-4" />
							Add MCP Server
						</Button>
					</div>
				</div>

				<div className="mb-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
					<span>MCP settings path:</span>
					<Button
						variant="link"
						className="h-auto p-0 font-mono text-xs"
						onClick={() => void openSettingsFile()}
						disabled={isOpeningSettingsFile}
					>
						{settingsPath || "Open settings file"}
					</Button>
					<Button
						variant="outline"
						size="sm"
						onClick={() => void openSettingsFile()}
						disabled={isOpeningSettingsFile}
					>
						Open config file
					</Button>
				</div>
				<p className="mb-6 text-xs text-muted-foreground">
					{hasSettingsFile
						? "Editing this list updates cline_mcp_settings.json."
						: "No MCP settings file found yet. Add a server to create it."}
				</p>

				{errorMessage && (
					<div className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
						{errorMessage}
					</div>
				)}

				{isLoading ? (
					<div className="rounded-lg border border-border px-5 py-4 text-sm text-muted-foreground">
						Loading MCP servers...
					</div>
				) : sortedServers.length === 0 ? (
					<div className="rounded-lg border border-border px-5 py-4 text-sm text-muted-foreground">
						No MCP servers configured.
					</div>
				) : (
					<div className="flex flex-col gap-3">
						{sortedServers.map((server) => {
							const isBusy = busyServerName === server.name;
							return (
								<div
									key={server.name}
									className="rounded-lg border border-border px-5 py-4 transition-colors hover:bg-accent/20"
								>
									<div className="flex items-center gap-3">
										<Circle
											className={cn(
												"h-2.5 w-2.5 shrink-0",
												server.disabled
													? "fill-muted-foreground/40 text-muted-foreground/40"
													: "fill-primary text-primary",
											)}
										/>
										<h3 className="text-sm font-semibold text-foreground">
											{server.name}
										</h3>
										<span className="rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground">
											{server.transportType}
										</span>
										<div className="flex-1" />
										<div className="flex items-center gap-1">
											<Button
												variant="ghost"
												size="icon-sm"
												aria-label={`View ${server.name}`}
												onClick={() => {
													window.alert(JSON.stringify(server, null, 2));
												}}
											>
												<Eye className="h-3.5 w-3.5" />
											</Button>
											<Button
												variant="ghost"
												size="icon-sm"
												aria-label={`Edit ${server.name}`}
												onClick={() => void handleEditServer(server)}
												disabled={isBusy}
											>
												<Pencil className="h-3.5 w-3.5" />
											</Button>
											<Button
												variant="ghost"
												size="icon-sm"
												aria-label={`Delete ${server.name}`}
												onClick={() => {
													if (
														window.confirm(
															`Delete MCP server "${server.name}" from settings?`,
														)
													) {
														void deleteServer(server.name);
													}
												}}
												disabled={!server.disabled && isBusy}
											>
												<Trash2 className="h-3.5 w-3.5" />
											</Button>
											<Switch
												checked={!server.disabled}
												onCheckedChange={(enabled) =>
													toggleServer(server, !enabled)
												}
												disabled={!server.disabled && isBusy}
												aria-label={`Enable ${server.name}`}
											/>
										</div>
									</div>

									<div className="mt-2.5 ml-5.5 flex flex-col gap-1 text-xs text-muted-foreground">
										{server.command && (
											<p>
												<span className="text-muted-foreground/70">
													Command:
												</span>{" "}
												{server.command}
											</p>
										)}
										{server.args && server.args.length > 0 && (
											<p>
												<span className="text-muted-foreground/70">Args:</span>{" "}
												{server.args.join(", ")}
											</p>
										)}
										{server.cwd && (
											<p>
												<span className="text-muted-foreground/70">CWD:</span>{" "}
												{server.cwd}
											</p>
										)}
										{server.url && (
											<p>
												<span className="text-muted-foreground/70">URL:</span>{" "}
												{server.url}
											</p>
										)}
										{server.env && Object.keys(server.env).length > 0 && (
											<p>
												<span className="text-muted-foreground/70">Env:</span>{" "}
												{stringifyKeyValuePairs(server.env)}
											</p>
										)}
										{server.headers &&
											Object.keys(server.headers).length > 0 && (
												<p>
													<span className="text-muted-foreground/70">
														Headers:
													</span>{" "}
													{stringifyKeyValuePairs(server.headers)}
												</p>
											)}
									</div>
								</div>
							);
						})}
					</div>
				)}
			</div>
		</ScrollArea>
	);
}
