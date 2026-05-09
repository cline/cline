"use client";

import { Circle, Minus, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { desktopClient } from "@/lib/desktop-client";
import { cn } from "@/lib/utils";

type McpTransportType = "stdio" | "sse" | "streamableHttp";

interface McpServer {
	name: string;
	transportType: McpTransportType;
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
	previousName?: string;
	transportType: McpTransportType;
	command?: string;
	args?: string[];
	cwd?: string;
	env?: Record<string, string>;
	url?: string;
	headers?: Record<string, string>;
	disabled?: boolean;
	metadata?: unknown;
}

type McpServerFormState = {
	name: string;
	previousName: string;
	transportType: McpTransportType;
	command: string;
	argsText: string;
	cwd: string;
	envEntries: Array<{ id: string; key: string; value: string }>;
	url: string;
	headersText: string;
	disabled: boolean;
	metadataText: string;
};

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

function stringifyRedactedKeyValuePairs(
	input?: Record<string, string>,
): string {
	if (!input) {
		return "";
	}
	return Object.keys(input)
		.map((key) => `${key}=[REDACTED]`)
		.join(", ");
}

function createEnvEntries(
	input?: Record<string, string>,
): Array<{ id: string; key: string; value: string }> {
	if (!input || Object.keys(input).length === 0) {
		return [{ id: crypto.randomUUID(), key: "", value: "" }];
	}
	return Object.entries(input).map(([key, value]) => ({
		id: crypto.randomUUID(),
		key,
		value,
	}));
}

function createServerFormState(existing?: McpServer): McpServerFormState {
	return {
		name: existing?.name ?? "",
		previousName: existing?.name ?? "",
		transportType: existing?.transportType ?? "stdio",
		command: existing?.command ?? "",
		argsText: existing?.args?.join(", ") ?? "",
		cwd: existing?.cwd ?? "",
		envEntries: createEnvEntries(existing?.env),
		url: existing?.url ?? "",
		headersText: stringifyKeyValuePairs(existing?.headers),
		disabled: existing?.disabled ?? false,
		metadataText:
			existing?.metadata === undefined
				? ""
				: JSON.stringify(existing.metadata, null, 2),
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
	const [editorOpen, setEditorOpen] = useState(false);
	const [editorMode, setEditorMode] = useState<"create" | "edit">("create");
	const [formState, setFormState] = useState<McpServerFormState>(() =>
		createServerFormState(),
	);
	const [formErrorMessage, setFormErrorMessage] = useState<string | null>(null);
	const [deleteTarget, setDeleteTarget] = useState<McpServer | null>(null);

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
		setBusyServerName(input.previousName ?? input.name);
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
			throw error;
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

	const buildServerInput = useCallback((form: McpServerFormState) => {
		const name = form.name.trim();
		if (!name) {
			throw new Error("Server name is required.");
		}
		const env = form.envEntries.reduce<Record<string, string>>((acc, entry) => {
			const key = entry.key.trim();
			if (!key) {
				return acc;
			}
			acc[key] = entry.value;
			return acc;
		}, {});
		const metadataText = form.metadataText.trim();
		const metadata =
			metadataText.length > 0 ? JSON.parse(metadataText) : undefined;
		if (form.transportType === "stdio") {
			const command = form.command.trim();
			if (!command) {
				throw new Error("Command is required for stdio transport.");
			}
			const args = splitCsv(form.argsText);
			return {
				name,
				previousName: form.previousName.trim() || undefined,
				transportType: form.transportType,
				command,
				args: args.length > 0 ? args : undefined,
				cwd: form.cwd.trim() || undefined,
				env: Object.keys(env).length > 0 ? env : undefined,
				disabled: form.disabled,
				metadata,
			} satisfies McpServerUpsertInput;
		}
		const url = form.url.trim();
		if (!url) {
			throw new Error("URL is required for sse and streamableHttp transport.");
		}
		return {
			name,
			previousName: form.previousName.trim() || undefined,
			transportType: form.transportType,
			url,
			headers: parseKeyValuePairs(form.headersText),
			disabled: form.disabled,
			metadata,
		} satisfies McpServerUpsertInput;
	}, []);

	const openCreateDialog = () => {
		setEditorMode("create");
		setFormState(createServerFormState());
		setFormErrorMessage(null);
		setEditorOpen(true);
	};

	const openEditDialog = (server: McpServer) => {
		setEditorMode("edit");
		setFormState(createServerFormState(server));
		setFormErrorMessage(null);
		setEditorOpen(true);
	};

	const handleSaveServer = async () => {
		setFormErrorMessage(null);
		try {
			const input = buildServerInput(formState);
			await upsertServer(input);
			setEditorOpen(false);
		} catch (error) {
			setFormErrorMessage(
				error instanceof Error ? error.message : String(error),
			);
		}
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

	const updateEnvEntry = (
		id: string,
		field: "key" | "value",
		value: string,
	) => {
		setFormState((current) => ({
			...current,
			envEntries: current.envEntries.map((entry) =>
				entry.id === id ? { ...entry, [field]: value } : entry,
			),
		}));
	};

	const addEnvEntry = () => {
		setFormState((current) => ({
			...current,
			envEntries: [
				...current.envEntries,
				{ id: crypto.randomUUID(), key: "", value: "" },
			],
		}));
	};

	const removeEnvEntry = (id: string) => {
		setFormState((current) => ({
			...current,
			envEntries:
				current.envEntries.length === 1
					? [{ id: crypto.randomUUID(), key: "", value: "" }]
					: current.envEntries.filter((entry) => entry.id !== id),
		}));
	};

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
						<Button size="sm" onClick={openCreateDialog}>
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
												aria-label={`Edit ${server.name}`}
												onClick={() => openEditDialog(server)}
												disabled={isBusy}
											>
												<Pencil className="h-3.5 w-3.5" />
											</Button>
											<Button
												variant="ghost"
												size="icon-sm"
												aria-label={`Delete ${server.name}`}
												onClick={() => setDeleteTarget(server)}
												disabled={isBusy}
											>
												<Trash2 className="h-3.5 w-3.5" />
											</Button>
											<Switch
												checked={!server.disabled}
												onCheckedChange={(enabled) =>
													toggleServer(server, !enabled)
												}
												disabled={isBusy}
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
												{stringifyRedactedKeyValuePairs(server.env)}
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

			<Dialog
				open={editorOpen}
				onOpenChange={(open) => {
					setEditorOpen(open);
					if (!open) {
						setFormErrorMessage(null);
					}
				}}
			>
				<DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
					<DialogHeader>
						<DialogTitle>
							{editorMode === "edit" ? "Edit MCP Server" : "Add MCP Server"}
						</DialogTitle>
						<DialogDescription>
							Update the MCP server stored in{" "}
							<code className="font-mono">
								{settingsPath || "cline_mcp_settings.json"}
							</code>
							.
						</DialogDescription>
					</DialogHeader>

					<div className="grid gap-4">
						<div className="grid gap-2">
							<Label htmlFor="mcp-name">Server name</Label>
							<Input
								id="mcp-name"
								value={formState.name}
								onChange={(event) =>
									setFormState((current) => ({
										...current,
										name: event.target.value,
									}))
								}
								placeholder="github"
							/>
						</div>

						<div className="grid gap-2">
							<Label>Transport type</Label>
							<Select
								value={formState.transportType}
								onValueChange={(value) =>
									setFormState((current) => ({
										...current,
										transportType: value as McpTransportType,
									}))
								}
							>
								<SelectTrigger className="w-full">
									<SelectValue placeholder="Select transport" />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="stdio">stdio</SelectItem>
									<SelectItem value="sse">sse</SelectItem>
									<SelectItem value="streamableHttp">streamableHttp</SelectItem>
								</SelectContent>
							</Select>
						</div>

						{formState.transportType === "stdio" ? (
							<>
								<div className="grid gap-2">
									<Label htmlFor="mcp-command">Command</Label>
									<Input
										id="mcp-command"
										value={formState.command}
										onChange={(event) =>
											setFormState((current) => ({
												...current,
												command: event.target.value,
											}))
										}
										placeholder="npx"
									/>
								</div>
								<div className="grid gap-2">
									<Label htmlFor="mcp-args">Args</Label>
									<Textarea
										id="mcp-args"
										value={formState.argsText}
										onChange={(event) =>
											setFormState((current) => ({
												...current,
												argsText: event.target.value,
											}))
										}
										placeholder="-y, @modelcontextprotocol/server-github"
									/>
								</div>
								<div className="grid gap-2">
									<Label htmlFor="mcp-cwd">Working directory</Label>
									<Input
										id="mcp-cwd"
										value={formState.cwd}
										onChange={(event) =>
											setFormState((current) => ({
												...current,
												cwd: event.target.value,
											}))
										}
										placeholder="/path/to/project"
									/>
								</div>
								<div className="grid gap-2">
									<div className="flex items-center justify-between gap-3">
										<Label>Environment variables</Label>
										<Button
											type="button"
											variant="ghost"
											size="sm"
											onClick={addEnvEntry}
										>
											<Plus className="h-3.5 w-3.5" />
										</Button>
									</div>
									<div className="flex flex-col gap-2">
										{formState.envEntries.map((entry) => (
											<div key={entry.id} className="flex items-center gap-2">
												<Button
													type="button"
													variant="ghost"
													size="icon-sm"
													onClick={() => removeEnvEntry(entry.id)}
													aria-label={`Remove env var ${entry.key || "row"}`}
												>
													<Minus className="h-3.5 w-3.5" />
												</Button>
												<Input
													value={entry.key}
													onChange={(event) =>
														updateEnvEntry(entry.id, "key", event.target.value)
													}
													placeholder="KEY"
												/>
												<Input
													type="password"
													value={entry.value}
													onChange={(event) =>
														updateEnvEntry(
															entry.id,
															"value",
															event.target.value,
														)
													}
													placeholder="VALUE"
												/>
											</div>
										))}
									</div>
								</div>
							</>
						) : (
							<>
								<div className="grid gap-2">
									<Label htmlFor="mcp-url">Server URL</Label>
									<Input
										id="mcp-url"
										value={formState.url}
										onChange={(event) =>
											setFormState((current) => ({
												...current,
												url: event.target.value,
											}))
										}
										placeholder="https://example.com/mcp"
									/>
								</div>
								<div className="grid gap-2">
									<Label htmlFor="mcp-headers">Headers</Label>
									<Textarea
										id="mcp-headers"
										value={formState.headersText}
										onChange={(event) =>
											setFormState((current) => ({
												...current,
												headersText: event.target.value,
											}))
										}
										placeholder="Authorization=Bearer token"
									/>
								</div>
							</>
						)}

						<div className="grid gap-2">
							<Label htmlFor="mcp-metadata">Metadata JSON</Label>
							<Textarea
								id="mcp-metadata"
								value={formState.metadataText}
								onChange={(event) =>
									setFormState((current) => ({
										...current,
										metadataText: event.target.value,
									}))
								}
								placeholder='{"key":"value"}'
							/>
						</div>

						<div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
							<div>
								<p className="text-sm font-medium text-foreground">Enabled</p>
								<p className="text-xs text-muted-foreground">
									Disable the server without removing it from settings.
								</p>
							</div>
							<Switch
								checked={!formState.disabled}
								onCheckedChange={(enabled) =>
									setFormState((current) => ({
										...current,
										disabled: !enabled,
									}))
								}
								aria-label="Enable MCP server"
							/>
						</div>

						{formErrorMessage ? (
							<div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
								{formErrorMessage}
							</div>
						) : null}
					</div>

					<DialogFooter>
						<Button
							variant="outline"
							onClick={() => setEditorOpen(false)}
							disabled={busyServerName !== null}
						>
							Cancel
						</Button>
						<Button
							onClick={() => void handleSaveServer()}
							disabled={busyServerName !== null}
						>
							{busyServerName !== null
								? "Saving..."
								: editorMode === "edit"
									? "Save changes"
									: "Add server"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			<AlertDialog
				open={deleteTarget !== null}
				onOpenChange={(open) => {
					if (!open) {
						setDeleteTarget(null);
					}
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete MCP Server</AlertDialogTitle>
						<AlertDialogDescription>
							{deleteTarget
								? `Delete MCP server "${deleteTarget.name}" from settings?`
								: "Delete this MCP server from settings?"}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={busyServerName !== null}>
							Cancel
						</AlertDialogCancel>
						<AlertDialogAction
							disabled={busyServerName !== null || !deleteTarget}
							onClick={() => {
								if (deleteTarget) {
									void deleteServer(deleteTarget.name);
									setDeleteTarget(null);
								}
							}}
						>
							Delete
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</ScrollArea>
	);
}
