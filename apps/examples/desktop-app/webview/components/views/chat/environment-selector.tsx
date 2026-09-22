"use client";

import { Check, Cloud, Laptop, Loader2, Server, Settings } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getTranslator, useTranslation } from "@/lib/i18n";
import type { RemoteEnvironmentProfile } from "@/lib/remote-environments";
import { LOCAL_WORKSPACE_ENVIRONMENT_ID } from "@/lib/workspace-paths";

export type EnvironmentSelectorOption = {
	id: string;
	label: string;
	kind: "local" | "remote";
	selected: boolean;
};

export type EnvironmentSelectorModel = {
	activeKind: "local" | "remote";
	activeLabel: string;
	local: EnvironmentSelectorOption;
	remotes: EnvironmentSelectorOption[];
};

export type EnvironmentSelectorProps = {
	activeEnvironmentId: string;
	cloudEnabled?: boolean;
	executionTarget?: "local" | "cloud";
	onSelectExecutionTarget?: (target: "local" | "cloud") => void;
	profiles: RemoteEnvironmentProfile[];
	loading?: boolean;
	switchingEnvironmentId?: string | null;
	onSelectEnvironment: (environmentId: string) => void | Promise<void>;
	onAddSshHost: () => void;
};

export function buildEnvironmentSelectorModel(
	activeEnvironmentId: string,
	profiles: RemoteEnvironmentProfile[],
): EnvironmentSelectorModel {
	const t = getTranslator().t;
	const remoteById = new Map<string, EnvironmentSelectorOption>();
	for (const profile of profiles) {
		const id = profile.id?.trim();
		if (!id || remoteById.has(id)) continue;
		const selected = id === activeEnvironmentId;
		remoteById.set(id, {
			id,
			label:
				profile.name.trim() ||
				profile.host.trim() ||
				t("chat.environment.sshHostFallback"),
			kind: "remote",
			selected,
		});
	}
	const remotes = [...remoteById.values()].sort(
		(left, right) =>
			left.label.localeCompare(right.label) || left.id.localeCompare(right.id),
	);
	const localSelected = activeEnvironmentId === LOCAL_WORKSPACE_ENVIRONMENT_ID;
	const activeRemote = remotes.find((option) => option.selected);

	return {
		activeKind: localSelected ? "local" : "remote",
		activeLabel:
			activeRemote?.label ??
			(localSelected
				? t("chat.environment.localLabel")
				: t("chat.environment.remoteLabel")),
		local: {
			id: LOCAL_WORKSPACE_ENVIRONMENT_ID,
			label: t("chat.environment.localLabel"),
			kind: "local",
			selected: localSelected,
		},
		remotes,
	};
}

export function EnvironmentSelector({
	activeEnvironmentId,
	cloudEnabled = false,
	executionTarget = "local",
	onSelectExecutionTarget,
	profiles,
	loading = false,
	switchingEnvironmentId,
	onSelectEnvironment,
	onAddSshHost,
}: EnvironmentSelectorProps) {
	const { t } = useTranslation();
	const model = useMemo(
		() => buildEnvironmentSelectorModel(activeEnvironmentId, profiles),
		[activeEnvironmentId, profiles],
	);
	const [internalSwitchingId, setInternalSwitchingId] = useState<string | null>(
		null,
	);
	const [open, setOpen] = useState(false);
	const pendingEnvironmentId = switchingEnvironmentId ?? internalSwitchingId;
	const busy = loading || pendingEnvironmentId !== null;
	const cloudSelected = executionTarget === "cloud";
	const activeLabel = cloudSelected
		? t("chat.environment.cloudLabel")
		: model.activeLabel;
	const ActiveIcon = cloudSelected
		? Cloud
		: model.activeKind === "remote"
			? Server
			: Laptop;

	const selectEnvironment = async (environmentId: string) => {
		if (busy || (!cloudSelected && environmentId === activeEnvironmentId))
			return;
		setInternalSwitchingId(environmentId);
		try {
			if (cloudSelected) onSelectExecutionTarget?.("local");
			if (environmentId !== activeEnvironmentId) {
				await onSelectEnvironment(environmentId);
			}
		} catch {
			// The parent owns connection errors and their user-facing presentation;
			// reopen so the failed choice does not strand the user at a closed menu.
			setOpen(true);
		} finally {
			setInternalSwitchingId(null);
		}
	};

	const optionStatus = (option: EnvironmentSelectorOption) => {
		if (pendingEnvironmentId === option.id) {
			return (
				<span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
					<Loader2 className="size-3 animate-spin" />
					{t("chat.environment.connecting")}
				</span>
			);
		}
		return null;
	};

	return (
		<DropdownMenu onOpenChange={setOpen} open={open}>
			<DropdownMenuTrigger asChild>
				<Button
					aria-label={t("chat.environment.ariaTemplate", {
						label: activeLabel,
					})}
					className="size-9 shrink-0 rounded-md border border-border/70 bg-background/80 p-0 text-foreground shadow-none transition-colors hover:bg-accent hover:text-foreground"
					disabled={busy}
					id="environment-selector-btn"
					title={t("chat.environment.ariaTemplate", { label: activeLabel })}
					variant="ghost"
				>
					{busy ? (
						<Loader2 className="size-4 animate-spin" />
					) : (
						<ActiveIcon className="size-4" />
					)}
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start" className="w-72" side="bottom">
				<DropdownMenuItem
					aria-current={
						!cloudSelected && model.local.selected ? "true" : undefined
					}
					className="aria-current:bg-purple-500/20 aria-current:focus:bg-purple-500/25"
					disabled={busy}
					onSelect={() => void selectEnvironment(model.local.id)}
				>
					<Laptop />
					<span className="uppercase">{model.local.label}</span>
					{optionStatus(model.local)}
					{!cloudSelected && model.local.selected ? (
						<Check className="ml-auto" />
					) : null}
				</DropdownMenuItem>

				<DropdownMenuSeparator />
				<DropdownMenuItem
					aria-current={cloudSelected ? "true" : undefined}
					className="aria-current:bg-purple-500/20 aria-current:focus:bg-purple-500/25"
					disabled={!cloudEnabled || busy}
					onSelect={() => {
						if (!cloudSelected) onSelectExecutionTarget?.("cloud");
					}}
				>
					<Cloud className="size-4" />
					<span className="uppercase">{t("chat.environment.cloudLabel")}</span>
					{!cloudEnabled ? (
						<span className="ml-auto rounded bg-muted px-1.5 py-0.5 text-[10px] font-normal normal-case tracking-normal text-muted-foreground">
							{t("chat.environment.comingSoon")}
						</span>
					) : cloudSelected ? (
						<Check className="ml-auto" />
					) : null}
				</DropdownMenuItem>

				<DropdownMenuSeparator />
				<div className="flex items-center justify-between">
					<DropdownMenuLabel className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
						<Server className="size-4" />
						{t("chat.environment.remoteLabel")}
					</DropdownMenuLabel>
					<DropdownMenuItem
						aria-label={t("chat.environment.addSshHost")}
						title={t("chat.environment.addSshHost")}
						className="mr-1 size-6 justify-center p-0"
						disabled={busy}
						onSelect={onAddSshHost}
					>
						<Settings className="size-3.5" />
					</DropdownMenuItem>
				</div>
				{model.remotes.length > 0 ? (
					model.remotes.map((option) => (
						<DropdownMenuItem
							aria-current={
								!cloudSelected && option.selected ? "true" : undefined
							}
							className="aria-current:bg-purple-500/20 aria-current:focus:bg-purple-500/25"
							disabled={busy}
							key={option.id}
							onSelect={() => void selectEnvironment(option.id)}
						>
							<span className="min-w-0 flex-1 truncate">{option.label}</span>
							{optionStatus(option)}
							{!cloudSelected && option.selected ? (
								<Check className="ml-auto" />
							) : null}
						</DropdownMenuItem>
					))
				) : (
					<DropdownMenuItem disabled>
						<span className="text-muted-foreground">
							{t("chat.environment.noSshHosts")}
						</span>
					</DropdownMenuItem>
				)}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
