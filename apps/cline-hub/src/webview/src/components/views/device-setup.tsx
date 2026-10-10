import type { DeviceSetupState } from "@cline/core/hub";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { WebviewOutboundMessage } from "../../../../webview-protocol";
import { postToHost } from "../../vscode";

export function DeviceSetup({ connected }: { connected: boolean }) {
	const [open, setOpen] = useState(false);
	const [setup, setSetup] = useState<DeviceSetupState | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const [ssid, setSsid] = useState("");
	const [password, setPassword] = useState("");
	const [host, setHost] = useState("");
	useEffect(() => {
		const receive = (event: MessageEvent<WebviewOutboundMessage>) => {
			if (event.data?.type !== "device_setup") return;
			setBusy(false);
			setError(event.data.error ?? "");
			if (!event.data.error) setSetup(event.data.setup);
		};
		window.addEventListener("message", receive);
		return () => window.removeEventListener("message", receive);
	}, []);
	useEffect(() => {
		if (
			!open ||
			(setup?.status !== "confirm" && setup?.status !== "approved") ||
			!connected ||
			busy
		)
			return;
		const timer = setInterval(
			() => postToHost({ type: "setup_device", action: "status" }),
			1500,
		);
		return () => clearInterval(timer);
	}, [open, setup?.status, connected, busy]);
	function cancel() {
		postToHost({ type: "setup_device", action: "cancel" });
		setPassword("");
		setSetup(null);
		setOpen(false);
		setBusy(false);
		setError("");
	}
	return (
		<div className="space-y-3 rounded-md border p-3">
			<Button
				size="sm"
				variant="outline"
				disabled={!connected}
				onClick={() => {
					if (open) cancel();
					else setOpen(true);
				}}
			>
				Set up device
			</Button>
			{open && (
				<div className="max-w-lg space-y-3">
					<p>
						Connect this computer to the device’s{" "}
						<strong>ClineDevice-XXXX</strong> Wi-Fi. Keep this local dashboard
						open.
					</p>
					{!setup && (
						<Button
							disabled={!connected || busy}
							onClick={() => {
								setBusy(true);
								setError("");
								postToHost({ type: "setup_device", action: "start" });
							}}
						>
							Connect to device
						</Button>
					)}
					{setup && setup.status !== "saved" && (
						<div>
							<p>Compare this code with the code on your device:</p>
							<p className="text-2xl font-semibold tracking-widest">
								{setup.code}
							</p>
							<p>
								{setup.status === "confirm"
									? "If they match, press Confirm on the device (Y on Cardputer). No Wi-Fi credentials have been sent."
									: setup.status === "approved"
										? "Confirmed on the device. You can now send Wi-Fi settings."
										: "Setup was rejected or expired. Cancel and start again."}
							</p>
						</div>
					)}
					{setup?.status === "approved" && (
						<form
							className="space-y-3"
							onSubmit={(event) => {
								event.preventDefault();
								setBusy(true);
								setError("");
								postToHost({
									type: "setup_device",
									action: "save",
									settings: { ssid, password, host },
								});
								setPassword("");
							}}
						>
							<label htmlFor="device-wifi-ssid" className="block space-y-1">
								<span>2.4 GHz Wi-Fi name</span>
								<Input
									id="device-wifi-ssid"
									value={ssid}
									onChange={(e) => setSsid(e.target.value)}
									maxLength={32}
									required
									autoComplete="off"
								/>
							</label>
							<label htmlFor="device-wifi-password" className="block space-y-1">
								<span>Wi-Fi password</span>
								<Input
									id="device-wifi-password"
									type="password"
									value={password}
									onChange={(e) => setPassword(e.target.value)}
									maxLength={63}
									autoComplete="off"
								/>
							</label>
							<label htmlFor="device-wifi-host" className="block space-y-1">
								<span>Computer’s home-network address (optional)</span>
								<Input
									id="device-wifi-host"
									value={host}
									onChange={(e) => setHost(e.target.value)}
									placeholder="192.168.1.50:25470"
									autoComplete="off"
								/>
							</label>
							<p className="text-xs text-muted-foreground">
								Leave the address blank to discover the hub after joining Wi-Fi.
								Settings are encrypted for this confirmed device. The hub does
								not save your Wi-Fi password.
							</p>
							<Button type="submit" disabled={busy || !connected}>
								Save Wi-Fi and pair
							</Button>
						</form>
					)}
					{setup?.status === "saved" && (
						<output>
							Settings saved. The device is restarting. Reconnect this computer
							to your home Wi-Fi; the device will pair automatically.
						</output>
					)}
					{error && (
						<p role="alert" className="text-destructive">
							{error}
						</p>
					)}
					<Button size="sm" variant="ghost" onClick={cancel}>
						{setup?.status === "saved" ? "Done" : "Cancel setup"}
					</Button>
				</div>
			)}
		</div>
	);
}
