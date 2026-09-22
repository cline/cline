"use client";

import {
	ArrowUp,
	CircleAlert,
	Folder,
	Home,
	Loader2,
	RefreshCw,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { desktopClient } from "@/lib/desktop-client";
import { getTranslator, useTranslation } from "@/lib/i18n";

type WorkspaceDirectoryListResult = {
	environmentId: string;
	currentPath: string;
	parentPath: string | null;
	entries: Array<{ name: string; path: string }>;
	truncated: boolean;
};

function normalizeRemotePath(path: string): string {
	const trimmed = path.trim();
	if (trimmed === "/") return trimmed;
	return trimmed.replace(/\/+$/, "");
}

export function RemoteDirectoryPicker({
	open,
	environmentId,
	homeDir,
	onCancel,
	onSelect,
}: {
	open: boolean;
	environmentId: string;
	homeDir: string;
	onCancel: () => void;
	onSelect: (path: string) => void;
}) {
	const normalizedHome = normalizeRemotePath(homeDir) || "/";
	const [currentPath, setCurrentPath] = useState(normalizedHome);
	const [requestedPath, setRequestedPath] = useState(normalizedHome);
	const [parentPath, setParentPath] = useState<string | null>(null);
	const [directories, setDirectories] = useState<
		Array<{ name: string; path: string }>
	>([]);
	const [truncated, setTruncated] = useState(false);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [reloadVersion, setReloadVersion] = useState(0);

	useEffect(() => {
		if (!open) return;
		setCurrentPath(normalizedHome);
		setRequestedPath(normalizedHome);
		setParentPath(null);
		setDirectories([]);
		setTruncated(false);
	}, [normalizedHome, open]);

	useEffect(() => {
		if (!open) return;
		const t = getTranslator().t;
		const request = {
			environmentId,
			path: requestedPath,
			reloadVersion,
		};
		let cancelled = false;
		setLoading(true);
		setError(null);
		desktopClient
			.invoke<WorkspaceDirectoryListResult>("list_workspace_directories", {
				environmentId: request.environmentId,
				path: request.path,
			})
			.then((result) => {
				if (cancelled) return;
				if (result.environmentId !== request.environmentId) {
					throw new Error(
						t("chat.environment.picker.mismatchError", {
							received: result.environmentId,
							expected: request.environmentId,
						}),
					);
				}
				const canonicalPath = normalizeRemotePath(result.currentPath);
				if (!canonicalPath) {
					throw new Error(t("chat.environment.picker.emptyPathError"));
				}
				setCurrentPath(canonicalPath);
				setParentPath(
					result.parentPath ? normalizeRemotePath(result.parentPath) : null,
				);
				setDirectories(
					(result.entries ?? []).filter(
						(entry) => entry.name.trim() && normalizeRemotePath(entry.path),
					),
				);
				setTruncated(result.truncated === true);
			})
			.catch((listError: unknown) => {
				if (cancelled) return;
				setDirectories([]);
				setTruncated(false);
				setError(
					listError instanceof Error ? listError.message : String(listError),
				);
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [environmentId, open, reloadVersion, requestedPath]);

	const canGoUp = Boolean(parentPath && parentPath !== currentPath);
	const { t } = useTranslation();

	return (
		<Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onCancel()}>
			<DialogContent className="gap-4 sm:max-w-xl">
				<DialogHeader>
					<DialogTitle>{t("chat.environment.picker.title")}</DialogTitle>
					<DialogDescription>
						{t("chat.environment.picker.description")}
					</DialogDescription>
				</DialogHeader>

				<div className="flex min-w-0 items-center gap-2">
					<Button
						aria-label={t("chat.environment.picker.homeAria")}
						disabled={loading || currentPath === normalizedHome}
						onClick={() => setRequestedPath(normalizedHome)}
						size="icon"
						variant="outline"
					>
						<Home />
					</Button>
					<Button
						aria-label={t("chat.environment.picker.parentAria")}
						disabled={loading || !canGoUp}
						onClick={() => parentPath && setRequestedPath(parentPath)}
						size="icon"
						variant="outline"
					>
						<ArrowUp />
					</Button>
					<p
						className="min-w-0 flex-1 truncate rounded-md border bg-muted/30 px-3 py-2 font-mono text-xs"
						title={currentPath}
					>
						{currentPath}
					</p>
					<Button
						aria-label={t("chat.environment.picker.refreshAria")}
						disabled={loading}
						onClick={() => setReloadVersion((version) => version + 1)}
						size="icon"
						variant="outline"
					>
						<RefreshCw className={loading ? "animate-spin" : undefined} />
					</Button>
				</div>

				<div className="min-h-56 rounded-md border p-1.5">
					{loading ? (
						<div className="flex h-52 items-center justify-center gap-2 text-sm text-muted-foreground">
							<Loader2 className="size-4 animate-spin" />
							{t("chat.environment.picker.loading")}
						</div>
					) : error ? (
						<div className="flex h-52 flex-col items-center justify-center gap-2 px-6 text-center text-sm text-destructive">
							<CircleAlert className="size-5" />
							{error}
						</div>
					) : directories.length === 0 ? (
						<div className="flex h-52 items-center justify-center text-sm text-muted-foreground">
							{t("chat.environment.picker.empty")}
						</div>
					) : (
						<div className="flex max-h-56 flex-col gap-0.5 overflow-y-auto">
							{directories.map((entry) => {
								return (
									<Button
										className="h-auto w-full justify-start gap-2 px-2 py-2 text-left"
										key={entry.path}
										onClick={() => setRequestedPath(entry.path)}
										variant="ghost"
									>
										<Folder className="size-4 shrink-0 text-muted-foreground" />
										<span className="min-w-0 truncate text-sm">
											{entry.name}
										</span>
									</Button>
								);
							})}
						</div>
					)}
				</div>
				{truncated && !loading && !error ? (
					<p className="text-xs text-muted-foreground">
						{t("chat.environment.picker.truncated")}
					</p>
				) : null}

				<DialogFooter>
					<Button onClick={onCancel} variant="outline">
						{t("common.action.cancel")}
					</Button>
					<Button
						disabled={loading || Boolean(error)}
						onClick={() => onSelect(currentPath)}
					>
						{t("chat.environment.picker.useThisFolder")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
