"use client";

import { Cpu, Loader2, Play, Settings2, Square } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import { desktopClient } from "@/lib/desktop-client";
import {
	DEFAULT_LOCAL_CONTEXT_WINDOW,
	describeModelPlacement,
	describeUnloadTime,
	formatContext,
	formatMemory,
	getMachineMemoryBytes,
	LOCAL_RUNTIMES,
	type LocalModelsStatus,
	type LocalRuntime,
	normalizeLocalModelName,
} from "@/lib/local-models";
import { cn } from "@/lib/utils";

const POLL_MS = 15_000;

/**
 * Composer chip for the Ollama and LM Studio providers: whether the selected
 * model is in memory, how much it takes, and shortcuts to unload it or manage
 * models.
 */
export function LocalModelIndicator({
	runtime,
	model,
	isBusy,
	onOpenLocalModels,
}: {
	runtime: LocalRuntime;
	model: string;
	isBusy: boolean;
	onOpenLocalModels?: () => void;
}) {
	const [status, setStatus] = useState<LocalModelsStatus>();
	const [pending, setPending] = useState<string>();
	const [error, setError] = useState<string>();
	const [open, setOpen] = useState(false);

	const refresh = useCallback(async () => {
		try {
			setStatus(
				await desktopClient.invoke<LocalModelsStatus>(
					"get_local_models_status",
					{ runtime },
				),
			);
		} catch {
			// Keep showing the last known state.
		}
	}, [runtime]);

	// The runtime loads the model when a message arrives, and unloads it after
	// idling, so re-check around turns and periodically.
	// biome-ignore lint/correctness/useExhaustiveDependencies: isBusy is a refresh trigger.
	useEffect(() => {
		void refresh();
	}, [refresh, isBusy, model]);
	useEffect(() => {
		const timer = window.setInterval(() => void refresh(), POLL_MS);
		const onFocus = () => void refresh();
		window.addEventListener("focus", onFocus);
		return () => {
			window.clearInterval(timer);
			window.removeEventListener("focus", onFocus);
		};
	}, [refresh]);

	if (!status || status.runtime !== runtime || !model) {
		return null;
	}

	const { name } = LOCAL_RUNTIMES[runtime];
	const selected = normalizeLocalModelName(runtime, model);
	const running = status.running.find(
		(entry) => normalizeLocalModelName(runtime, entry.name) === selected,
	);
	const placement = running ? describeModelPlacement(running) : undefined;
	const others = status.running.filter((entry) => entry !== running);
	const machineMemoryBytes = getMachineMemoryBytes(status.hardware);

	const run = async (key: string, task: () => Promise<unknown>) => {
		setPending(key);
		setError(undefined);
		try {
			await task();
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : String(reason));
		} finally {
			setPending(undefined);
			void refresh();
		}
	};
	const unload = (entryName: string) =>
		run(`unload:${entryName}`, () =>
			desktopClient.invoke("unload_local_model", {
				runtime,
				model: entryName,
			}),
		);

	const label = !status.reachable
		? `${name} offline`
		: running
			? formatMemory(running.sizeBytes)
			: "Not loaded";

	return (
		<Popover
			onOpenChange={(next) => {
				setOpen(next);
				if (next) void refresh();
			}}
			open={open}
		>
			<PopoverTrigger asChild>
				<button
					aria-label={`Local model: ${label}`}
					className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-sm text-muted-foreground hover:bg-surface-hover data-[state=open]:bg-surface-hover group-data-[compact]/composer:size-7 group-data-[compact]/composer:justify-center group-data-[compact]/composer:p-0"
					title={
						running
							? `${selected} is loaded and using ${formatMemory(running.sizeBytes)} of memory`
							: label
					}
					type="button"
				>
					<span className="relative">
						<Cpu className="size-3" />
						<span
							className={cn(
								"absolute -right-0.5 -bottom-0.5 size-1.5 rounded-full ring-1 ring-background",
								!status.reachable
									? "bg-destructive"
									: running
										? "bg-emerald-500"
										: "bg-muted-foreground/50",
							)}
						/>
					</span>
					<span className="group-data-[compact]/composer:sr-only">{label}</span>
				</button>
			</PopoverTrigger>
			<PopoverContent
				align="start"
				className="flex w-80 flex-col gap-3 p-4"
				side="top"
				sideOffset={8}
			>
				<div className="flex flex-col gap-0.5">
					<span className="text-xs text-muted-foreground">Local model</span>
					<span className="truncate font-mono text-sm text-foreground">
						{selected}
					</span>
				</div>

				{!status.reachable ? (
					<>
						<p className="text-sm text-muted-foreground">
							{status.install?.installed
								? `${name} is installed but not running.`
								: `Cline can't reach ${name}.`}
						</p>
						{status.install?.installed && status.install.localServer ? (
							<Button
								disabled={!!pending}
								onClick={() =>
									void run("start", () =>
										desktopClient.invoke(
											"start_local_runtime",
											{ runtime },
											{ timeoutMs: 75_000 },
										),
									)
								}
								size="sm"
								type="button"
							>
								{pending === "start" ? (
									<Loader2 className="animate-spin" />
								) : (
									<Play />
								)}
								Start {name}
							</Button>
						) : null}
					</>
				) : running ? (
					<div className="flex flex-col gap-1.5">
						<div className="flex items-baseline justify-between text-sm">
							<span className="text-foreground">
								{placement ? `Loaded ${placement}` : "Loaded"}
							</span>
							<span className="text-xs text-muted-foreground">
								{formatMemory(running.sizeBytes)} of{" "}
								{formatMemory(machineMemoryBytes)}
							</span>
						</div>
						<Progress
							aria-label="Memory used by this model"
							className="h-1.5"
							value={(running.sizeBytes / machineMemoryBytes) * 100}
						/>
						<span className="text-xs text-muted-foreground">
							{[
								running.contextLength > 0
									? formatContext(running.contextLength)
									: "",
								describeUnloadTime(running.expiresAtMs) ?? "",
							]
								.filter(Boolean)
								.join(" · ")}
						</span>
						<Button
							disabled={!!pending || isBusy}
							onClick={() => void unload(running.name)}
							size="sm"
							title={
								isBusy ? "Wait for the current response to finish" : undefined
							}
							type="button"
							variant="outline"
						>
							{pending === `unload:${running.name}` ? (
								<Loader2 className="animate-spin" />
							) : (
								<Square />
							)}
							Unload and free memory
						</Button>
					</div>
				) : (
					<>
						<p className="text-sm text-muted-foreground">
							Not in memory. {name} loads it when you send a message, which can
							take a while for large models.
						</p>
						<Button
							disabled={!!pending}
							onClick={() =>
								void run("load", () =>
									desktopClient.invoke(
										"load_local_model",
										{
											runtime,
											model: selected,
											// Match what chat requests send so the runtime doesn't reload on the first message.
											contextWindow:
												status.contextWindow ?? DEFAULT_LOCAL_CONTEXT_WINDOW,
										},
										{ timeoutMs: null },
									),
								)
							}
							size="sm"
							type="button"
							variant="outline"
						>
							{pending === "load" ? (
								<Loader2 className="animate-spin" />
							) : (
								<Play />
							)}
							{pending === "load" ? "Loading…" : "Load now"}
						</Button>
					</>
				)}

				{others.length > 0 ? (
					<div className="flex flex-col gap-1.5 border-t pt-3">
						<span className="text-xs text-muted-foreground">Also loaded</span>
						{others.map((entry) => (
							<div className="flex items-center gap-2 text-xs" key={entry.name}>
								<span className="min-w-0 flex-1 truncate font-mono text-foreground">
									{entry.name}
								</span>
								<span className="text-muted-foreground">
									{formatMemory(entry.sizeBytes)}
								</span>
								<Button
									aria-label={`Unload ${entry.name}`}
									disabled={!!pending}
									onClick={() => void unload(entry.name)}
									size="xs"
									type="button"
									variant="ghost"
								>
									{pending === `unload:${entry.name}` ? (
										<Loader2 className="animate-spin" />
									) : (
										<Square />
									)}
									Unload
								</Button>
							</div>
						))}
					</div>
				) : null}

				{error ? (
					<p className="break-words text-xs text-destructive" role="alert">
						{error}
					</p>
				) : null}

				{onOpenLocalModels ? (
					<Button
						className="justify-start"
						onClick={() => {
							// The composer stays mounted behind settings, so close explicitly.
							setOpen(false);
							onOpenLocalModels();
						}}
						size="sm"
						type="button"
						variant="ghost"
					>
						<Settings2 />
						Local model settings
					</Button>
				) : null}
			</PopoverContent>
		</Popover>
	);
}
