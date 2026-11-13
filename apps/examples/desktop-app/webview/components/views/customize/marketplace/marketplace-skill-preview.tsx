import { Banner, FileBrowser, FileBrowserContent } from "@cline/ui";
import { useCallback, useEffect, useMemo, useState } from "react";
import { MemoizedMarkdown } from "@/components/ui/markdown";
import { desktopClient, openExternalUrl } from "@/lib/desktop-client";
import type { MarketplaceEntry } from "@/lib/marketplace";
import { isAbsoluteFilePath } from "@/lib/workspace-paths";

type SkillEntry = Pick<MarketplaceEntry, "id" | "type">;
type PreviewIndex = {
	files: { path: string; size: number }[];
	defaultPath: string;
	sourceUrl?: string;
	fallbackFile?: PreviewFile;
	/** The skill has more files than the preview lists. */
	truncated?: boolean;
};
type PreviewFile = {
	path: string;
	content: string;
	sourceUrl?: string;
	localPath?: string;
};
type LoadState<T> =
	| { status: "loading" }
	| { status: "error"; message: string }
	| { status: "ready"; data: T };

/**
 * Where a skill's files are read from. A catalog skill and an installed one
 * differ only in these members, so the preview never asks which it is showing.
 */
type SkillSource = {
	/** Identifies the skill to the sidecar. */
	args: Record<string, unknown>;
	commands: { index: string; file: string };
	/**
	 * A sidecar that predates these commands cannot list files; the copy of the
	 * skill file already in the inventory stands in for it.
	 */
	fallsBackToInventory: boolean;
	/** Links between the skill's own files open in the preview, not a browser. */
	opensFileLinksInPreview: boolean;
	fileLocation: (
		path: string,
		file: PreviewFile | undefined,
		indexSourceUrl: string | undefined,
	) => string | undefined;
	openLocation: (location: string) => void | Promise<void>;
};

function isUnsupportedPreviewCommand(error: unknown, command: string) {
	return (
		(error instanceof Error ? error.message : String(error)) ===
		`unsupported desktop command: ${command}`
	);
}

function installedFileLocation(
	skillPath: string,
	path: string,
): string | undefined {
	if (!isAbsoluteFilePath(skillPath)) return undefined;
	const separatorIndex = Math.max(
		skillPath.lastIndexOf("/"),
		skillPath.lastIndexOf("\\"),
	);
	const separator = skillPath[separatorIndex];
	return `${skillPath.slice(0, separatorIndex + 1)}${path.replaceAll("/", separator)}`;
}

function remoteFileLocation(
	sourceUrl: string | undefined,
	path: string,
): string | undefined {
	if (!sourceUrl) return undefined;
	try {
		const url = new URL(sourceUrl);
		if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
		// The preview index points at the skill directory; file responses point at blobs.
		if (url.hostname === "github.com") {
			const segments = url.pathname.split("/");
			if (segments[3] === "tree") segments[3] = "blob";
			url.pathname = segments.join("/");
		}
		url.pathname = `${url.pathname.replace(/\/$/, "")}/${path.split("/").map(encodeURIComponent).join("/")}`;
		url.search = "";
		url.hash = "";
		return url.href;
	} catch {
		return undefined;
	}
}

function marketplaceSkillSource(entry: SkillEntry): SkillSource {
	return {
		args: { entry },
		commands: {
			index: "get_marketplace_skill_preview",
			file: "read_marketplace_skill_file",
		},
		fallsBackToInventory: false,
		opensFileLinksInPreview: false,
		fileLocation: (path, file, indexSourceUrl) =>
			file?.sourceUrl ?? remoteFileLocation(indexSourceUrl, path),
		openLocation: openExternalUrl,
	};
}

function installedSkillSource(skillPath: string): SkillSource {
	return {
		args: { skillPath },
		commands: {
			index: "get_installed_skill_preview",
			file: "read_installed_skill_file",
		},
		fallsBackToInventory: true,
		opensFileLinksInPreview: true,
		fileLocation: (path, file) =>
			file?.localPath ?? installedFileLocation(skillPath, path),
		openLocation: async (location) => {
			await desktopClient.invoke("reveal_path", { path: location });
		},
	};
}

function resolveLocalFileLink(
	href: string,
	currentPath: string,
): string | null {
	let relativePath: string;
	try {
		relativePath = decodeURIComponent(href.split(/[?#]/, 1)[0]);
	} catch {
		return null;
	}
	if (relativePath.startsWith("/") || relativePath.includes("\\")) return null;
	if (!relativePath) return currentPath;
	const parts = currentPath.split("/").slice(0, -1);
	for (const part of relativePath.split("/")) {
		if (!part || part === ".") continue;
		if (part === "..") {
			if (parts.length === 0) return null;
			parts.pop();
		} else {
			parts.push(part);
		}
	}
	return parts.join("/");
}

function PreviewError({
	message,
	onRetry,
}: {
	message: string;
	onRetry: () => void;
}) {
	return (
		<Banner
			actions={[{ id: "retry", label: "Retry", onClick: onRetry }]}
			description={message}
			tone="error"
		/>
	);
}

function SkillFilePreview({
	source,
	path,
	files,
	onSelect,
	providedFile,
	sourceUrl,
	onUnsupported,
}: {
	source: SkillSource;
	path: string;
	files: PreviewIndex["files"];
	onSelect: (path: string) => void;
	providedFile?: PreviewFile;
	sourceUrl?: string;
	onUnsupported: () => void;
}) {
	const [state, setState] = useState<LoadState<PreviewFile>>({
		status: "loading",
	});
	const [retry, setRetry] = useState(0);
	const isMarkdown = /\.(md|markdown)$/i.test(path);
	// biome-ignore lint/correctness/useExhaustiveDependencies: Retry explicitly restarts the request after a failure.
	useEffect(() => {
		let cancelled = false;
		if (providedFile) {
			setState({ status: "ready", data: providedFile });
			return;
		}
		setState({ status: "loading" });
		void desktopClient
			.invoke<PreviewFile>(source.commands.file, { ...source.args, path })
			.then(
				(data) => {
					if (!cancelled) setState({ status: "ready", data });
				},
				(error) => {
					if (cancelled) return;
					if (
						source.fallsBackToInventory &&
						isUnsupportedPreviewCommand(error, source.commands.file)
					) {
						onUnsupported();
						return;
					}
					setState({
						status: "error",
						message: error instanceof Error ? error.message : String(error),
					});
				},
			);
		return () => {
			cancelled = true;
		};
	}, [source, path, retry, providedFile, onUnsupported]);
	const resolveLocalLink = useCallback(
		(href: string) => {
			const nextPath = resolveLocalFileLink(href, path);
			return nextPath && files.some((file) => file.path === nextPath)
				? () => onSelect(nextPath)
				: undefined;
		},
		[files, onSelect, path],
	);
	const actionPath = source.fileLocation(
		path,
		state.status === "ready" ? state.data : undefined,
		sourceUrl,
	);

	return (
		<FileBrowserContent
			path={path}
			actionPath={actionPath}
			onOpenFileLocation={actionPath ? source.openLocation : undefined}
			content={state.status === "ready" ? state.data.content : undefined}
			loading={state.status === "loading"}
			loadingLabel="Loading skill content…"
			preview={
				isMarkdown && state.status === "ready" ? (
					<MemoizedMarkdown
						classNames="text-sm"
						content={state.data.content.replace(
							/^\uFEFF?---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/,
							"",
						)}
						linkBaseUrl={state.data.sourceUrl}
						resolveLocalLink={
							source.opensFileLinksInPreview ? resolveLocalLink : undefined
						}
					/>
				) : undefined
			}
		>
			{state.status === "error" ? (
				<div className="p-5">
					<PreviewError
						message={state.message}
						onRetry={() => setRetry((current) => current + 1)}
					/>
				</div>
			) : undefined}
		</FileBrowserContent>
	);
}

function SkillPreview({
	source,
	fallbackFile,
}: {
	source: SkillSource;
	fallbackFile?: PreviewFile;
}) {
	const [state, setState] = useState<LoadState<PreviewIndex>>({
		status: "loading",
	});
	const [retry, setRetry] = useState(0);
	const [selection, setSelection] = useState<string | null>(null);
	const showInventoryFallback = useCallback(() => {
		setSelection(null);
		setState(
			fallbackFile
				? {
						status: "ready",
						data: {
							files: [
								{ path: fallbackFile.path, size: fallbackFile.content.length },
							],
							defaultPath: fallbackFile.path,
							fallbackFile,
						},
					}
				: {
						status: "error",
						message: "Restart Cline to view this skill’s files.",
					},
		);
	}, [fallbackFile]);
	// biome-ignore lint/correctness/useExhaustiveDependencies: Retry explicitly restarts the request after a failure.
	useEffect(() => {
		let cancelled = false;
		setState({ status: "loading" });
		setSelection(null);
		void desktopClient
			.invoke<PreviewIndex>(source.commands.index, source.args)
			.then(
				(data) => {
					if (!cancelled) setState({ status: "ready", data });
				},
				(error) => {
					if (cancelled) return;
					if (
						source.fallsBackToInventory &&
						isUnsupportedPreviewCommand(error, source.commands.index)
					) {
						showInventoryFallback();
						return;
					}
					setState({
						status: "error",
						message: error instanceof Error ? error.message : String(error),
					});
				},
			);
		return () => {
			cancelled = true;
		};
	}, [source, retry, showInventoryFallback]);
	const selectedPath =
		selection ??
		(state.status === "ready"
			? state.data.defaultPath || state.data.files[0]?.path
			: undefined);

	if (state.status === "error") {
		return (
			<PreviewError
				message={state.message}
				onRetry={() => setRetry((current) => current + 1)}
			/>
		);
	}

	return (
		<div className="min-w-0">
			<FileBrowser
				aria-label="Skill content"
				files={state.status === "ready" ? state.data.files : []}
				filesLabel="Skill files"
				loading={state.status === "loading"}
				loadingLabel="Loading skill content…"
				onSelect={setSelection}
				selectedPath={selectedPath}
			>
				{state.status === "ready" && selectedPath ? (
					<SkillFilePreview
						files={state.data.files}
						onSelect={setSelection}
						onUnsupported={showInventoryFallback}
						providedFile={state.data.fallbackFile}
						sourceUrl={state.data.sourceUrl}
						source={source}
						key={selectedPath}
						path={selectedPath}
					/>
				) : undefined}
			</FileBrowser>
			{state.status === "ready" && state.data.truncated ? (
				<p className="mt-2 text-muted-foreground text-xs">
					This skill has more files than the preview can list, so some are not
					shown.
				</p>
			) : null}
		</div>
	);
}

export function MarketplaceSkillPreview({
	entry,
}: {
	entry: MarketplaceEntry;
}) {
	// A different catalog item starts a fresh browser, including its in-flight requests.
	const source = useMemo(
		() => marketplaceSkillSource({ id: entry.id, type: entry.type }),
		[entry.id, entry.type],
	);
	return <SkillPreview source={source} key={`${entry.type}:${entry.id}`} />;
}

/** Read the installed version, including local-only and plugin-provided files. */
export function InstalledSkillPreview({
	skillPath,
	instructions,
}: {
	skillPath: string;
	instructions?: string;
}) {
	const source = useMemo(() => installedSkillSource(skillPath), [skillPath]);
	const fallbackFile = useMemo(
		() =>
			instructions?.trim()
				? {
						path:
							skillPath.replaceAll("\\", "/").split("/").at(-1) || "SKILL.md",
						content: instructions,
						localPath: skillPath,
					}
				: undefined,
		[instructions, skillPath],
	);
	return (
		<SkillPreview fallbackFile={fallbackFile} source={source} key={skillPath} />
	);
}
