"use client";

import { Circle, Plus, RefreshCw, Trash2 } from "lucide-react";
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
import { Button, buttonVariants } from "@/components/ui/button";
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
import {
	CommandBadge,
	PageEmptyState,
	PageFrame,
	PageHeader,
} from "../page-layout";

type ConnectorField = {
	flag: string;
	label: string;
	placeholder?: string;
	required?: boolean;
	help?: string[];
	initialValue?: string;
	options?: Array<{ value: string; label: string; hint?: string }>;
	includeWhen?: {
		flag: string;
		equals?: string;
		notEquals?: string;
	};
};

type ConnectorSecurityField = {
	key: string;
	label: string;
	placeholder?: string;
	help?: string[];
	requiredMessage: string;
};

type ConnectorChannel = {
	id: string;
	name: string;
	type: "polling" | "webhook" | "hybrid";
	hint: string;
	fields: ConnectorField[];
	security?: {
		prompt: string;
		fields: ConnectorSecurityField[];
	};
};

type ActiveConnector = {
	id: string;
	type: string;
	pid: number;
	hubUrl: string;
	startedAt?: string;
	applicationId?: string;
	botUsername?: string;
	userName?: string;
	phoneNumberId?: string;
	port?: number;
	baseUrl?: string;
	connectionMode?: string;
};

type ConnectorChannelsResponse = {
	available: ConnectorChannel[];
	active: ActiveConnector[];
};

type ConnectorFormState = {
	channelId: string;
	values: Record<string, string>;
	securityEnabled: boolean;
	securityValues: Record<string, string>;
};

function connectorName(
	connector: ActiveConnector,
	channels: ConnectorChannel[],
): string {
	return (
		channels.find((channel) => channel.id === connector.type)?.name ??
		connector.type
	);
}

function connectorIdentity(connector: ActiveConnector): string {
	if (connector.botUsername) {
		return `@${connector.botUsername}`;
	}
	if (connector.userName) {
		return connector.userName;
	}
	if (connector.applicationId) {
		return connector.applicationId;
	}
	return `pid ${connector.pid}`;
}

function formatDateTime(value?: string): string {
	if (!value) {
		return "-";
	}
	const parsed = new Date(value);
	return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function isSecretField(
	field: ConnectorField | ConnectorSecurityField,
): boolean {
	const label = field.label.toLowerCase();
	const key =
		"flag" in field ? field.flag.toLowerCase() : field.key.toLowerCase();
	return (
		label.includes("token") ||
		label.includes("secret") ||
		label.includes("key") ||
		key.includes("token") ||
		key.includes("secret") ||
		key.includes("key")
	);
}

function isMultilineField(field: ConnectorField): boolean {
	const label = field.label.toLowerCase();
	return label.includes("json") || field.flag.includes("credentials");
}

function shouldIncludeField(
	field: ConnectorField,
	values: Record<string, string>,
): boolean {
	const condition = field.includeWhen;
	if (!condition) {
		return true;
	}
	const value = values[condition.flag] ?? "";
	if (condition.equals !== undefined && value !== condition.equals) {
		return false;
	}
	if (condition.notEquals !== undefined && value === condition.notEquals) {
		return false;
	}
	return true;
}

function initialValuesForChannel(
	channel?: ConnectorChannel,
): Record<string, string> {
	const values: Record<string, string> = {};
	for (const field of channel?.fields ?? []) {
		if (field.initialValue) {
			values[field.flag] = field.initialValue;
		}
	}
	return values;
}

function createFormState(channels: ConnectorChannel[]): ConnectorFormState {
	const channel = channels[0];
	return {
		channelId: channel?.id ?? "",
		values: initialValuesForChannel(channel),
		securityEnabled: false,
		securityValues: {},
	};
}

export function ChannelsContent() {
	const [channels, setChannels] = useState<ConnectorChannel[]>([]);
	const [activeConnectors, setActiveConnectors] = useState<ActiveConnector[]>(
		[],
	);
	const [isLoading, setIsLoading] = useState(true);
	const [busyChannel, setBusyChannel] = useState<string | null>(null);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const [dialogOpen, setDialogOpen] = useState(false);
	const [formState, setFormState] = useState<ConnectorFormState>({
		channelId: "",
		values: {},
		securityEnabled: false,
		securityValues: {},
	});
	const [formError, setFormError] = useState<string | null>(null);
	const [removeTarget, setRemoveTarget] = useState<ActiveConnector | null>(
		null,
	);

	const selectedChannel = useMemo(
		() => channels.find((channel) => channel.id === formState.channelId),
		[channels, formState.channelId],
	);
	const visibleFields = useMemo(() => {
		const values = {
			...initialValuesForChannel(selectedChannel),
			...formState.values,
		};
		return (selectedChannel?.fields ?? []).filter((field) =>
			shouldIncludeField(field, values),
		);
	}, [selectedChannel, formState.values]);

	const applyResponse = useCallback((response: ConnectorChannelsResponse) => {
		setChannels(response.available);
		setActiveConnectors(response.active);
		setFormState((prev) =>
			prev.channelId ? prev : createFormState(response.available),
		);
	}, []);

	const refreshChannels = useCallback(async () => {
		setIsLoading(true);
		setErrorMessage(null);
		try {
			const response = await desktopClient.invoke<ConnectorChannelsResponse>(
				"list_connector_channels",
			);
			applyResponse(response);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			setErrorMessage(message);
		} finally {
			setIsLoading(false);
		}
	}, [applyResponse]);

	useEffect(() => {
		const timeoutId = window.setTimeout(() => {
			void refreshChannels();
		}, 0);
		return () => window.clearTimeout(timeoutId);
	}, [refreshChannels]);

	const openAddDialog = () => {
		setFormState(createFormState(channels));
		setFormError(null);
		setDialogOpen(true);
	};

	const updateFieldValue = (flag: string, value: string) => {
		setFormState((prev) => ({
			...prev,
			values: { ...prev.values, [flag]: value },
		}));
	};

	const updateSecurityFieldValue = (key: string, value: string) => {
		setFormState((prev) => ({
			...prev,
			securityValues: { ...prev.securityValues, [key]: value },
		}));
	};

	const startConnector = async () => {
		if (!selectedChannel) {
			setFormError("Choose a channel");
			return;
		}
		for (const field of selectedChannel.fields) {
			if (!visibleFields.includes(field)) {
				continue;
			}
			if (field.required && !formState.values[field.flag]?.trim()) {
				setFormError(`${field.label} is required`);
				return;
			}
		}
		if (formState.securityEnabled && selectedChannel.security) {
			for (const field of selectedChannel.security.fields) {
				if (!formState.securityValues[field.key]?.trim()) {
					setFormError(field.requiredMessage);
					return;
				}
			}
		}
		setBusyChannel(selectedChannel.id);
		setFormError(null);
		setErrorMessage(null);
		try {
			const response = await desktopClient.invoke<ConnectorChannelsResponse>(
				"start_connector_channel",
				{
					channel: selectedChannel.id,
					values: formState.values,
					security: {
						enabled: formState.securityEnabled,
						values: formState.securityValues,
					},
				},
			);
			applyResponse(response);
			setDialogOpen(false);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			setFormError(message);
		} finally {
			setBusyChannel(null);
		}
	};

	const stopConnector = async (connector: ActiveConnector) => {
		setBusyChannel(connector.type);
		setErrorMessage(null);
		try {
			const response = await desktopClient.invoke<ConnectorChannelsResponse>(
				"stop_connector_channel",
				{ channel: connector.type },
			);
			applyResponse(response);
			setRemoveTarget(null);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			setErrorMessage(message);
		} finally {
			setBusyChannel(null);
		}
	};

	return (
		<PageFrame>
			<PageHeader
				description={`${activeConnectors.length} connected. Start and manage connector channels for Cline.`}
				title="Channels"
				meta={<CommandBadge>cline connect</CommandBadge>}
				actions={
					<>
						<Button
							disabled={isLoading}
							onClick={() => void refreshChannels()}
							size="sm"
							type="button"
							variant="outline"
						>
							<RefreshCw
								className={cn("size-4", isLoading && "animate-spin")}
							/>
						</Button>
						<Button
							disabled={channels.length === 0}
							onClick={openAddDialog}
							size="sm"
							type="button"
						>
							<Plus className="size-4" />
							Add Channel
						</Button>
					</>
				}
			/>

			{errorMessage ? (
				<div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
					{errorMessage}
				</div>
			) : null}

			{isLoading ? (
				<PageEmptyState>Loading channels...</PageEmptyState>
			) : activeConnectors.length === 0 ? (
				<PageEmptyState>No channels connected.</PageEmptyState>
			) : (
				<section className="overflow-hidden rounded-lg border bg-card">
					<div className="grid gap-2 p-2.5">
						{activeConnectors.map((connector) => (
							<div
								className="grid gap-3 border bg-[color-mix(in_oklch,var(--background)_70%,var(--card))] p-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center"
								key={connector.id}
							>
								<div className="min-w-0">
									<div className="flex items-center gap-2">
										<Circle className="size-2 fill-emerald-300 text-emerald-300" />
										<p className="truncate text-[13px] font-semibold leading-tight">
											{connectorName(connector, channels)}
										</p>
										<span className="rounded-md border bg-background px-1.5 py-0.5 text-[11px] text-muted-foreground">
											{connectorIdentity(connector)}
										</span>
									</div>
									<div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
										<span className="rounded-md border bg-background px-1.5 py-0.5">
											pid={connector.pid}
										</span>
										<span
											className="max-w-full break-all rounded-md border bg-background px-1.5 py-0.5"
											title={connector.hubUrl}
										>
											{connector.hubUrl}
										</span>
										{connector.baseUrl ? (
											<span
												className="max-w-full break-all rounded-md border bg-background px-1.5 py-0.5"
												title={connector.baseUrl}
											>
												{connector.baseUrl}
											</span>
										) : null}
										<span className="rounded-md border bg-background px-1.5 py-0.5">
											{formatDateTime(connector.startedAt)}
										</span>
										{connector.connectionMode ? (
											<span className="rounded-md border bg-background px-1.5 py-0.5">
												{connector.connectionMode}
											</span>
										) : null}
									</div>
								</div>
								<Button
									disabled={busyChannel === connector.type}
									onClick={() => setRemoveTarget(connector)}
									size="sm"
									type="button"
									variant="outline"
								>
									<Trash2 className="size-4" />
									Remove...
								</Button>
							</div>
						))}
					</div>
				</section>
			)}

			<Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
				<DialogContent className="max-h-[86vh] overflow-y-auto sm:max-w-xl">
					<DialogHeader>
						<DialogTitle>Add Channel</DialogTitle>
						<DialogDescription>
							Start a connector channel for Cline.
						</DialogDescription>
					</DialogHeader>
					<div className="grid gap-4 py-2">
						<div className="grid gap-2">
							<Label>Channel</Label>
							<Select
								onValueChange={(value) => {
									if (!value) {
										return;
									}
									setFormState({
										channelId: value,
										values: initialValuesForChannel(
											channels.find((channel) => channel.id === value),
										),
										securityEnabled: false,
										securityValues: {},
									});
								}}
								value={formState.channelId}
							>
								<SelectTrigger>
									<SelectValue placeholder="Select channel" />
								</SelectTrigger>
								<SelectContent>
									{channels.map((channel) => (
										<SelectItem key={channel.id} value={channel.id}>
											{channel.name}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>

						{visibleFields.map((field) => (
							<div className="grid gap-2" key={field.flag}>
								<Label>
									{field.label}
									{field.required ? (
										<span className="text-destructive"> *</span>
									) : null}
								</Label>
								{field.options ? (
									<Select
										onValueChange={(value) => {
											if (value) {
												updateFieldValue(field.flag, value);
											}
										}}
										value={
											formState.values[field.flag] ?? field.initialValue ?? ""
										}
									>
										<SelectTrigger>
											<SelectValue placeholder={field.placeholder} />
										</SelectTrigger>
										<SelectContent>
											{field.options.map((option) => (
												<SelectItem key={option.value} value={option.value}>
													{option.label}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								) : isMultilineField(field) ? (
									<Textarea
										onChange={(event) =>
											updateFieldValue(field.flag, event.target.value)
										}
										placeholder={field.placeholder}
										rows={5}
										value={formState.values[field.flag] ?? ""}
									/>
								) : (
									<Input
										onChange={(event) =>
											updateFieldValue(field.flag, event.target.value)
										}
										placeholder={field.placeholder}
										type={isSecretField(field) ? "password" : "text"}
										value={formState.values[field.flag] ?? ""}
									/>
								)}
							</div>
						))}

						{selectedChannel?.security ? (
							<div className="grid gap-3 rounded-lg border p-3">
								<div className="flex items-center justify-between gap-3">
									<Label className="text-sm">Restrict access</Label>
									<Switch
										checked={formState.securityEnabled}
										onCheckedChange={(checked: boolean) =>
											setFormState((prev) => ({
												...prev,
												securityEnabled: checked,
											}))
										}
									/>
								</div>
								{formState.securityEnabled
									? selectedChannel.security.fields.map((field) => (
											<div className="grid gap-2" key={field.key}>
												<Label>{field.label}</Label>
												<Input
													onChange={(event) =>
														updateSecurityFieldValue(
															field.key,
															event.target.value,
														)
													}
													placeholder={field.placeholder}
													type={isSecretField(field) ? "password" : "text"}
													value={formState.securityValues[field.key] ?? ""}
												/>
											</div>
										))
									: null}
							</div>
						) : null}

						{formError ? (
							<div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
								{formError}
							</div>
						) : null}
					</div>
					<DialogFooter>
						<Button
							disabled={busyChannel !== null}
							onClick={() => setDialogOpen(false)}
							type="button"
							variant="outline"
						>
							Cancel
						</Button>
						<Button
							disabled={busyChannel !== null || !selectedChannel}
							onClick={() => void startConnector()}
							type="button"
						>
							{busyChannel ? "Starting..." : "Add Channel"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			<AlertDialog
				open={removeTarget !== null}
				onOpenChange={(open: boolean) => {
					if (!open) {
						setRemoveTarget(null);
					}
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Remove Channel</AlertDialogTitle>
						<AlertDialogDescription>
							Confirm that you want to stop the active{" "}
							{removeTarget ? connectorName(removeTarget, channels) : "channel"}{" "}
							channel for {removeTarget ? connectorIdentity(removeTarget) : ""}.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={busyChannel !== null}>
							Cancel
						</AlertDialogCancel>
						<AlertDialogAction
							disabled={busyChannel !== null || !removeTarget}
							onClick={() => {
								if (removeTarget) {
									void stopConnector(removeTarget);
								}
							}}
							className={buttonVariants({ variant: "destructive" })}
						>
							Remove
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</PageFrame>
	);
}
