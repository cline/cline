"use client";

import { Check, Cloud, Laptop, Loader2, Plus, Server } from "lucide-react";
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
import {
	formatRemoteEnvironmentDestination,
	type RemoteEnvironmentProfile,
} from "@/lib/remote-environments";
import { LOCAL_WORKSPACE_ENVIRONMENT_ID } from "@/lib/workspace-paths";

export type EnvironmentSelectorOption = {
	id: string;
	label: string;
	destination?: string;
	kind: "local" | "remote";
	selected: boolean;
	status?: "Active" | "Connected";
};

export type EnvironmentSelectorModel = {
	activeKind: "local" | "remote";
	activeLabel: string;
	local: EnvironmentSelectorOption;
	remotes: EnvironmentSelectorOption[];
};

export type EnvironmentSelectorProps = {
	activeEnvironmentId: string;
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
	const remoteById = new Map<string, EnvironmentSelectorOption>();
	for (const profile of profiles) {
		const id = profile.id?.trim();
		if (!id || remoteById.has(id)) continue;
		const selected = id === activeEnvironmentId;
		remoteById.set(id, {
			id,
			label: profile.name.trim() || profile.host.trim() || "SSH host",
			destination: formatRemoteEnvironmentDestination(profile),
			kind: "remote",
			selected,
			status: selected ? "Connected" : undefined,
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
		activeLabel: activeRemote?.label ?? (localSelected ? "Local" : "Remote"),
		local: {
			id: LOCAL_WORKSPACE_ENVIRONMENT_ID,
			label: "Local",
			kind: "local",
			selected: localSelected,
			status: localSelected ? "Active" : undefined,
		},
		remotes,
	};
}

export function EnvironmentSelector({
	activeEnvironmentId,
	profiles,
	loading = false,
	switchingEnvironmentId,
	onSelectEnvironment,
	onAddSshHost,
}: EnvironmentSelectorProps) {
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
	const ActiveIcon = model.activeKind === "remote" ? Server : Laptop;

	const selectEnvironment = async (environmentId: string) => {
		if (busy || environmentId === activeEnvironmentId) return;
		setInternalSwitchingId(environmentId);
		try {
			await onSelectEnvironment(environmentId);
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
					Connecting
				</span>
			);
		}
		if (option.status) {
			return (
				<span className="ml-auto text-xs text-muted-foreground">
					{option.status}
				</span>
			);
		}
		return null;
	};

	return (
		<DropdownMenu onOpenChange={setOpen} open={open}>
			<DropdownMenuTrigger asChild>
				<Button
					aria-label={`Environment: ${model.activeLabel}`}
					className="size-9 shrink-0 rounded-md border border-border/70 bg-background/80 p-0 text-foreground shadow-none transition-colors hover:bg-accent hover:text-foreground"
					disabled={busy}
					id="environment-selector-btn"
					title={`Environment: ${model.activeLabel}`}
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
					aria-current={model.local.selected ? "true" : undefined}
					disabled={busy}
					onSelect={() => void selectEnvironment(model.local.id)}
				>
					<Laptop />
					<span>Local</span>
					{optionStatus(model.local)}
					{model.local.selected ? <Check className="ml-1" /> : null}
				</DropdownMenuItem>

				<DropdownMenuSeparator />
				<DropdownMenuLabel className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
					Remote
				</DropdownMenuLabel>
				{model.remotes.length > 0 ? (
					model.remotes.map((option) => (
						<DropdownMenuItem
							aria-current={option.selected ? "true" : undefined}
							disabled={busy}
							key={option.id}
							onSelect={() => void selectEnvironment(option.id)}
						>
							<Server />
							<span className="min-w-0 flex-1">
								<span className="block truncate">{option.label}</span>
								{option.destination ? (
									<span className="block truncate font-mono text-[10px] text-muted-foreground">
										{option.destination}
									</span>
								) : null}
							</span>
							{optionStatus(option)}
							{option.selected ? <Check className="ml-1" /> : null}
						</DropdownMenuItem>
					))
				) : (
					<DropdownMenuItem disabled>
						<Server />
						<span className="text-muted-foreground">No SSH hosts saved</span>
					</DropdownMenuItem>
				)}

				<DropdownMenuSeparator />
				<DropdownMenuLabel className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
					Cloud
				</DropdownMenuLabel>
				<DropdownMenuItem disabled>
					<Cloud />
					<span>Cloud</span>
					<span className="ml-auto rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
						Coming soon
					</span>
				</DropdownMenuItem>

				<DropdownMenuSeparator />
				<DropdownMenuItem disabled={busy} onSelect={onAddSshHost}>
					<Plus />
					<span>Add SSH Host</span>
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
