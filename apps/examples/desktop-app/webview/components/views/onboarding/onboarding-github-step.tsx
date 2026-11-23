"use client";

import { GitHubIcon } from "@cline/ui";
import { Loader2, Lock } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	type ClineGitHubRepository,
	fetchGitHubInstallUrl,
	findGitHubIntegration,
	listClineGitHubRepositories,
	listClineIntegrations,
} from "@/lib/cline-integrations";
import { openExternalUrl } from "@/lib/desktop-client";

export const GITHUB_INSTALL_POLL_INTERVAL_MS = 3_000;

type GitHubStepPhase = "checking" | "connect" | "waiting" | "connected";

export function GitHubConnectStep({ onContinue }: { onContinue: () => void }) {
	const [phase, setPhase] = useState<GitHubStepPhase>("checking");
	const [connectError, setConnectError] = useState<string | null>(null);
	const [repos, setRepos] = useState<ClineGitHubRepository[] | null>(null);

	const onContinueRef = useRef(onContinue);
	useEffect(() => {
		onContinueRef.current = onContinue;
	}, [onContinue]);

	useEffect(() => {
		let cancelled = false;
		void (async () => {
			try {
				const result = await listClineIntegrations();
				if (cancelled) {
					return;
				}
				if (
					result.status === "not-authenticated" ||
					findGitHubIntegration(result.integrations)
				) {
					onContinueRef.current();
					return;
				}
				setPhase("connect");
			} catch {
				if (!cancelled) {
					setPhase("connect");
				}
			}
		})();
		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => {
		// The install finishes in the external browser, which cannot navigate the
		// app back, so poll the integrations list until the installation lands.
		if (phase !== "waiting") {
			return;
		}
		let cancelled = false;
		let inFlight = false;
		let interval: ReturnType<typeof setInterval> | undefined;
		const stop = () => {
			cancelled = true;
			if (interval !== undefined) {
				clearInterval(interval);
				interval = undefined;
			}
		};

		async function poll() {
			try {
				const result = await listClineIntegrations();
				if (cancelled) {
					return;
				}
				if (result.status === "not-authenticated") {
					// The account session ended mid-install. Nothing will ever
					// arrive, so stop polling instead of spinning forever.
					stop();
					setConnectError(
						"Your Cline account session ended. Sign in again to connect GitHub.",
					);
					setPhase("connect");
					return;
				}
				if (findGitHubIntegration(result.integrations)) {
					setPhase("connected");
				}
			} catch {
				// Transient failures keep polling; the user can cancel anytime.
			} finally {
				inFlight = false;
			}
		}

		interval = setInterval(() => {
			if (inFlight) {
				return;
			}
			inFlight = true;
			void poll();
		}, GITHUB_INSTALL_POLL_INTERVAL_MS);

		// Covers unmount and every phase change, including the Cancel button.
		return stop;
	}, [phase]);

	useEffect(() => {
		if (phase !== "connected") {
			return;
		}
		let cancelled = false;
		listClineGitHubRepositories()
			.then((result) => {
				if (!cancelled) {
					setRepos(result);
				}
			})
			.catch(() => {
				if (!cancelled) {
					setRepos([]);
				}
			});
		return () => {
			cancelled = true;
		};
	}, [phase]);

	const connect = useCallback(async () => {
		setConnectError(null);
		setPhase("waiting");
		try {
			const url = await fetchGitHubInstallUrl();
			await openExternalUrl(url);
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error);
			setConnectError(`Failed to start the GitHub connection: ${reason}`);
			setPhase("connect");
		}
	}, []);

	if (phase === "checking") {
		return (
			<output
				aria-label="Checking GitHub connection"
				className="flex items-center justify-center py-16"
			>
				<Loader2 className="size-6 animate-spin text-muted-foreground" />
			</output>
		);
	}

	return (
		<>
			<h1 className="text-2xl font-semibold tracking-tight text-foreground">
				Connect GitHub
			</h1>
			<p className="mt-2 text-sm text-muted-foreground">
				Grant Cline access to your GitHub repositories to supercharge it with
				real-world context. You can always do this later from your dashboard.
			</p>

			<div className="mt-6 rounded-2xl border border-border/70 bg-background/60 p-4">
				<div className="flex flex-wrap items-center justify-between gap-3">
					<div className="flex items-center gap-3">
						<span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-secondary text-foreground">
							<GitHubIcon className="size-4" />
						</span>
						<div className="flex items-center gap-2">
							<p className="text-base font-semibold text-foreground">GitHub</p>
							{phase === "connected" ? (
								<Badge
									className="bg-primary/15 text-primary"
									variant="secondary"
								>
									Connected
								</Badge>
							) : (
								<Badge variant="secondary">Not connected</Badge>
							)}
						</div>
					</div>
					{phase === "connect" ? (
						<Button
							className="rounded-full"
							onClick={() => void connect()}
							type="button"
						>
							Connect GitHub
						</Button>
					) : null}
				</div>

				{phase === "waiting" ? (
					<div className="mt-3 flex flex-wrap items-center gap-3">
						<p className="inline-flex items-center gap-2 text-sm text-muted-foreground">
							<Loader2 className="size-4 animate-spin" />
							Finish installing the Cline GitHub App in your browser...
						</p>
						<button
							className="text-sm text-muted-foreground transition-colors hover:text-foreground"
							onClick={() => setPhase("connect")}
							type="button"
						>
							Cancel
						</button>
					</div>
				) : null}

				{connectError ? (
					<p className="mt-2 text-xs text-destructive" role="alert">
						{connectError}
					</p>
				) : null}

				{phase === "connected" ? (
					<div className="mt-4 border-t border-border/70 pt-3">
						<p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
							Accessible repositories
							{repos ? (
								<span className="ml-2 font-normal normal-case">
									({repos.length})
								</span>
							) : null}
						</p>
						{repos === null ? (
							<p className="mt-2 inline-flex items-center gap-2 text-sm text-muted-foreground">
								<Loader2 className="size-4 animate-spin" />
								Loading repositories...
							</p>
						) : repos.length > 0 ? (
							<ul className="mt-2 flex max-h-40 flex-col gap-1 overflow-y-auto pr-1">
								{repos.map((repo) => (
									<li
										className="flex items-center gap-2 text-sm text-foreground"
										key={repo.id ?? repo.full_name}
									>
										<Lock
											aria-hidden="true"
											className={
												repo.private
													? "size-3 shrink-0 text-muted-foreground"
													: "size-3 shrink-0 text-transparent"
											}
										/>
										<span className="truncate">
											{repo.full_name ?? repo.name}
										</span>
									</li>
								))}
							</ul>
						) : (
							<p className="mt-2 text-sm text-muted-foreground">
								No repositories found. You may need to grant access in your
								GitHub App settings.
							</p>
						)}
					</div>
				) : null}
			</div>

			<div className="mt-5 flex justify-center">
				{phase === "connected" ? (
					<Button
						className="h-11 w-full rounded-full text-base"
						onClick={onContinue}
						type="button"
					>
						Continue
					</Button>
				) : (
					<button
						className="text-sm text-muted-foreground transition-colors hover:text-foreground"
						onClick={onContinue}
						type="button"
					>
						Skip for now
					</button>
				)}
			</div>
		</>
	);
}
