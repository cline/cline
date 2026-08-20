"use client";

import dynamic from "next/dynamic";
import { type FormEvent, useState } from "react";

const DesktopHome = dynamic(
	() => import("../../cline/webview/app/page").then((module) => module.default),
	{ ssr: false },
);

const ENDPOINT_KEY = "cline.gatewayUi.endpoint";
const TOKEN_KEY = "cline.gatewayUi.token";

export default function GatewayUiPage() {
	const [configured, setConfigured] = useState(() =>
		typeof window !== "undefined"
			? Boolean(localStorage.getItem(ENDPOINT_KEY))
			: false,
	);
	const [endpoint, setEndpoint] = useState(() =>
		typeof window !== "undefined"
			? (localStorage.getItem(ENDPOINT_KEY) ??
				"wss://desktop-gateway.35-254-245-28.nip.io/transport")
			: "",
	);
	const [token, setToken] = useState("");

	function connect(event: FormEvent) {
		event.preventDefault();
		localStorage.setItem(ENDPOINT_KEY, endpoint.trim());
		localStorage.setItem(TOKEN_KEY, token.trim());
		setConfigured(true);
	}

	if (configured) return <DesktopHome />;

	return (
		<main className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
			<form
				className="w-full max-w-lg space-y-5 rounded-xl border bg-card p-8"
				onSubmit={connect}
			>
				<div>
					<h1 className="text-2xl font-semibold">Connect to Cline Bots</h1>
					<p className="mt-2 text-sm text-muted-foreground">
						Connect this browser to the headless Cline server on your VM.
					</p>
				</div>
				<label className="block space-y-2 text-sm">
					<span>Server WebSocket</span>
					<input
						className="w-full rounded-md border bg-background px-3 py-2"
						onChange={(event) => setEndpoint(event.target.value)}
						required
						value={endpoint}
					/>
				</label>
				<label className="block space-y-2 text-sm">
					<span>Access token</span>
					<input
						className="w-full rounded-md border bg-background px-3 py-2"
						onChange={(event) => setToken(event.target.value)}
						required
						type="password"
						value={token}
					/>
				</label>
				<button
					className="w-full rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground"
					type="submit"
				>
					Connect
				</button>
			</form>
		</main>
	);
}
