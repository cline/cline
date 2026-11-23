"use client";

import { FolderLock } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { desktopClient } from "@/lib/desktop-client";

// Folders confirmed trusted during this run, so returning to one renders
// straight away instead of waiting on the sidecar again.
const trustedPaths = new Set<string>();

/**
 * Whether Cline may start working in `path`. A folder's rules, skills, hooks,
 * and plugins load automatically, so nothing that reads them may render until
 * the status is "trusted". An empty path (no project) is always trusted.
 */
export function useWorkspaceTrust(path: string) {
	const [checked, setChecked] = useState<{ path: string; trusted: boolean }>();

	useEffect(() => {
		if (!path || trustedPaths.has(path)) {
			return;
		}
		let cancelled = false;
		void desktopClient
			.invoke<boolean>("is_workspace_trusted", { path })
			.catch(() => false)
			.then((trusted) => {
				if (trusted) trustedPaths.add(path);
				if (!cancelled) setChecked({ path, trusted });
			});
		return () => {
			cancelled = true;
		};
	}, [path]);

	const trust = useCallback(() => {
		void desktopClient
			.invoke("trust_workspace", { path })
			.then(() => {
				trustedPaths.add(path);
				setChecked({ path, trusted: true });
			})
			.catch(() => {});
	}, [path]);

	const status: "trusted" | "untrusted" | "checking" =
		!path || trustedPaths.has(path)
			? "trusted"
			: checked?.path === path
				? "untrusted"
				: "checking";
	return { status, trust };
}

export function WorkspaceTrustGate({
	path,
	onTrust,
	onDecline,
}: {
	path: string;
	onTrust: () => void;
	/** Omitted when the thread is tied to this folder and cannot leave it. */
	onDecline?: () => void;
}) {
	return (
		<div className="flex h-full flex-1 items-center justify-center bg-background p-6 text-foreground">
			<div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-sm">
				<span className="flex size-9 items-center justify-center rounded-lg bg-primary/15 text-primary">
					<FolderLock className="size-4.5" />
				</span>
				<h2 className="mt-4 text-base font-semibold">
					Do you trust the files in this folder?
				</h2>
				<p className="mt-2 break-all rounded-md bg-muted px-2.5 py-1.5 font-mono text-xs text-muted-foreground">
					{path}
				</p>
				<p className="mt-3 text-sm text-muted-foreground">
					Cline automatically loads rules, skills, hooks, and plugins from this
					folder, and can read, edit, and run its files. Only continue if you
					trust where it came from.
				</p>
				<div className="mt-5 flex justify-end gap-2">
					{onDecline ? (
						<Button onClick={onDecline} size="sm" type="button" variant="ghost">
							Don't trust
						</Button>
					) : null}
					<Button onClick={onTrust} size="sm" type="button">
						Trust folder
					</Button>
				</div>
			</div>
		</div>
	);
}
