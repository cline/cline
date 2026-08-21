"use client";

import dynamic from "next/dynamic";
import { type FormEvent, useState } from "react";

const DesktopHome = dynamic(
	() => import("../../cline/webview/app/page").then((module) => module.default),
	{ ssr: false },
);

const ENDPOINT_KEY = "cline.gatewayUi.endpoint";
const TOKEN_KEY = "cline.gatewayUi.token";

function storedValue(key: string): string {
	return typeof window === "undefined" ? "" : (localStorage.getItem(key) ?? "");
}

async function verifyConnection(
	endpoint: string,
	token: string,
): Promise<void> {
	const url = new URL(endpoint);
	if (url.protocol !== "wss:" && url.protocol !== "ws:") {
		throw new Error(
			"The server address must use wss:// (or ws:// for local development).",
		);
	}
	await new Promise<void>((resolve, reject) => {
		const socket = new WebSocket(endpoint, [
			"cline-desktop-v1",
			`cline-auth.${token}`,
		]);
		const requestId = `verify-${crypto.randomUUID()}`;
		let settled = false;
		const finish = (error?: Error) => {
			if (settled) return;
			settled = true;
			window.clearTimeout(timeout);
			socket.close();
			if (error) reject(error);
			else resolve();
		};
		const timeout = window.setTimeout(() => {
			finish(
				new Error(
					"This socket opened, but it is not responding as a Cline desktop bridge.",
				),
			);
		}, 10_000);
		socket.onopen = () => {
			socket.send(
				JSON.stringify({
					type: "command",
					id: requestId,
					command: "get_process_context",
					args: {},
				}),
			);
		};
		socket.onmessage = (event) => {
			try {
				const message = JSON.parse(String(event.data)) as {
					id?: string;
					ok?: boolean;
					error?: string;
					result?: { gateway?: { status?: string } };
				};
				if (message.id !== requestId) return;
				if (message.ok && message.result?.gateway?.status === "connected") {
					finish();
					return;
				}
				finish(
					new Error(
						message.error ||
							"The server is not exposing a compatible Cline desktop bridge.",
					),
				);
			} catch {
				// Ignore unrelated protocol frames and wait for the verified response.
			}
		};
		socket.onerror = () => {
			finish(new Error("Cannot connect to this Cline server"));
		};
	});
}

export default function GatewayUiPage() {
	const [endpoint, setEndpoint] = useState(() => storedValue(ENDPOINT_KEY));
	const [token, setToken] = useState(() => storedValue(TOKEN_KEY));
	const [configured, setConfigured] = useState(
		() => Boolean(storedValue(ENDPOINT_KEY) && storedValue(TOKEN_KEY)),
	);
	const [connecting, setConnecting] = useState(false);
	const [error, setError] = useState<string>();

	async function connect(event: FormEvent) {
		event.preventDefault();
		setConnecting(true);
		setError(undefined);
		const normalizedEndpoint = endpoint.trim();
		const normalizedToken = token.trim();
		try {
			await verifyConnection(normalizedEndpoint, normalizedToken);
			localStorage.setItem(ENDPOINT_KEY, normalizedEndpoint);
			localStorage.setItem(TOKEN_KEY, normalizedToken);
			setConfigured(true);
		} catch (connectionError) {
			setError(
				connectionError instanceof Error
					? connectionError.message
					: String(connectionError),
			);
		} finally {
			setConnecting(false);
		}
	}

	if (configured) {
		return (
			<>
				<DesktopHome />
				<button
					className="fixed right-3 top-3 z-[100] rounded-md border bg-background/90 px-3 py-1.5 text-xs text-foreground shadow-sm backdrop-blur hover:bg-accent"
					onClick={() => setConfigured(false)}
					type="button"
				>
					Change server
				</button>
			</>
		);
	}

	return (
		<main className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
			<form
				className="w-full max-w-lg space-y-5 rounded-xl border bg-card p-8 shadow-lg"
				onSubmit={connect}
			>
				<div>
					<h1 className="text-2xl font-semibold">Connect to Cline Bots</h1>
					<p className="mt-2 text-sm text-muted-foreground">
						Use this unified client with any Cline server you control.
					</p>
				</div>
				<label className="block space-y-2 text-sm">
					<span>Server WebSocket</span>
					<input
						className="w-full rounded-md border bg-background px-3 py-2"
						onChange={(event) => setEndpoint(event.target.value)}
						placeholder="wss://your-cline-server.example.com/"
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
				{error ? (
					<p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
						{error}
					</p>
				) : null}
				<button
					className="w-full rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground disabled:opacity-60"
					disabled={connecting}
					type="submit"
				>
					{connecting ? "Connecting…" : "Connect"}
				</button>
				<p className="text-xs leading-relaxed text-muted-foreground">
					Your server address and token stay in this browser and are sent only
					directly to the server you choose.
				</p>
			</form>
		</main>
	);
}
