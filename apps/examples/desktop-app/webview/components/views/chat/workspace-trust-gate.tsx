"use client";

import { Banner } from "@cline/ui";
import { FolderLock } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "@/hooks/use-toast";
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
			.catch((error) =>
				toast({
					title: "Couldn't trust this folder",
					description: error instanceof Error ? error.message : String(error),
					variant: "destructive",
				}),
			);
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
		<div className="flex h-full flex-1 items-center justify-center bg-background p-6">
			<Banner
				actions={[
					...(onDecline
						? [{ id: "decline", label: "Don't trust", onClick: onDecline }]
						: []),
					{ id: "trust", label: "Trust folder", onClick: onTrust },
				]}
				className="max-w-xl"
				description={
					<>
						<span className="break-all font-mono text-xs">{path}</span>
						<br />
						Cline automatically loads rules, skills, hooks, and plugins from
						this folder, and can read, edit, and run its files. Only continue if
						you trust where it came from.
					</>
				}
				icon={<FolderLock aria-hidden="true" />}
				title="Do you trust the files in this folder?"
				tone="warning"
			/>
		</div>
	);
}
