import { CopyIcon, ExternalLinkIcon, SmartphoneIcon } from "lucide-react";
import type { WebviewDeviceBridgeState } from "../../../../webview-protocol";
import { Button } from "@/components/ui/button";
import { postToHost } from "../../vscode";

export function DeviceBridgeCard({
	state,
	hubUrl,
	connected,
}: {
	state?: WebviewDeviceBridgeState;
	hubUrl?: string;
	connected: boolean;
}) {
	const status = state?.status ?? "stopped";
	const running = status === "running" || status === "external";
	const mismatch = Boolean(running && state?.hubUrl && state.hubUrl !== hubUrl);
	const label =
		status === "starting"
			? "Starting…"
			: status === "external"
				? "Started separately"
				: status === "running"
					? "Running"
					: status === "error"
						? "Failed to start"
						: "Stopped";
	return (
		<section
			className="mb-6 max-w-[86rem] overflow-hidden rounded-lg border bg-card"
			aria-label="Device bridge"
		>
			<div className="flex min-h-11 items-center justify-between gap-3 border-b bg-muted/40 px-4 py-2">
				<h2 className="flex items-center gap-2 text-[17px] font-medium text-muted-foreground">
					<SmartphoneIcon className="size-4" />
					Device bridge
				</h2>
				<div className="flex items-center gap-3">
					<span className="text-xs text-muted-foreground">{label}</span>
					{status === "running" && (
						<Button
							size="sm"
							variant="outline"
							disabled={!connected}
							onClick={() => postToHost({ type: "pair_device_bridge" })}
						>
							Pair device
						</Button>
					)}
					{status === "running" ? (
						<Button
							size="sm"
							variant="outline"
							onClick={() => postToHost({ type: "stop_device_bridge" })}
						>
							Stop bridge
						</Button>
					) : (
						<Button
							size="sm"
							variant="outline"
							disabled={
								!connected || status === "starting" || status === "external"
							}
							onClick={() => postToHost({ type: "start_device_bridge" })}
						>
							{status === "starting" ? "Starting…" : "Start bridge"}
						</Button>
					)}
				</div>
			</div>
			<div className="space-y-3 px-4 py-3 text-sm">
				{!running && !state?.error && (
					<p className="text-muted-foreground">
						Connect your Cline device or browser device to this hub.
					</p>
				)}
				{state?.error && (
					<p role="alert" className="text-destructive">
						{state.error}
					</p>
				)}
				{mismatch && (
					<p role="alert" className="text-destructive">
						This bridge is connected to {state?.hubUrl}, while this dashboard
						uses {hubUrl}. Stop the bridge in its terminal, then start it here
						to use the same hub.
					</p>
				)}
				{running && state?.hubUrl && !state.hubConnected && (
					<p className="text-muted-foreground">
						Waiting for the bridge to connect to its hub.
					</p>
				)}
				{state?.deviceEndpoint && (
					<div className="flex flex-wrap items-center gap-2">
						<span className="w-16 text-muted-foreground">Device</span>
						<code className="break-all text-xs">{state.deviceEndpoint}</code>
						<Button
							size="icon"
							variant="ghost"
							className="size-6"
							aria-label="Copy device endpoint"
							onClick={() =>
								void navigator.clipboard?.writeText(state.deviceEndpoint!)
							}
						>
							<CopyIcon className="size-3.5" />
						</Button>
					</div>
				)}
				{state?.browserEndpoint && (
					<div className="flex flex-wrap items-center gap-2">
						<span className="w-16 text-muted-foreground">Browser</span>
						<a
							href={state.browserEndpoint}
							target="_blank"
							rel="noreferrer"
							className="inline-flex items-center gap-1 break-all text-xs underline underline-offset-4"
						>
							{state.browserEndpoint}
							<ExternalLinkIcon className="size-3.5 shrink-0" />
						</a>
					</div>
				)}
				{state?.browserEndpoint?.startsWith("https:") && (
					<p className="text-xs text-muted-foreground">
						Accept the self-signed certificate warning once when opening the
						browser device.
					</p>
				)}
				{status === "running" && state?.pairing && (
					<div className="space-y-2 rounded-md border bg-muted/30 p-3">
						<div className="flex items-center gap-3">
							<span className="text-muted-foreground">Pairing code</span>
							<code className="text-xl font-semibold tracking-widest">
								{state.pairing.code}
							</code>
							<Button
								size="icon"
								variant="ghost"
								className="size-6"
								aria-label="Copy pairing code"
								onClick={() =>
									void navigator.clipboard?.writeText(state.pairing!.code)
								}
							>
								<CopyIcon className="size-3.5" />
							</Button>
						</div>
						<p className="text-xs text-muted-foreground">
							Enter this code in the device’s setup page. Valid until{" "}
							{new Date(state.pairing.expiresAt).toLocaleTimeString([], {
								hour: "numeric",
								minute: "2-digit",
							})}
							; used once. Pair device generates a new code.
						</p>
					</div>
				)}
				{running && (
					<div className="border-t pt-3">
						<p className="mb-1 text-xs font-medium text-muted-foreground">
							Connected devices ({state?.devices.length ?? 0})
						</p>
						{state?.devices.length ? (
							<ul className="space-y-1">
								{state.devices.map((name, index) => (
									<li
										key={`${name}-${index}`}
										className="flex items-center gap-2"
									>
										<span className="size-1.5 rounded-full bg-emerald-500" />
										{name}
									</li>
								))}
							</ul>
						) : (
							<p className="text-xs text-muted-foreground">
								No devices connected yet.
							</p>
						)}
					</div>
				)}
			</div>
		</section>
	);
}
