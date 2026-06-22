"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Circle, MessageCircle, Plus, RefreshCw, Trash2 } from "lucide-react";
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
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type {
	ActiveConnector,
	ConnectorChannel,
	ConnectorChannelsResponse,
	ConnectorField,
	ConnectorSecurityField,
	useClineHubClient,
} from "@/lib/hub-client";
import { cn } from "@/lib/utils";

type HubClient = ReturnType<typeof useClineHubClient>;

type ConnectorFormState = {
	channelId: string;
	values: Record<string, string>;
	securityEnabled: boolean;
	securityValues: Record<string, string>;
};

interface StepConnectorsProps {
	connectors: ActiveConnector[];
	connectorNames: Record<string, string>;
	hub: HubClient;
	onUpdate: (
		connectors: ActiveConnector[],
		connectorNames: Record<string, string>,
	) => void;
}

function connectorName(
	connector: ActiveConnector,
	channels: ConnectorChannel[],
	fallbackNames: Record<string, string>,
): string {
	return (
		channels.find((channel) => channel.id === connector.type)?.name ??
		fallbackNames[connector.type] ??
		connector.type
	);
}

function connectorIdentity(connector: ActiveConnector): string {
	if (connector.botUsername) return `@${connector.botUsername}`;
	if (connector.userName) return connector.userName;
	if (connector.applicationId) return connector.applicationId;
	if (connector.phoneNumberId) return connector.phoneNumberId;
	return `pid ${connector.pid}`;
}

function formatDateTime(value?: string): string {
	if (!value) return "-";
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
	if (!condition) return true;
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

function namesByChannel(channels: ConnectorChannel[]): Record<string, string> {
	return Object.fromEntries(
		channels.map((channel) => [channel.id, channel.name]),
	);
}

export function StepConnectors({
	connectors,
	connectorNames,
	hub,
	onUpdate,
}: StepConnectorsProps) {
	const [channels, setChannels] = useState<ConnectorChannel[]>([]);
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

	const applyResponse = useCallback(
		(response: ConnectorChannelsResponse) => {
			const nextNames = namesByChannel(response.available);
			setChannels(response.available);
			setFormState((prev) =>
				prev.channelId ? prev : createFormState(response.available),
			);
			onUpdate(response.active, nextNames);
		},
		[onUpdate],
	);

	const refreshChannels = useCallback(async () => {
		if (!hub.isConnected) {
			setIsLoading(false);
			setErrorMessage("Connect to Cline Hub before adding channels.");
			return;
		}
		setIsLoading(true);
		setErrorMessage(null);
		try {
			const response = await hub.invoke<ConnectorChannelsResponse>(
				"list_connector_channels",
			);
			applyResponse(response);
		} catch (error) {
			setErrorMessage(error instanceof Error ? error.message : String(error));
		} finally {
			setIsLoading(false);
		}
	}, [applyResponse, hub.invoke, hub.isConnected]);

	useEffect(() => {
		void refreshChannels();
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
			if (!visibleFields.includes(field)) continue;
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
			const response = await hub.invoke<ConnectorChannelsResponse>(
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
			setFormError(error instanceof Error ? error.message : String(error));
		} finally {
			setBusyChannel(null);
		}
	};

	const stopConnector = async (connector: ActiveConnector) => {
		setBusyChannel(connector.type);
		setErrorMessage(null);
		try {
			const response = await hub.invoke<ConnectorChannelsResponse>(
				"stop_connector_channel",
				{ channel: connector.type },
			);
			applyResponse(response);
			setRemoveTarget(null);
		} catch (error) {
			setErrorMessage(error instanceof Error ? error.message : String(error));
		} finally {
			setBusyChannel(null);
		}
	};

	return (
		<div className="px-4 text-center">
			<motion.h2
				initial={{ opacity: 0, y: -10 }}
				animate={{ opacity: 1, y: 0 }}
				className="mb-3 text-balance text-2xl font-bold text-foreground sm:text-3xl"
			>
				Connect Cline
			</motion.h2>
			<motion.p
				initial={{ opacity: 0 }}
				animate={{ opacity: 1 }}
				transition={{ delay: 0.1 }}
				className="mb-6 text-sm text-muted-foreground sm:text-base"
			>
				Start and manage messaging channels.
			</motion.p>

			<div className="mx-auto max-w-lg space-y-3">
				<div className="flex items-center justify-between gap-3">
					<p className="text-left text-xs text-muted-foreground">
						{connectors.length} connected
					</p>
					<Button
						disabled={isLoading || !hub.isConnected}
						onClick={() => void refreshChannels()}
						size="sm"
						type="button"
						variant="outline"
					>
						<RefreshCw
							className={cn("size-4", isLoading && "animate-spin")}
						/>
						Refresh
					</Button>
				</div>

				{errorMessage ? (
					<div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-left text-sm text-destructive">
						{errorMessage}
					</div>
				) : null}

				<AnimatePresence mode="popLayout">
					{connectors.map((connector) => (
						<motion.div
							key={connector.id}
							layout
							initial={{ opacity: 0, scale: 0.95 }}
							animate={{ opacity: 1, scale: 1 }}
							exit={{ opacity: 0, scale: 0.95 }}
							className="overflow-hidden rounded-lg border-2 border-border bg-card p-4 text-left"
						>
							<div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
								<div className="min-w-0">
									<div className="flex items-center gap-2">
										<Circle className="size-2 fill-emerald-400 text-emerald-400" />
										<p className="truncate font-semibold text-foreground">
											{connectorName(connector, channels, connectorNames)}
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
									Remove
								</Button>
							</div>
						</motion.div>
					))}
				</AnimatePresence>

				{isLoading ? (
					<div className="rounded-lg border border-border bg-card px-4 py-8 text-sm text-muted-foreground">
						Loading channels...
					</div>
				) : connectors.length === 0 ? (
					<div className="rounded-lg border border-border bg-card px-4 py-8 text-sm text-muted-foreground">
						No channels connected.
					</div>
				) : null}

				<Button
					className="h-auto w-full justify-center rounded-xl border-2 border-dashed py-4"
					disabled={!hub.isConnected || channels.length === 0}
					onClick={openAddDialog}
					type="button"
					variant="outline"
				>
					<Plus className="size-5" />
					Add Connector
				</Button>
				<p className="text-sm text-muted-foreground">
					Add a connector or skip this step.
				</p>
			</div>

			<Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
				<DialogContent className="max-h-[86vh] overflow-y-auto sm:max-w-xl">
					<DialogHeader>
						<DialogTitle>Add Connector</DialogTitle>
						<DialogDescription>
							Start a connector channel through Cline Hub.
						</DialogDescription>
					</DialogHeader>
					<div className="grid gap-4 py-2 text-left">
						<div className="grid gap-2">
							<Label>Channel</Label>
							<Select
								onValueChange={(value) => {
									if (!value) return;
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
								<SelectTrigger className="w-full">
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
							{selectedChannel?.hint ? (
								<p className="text-xs text-muted-foreground">
									{selectedChannel.hint}
								</p>
							) : null}
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
											if (value) updateFieldValue(field.flag, value);
										}}
										value={
											formState.values[field.flag] ?? field.initialValue ?? ""
										}
									>
										<SelectTrigger className="w-full">
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
								{field.help?.length ? (
									<p className="text-xs text-muted-foreground">
										{field.help.join(" ")}
									</p>
								) : null}
							</div>
						))}

						{selectedChannel?.security ? (
							<div className="grid gap-3 rounded-lg border p-3">
								<div className="flex items-center justify-between gap-3">
									<div>
										<Label className="text-sm">Restrict access</Label>
										<p className="mt-1 text-xs text-muted-foreground">
											{selectedChannel.security.prompt}
										</p>
									</div>
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
												{field.help?.length ? (
													<p className="text-xs text-muted-foreground">
														{field.help.join(" ")}
													</p>
												) : null}
											</div>
										))
									: null}
							</div>
						) : null}

						{formError ? (
							<div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
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
							{busyChannel ? "Starting..." : "Add Connector"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			<AlertDialog
				open={removeTarget !== null}
				onOpenChange={(open: boolean) => {
					if (!open) setRemoveTarget(null);
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Remove Connector</AlertDialogTitle>
						<AlertDialogDescription>
							Confirm that you want to stop the active{" "}
							{removeTarget
								? connectorName(removeTarget, channels, connectorNames)
								: "connector"}{" "}
							channel for {removeTarget ? connectorIdentity(removeTarget) : ""}.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={busyChannel !== null}>
							Cancel
						</AlertDialogCancel>
						<AlertDialogAction
							className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
							disabled={busyChannel !== null || !removeTarget}
							onClick={() => {
								if (removeTarget) void stopConnector(removeTarget);
							}}
						>
							Remove
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}
