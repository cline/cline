"use client";

import { clsx } from "clsx";
import { Code, Eye } from "lucide-react";
import {
	type ComponentPropsWithoutRef,
	type CSSProperties,
	forwardRef,
	type ReactNode,
	useState,
} from "react";
import { Banner } from "./banner.js";
import {
	type FileBrowserActionHandlers,
	FileBrowserActions,
} from "./file-browser-actions.js";
import {
	FileBrowserNavigation,
	fileBrowserLayoutStyle,
} from "./file-browser-navigation.js";
import { hasContent } from "./has-content.js";
import { SegmentedControl } from "./segmented-control.js";
import { TooltipProvider } from "./tooltip.js";

export interface FileBrowserFile {
	/** A unique path relative to the browser's root, with / as the separator. */
	path: string;
}

export interface FileBrowserProps
	extends Omit<ComponentPropsWithoutRef<"section">, "onSelect"> {
	files: readonly FileBrowserFile[];
	selectedPath?: string | null;
	onSelect: (path: string) => void;
	filesLabel?: string;
	emptyMessage?: ReactNode;
	/** Preview placeholder while files are available but none is selected. */
	unselectedMessage?: ReactNode;
	/** Show placeholders for the file tree and preview while loading the file list. */
	loading?: boolean;
	loadingLabel?: string;
	/** FileBrowserContent, or a host-owned error state. */
	children?: ReactNode;
}

export interface FileBrowserContentProps
	extends Omit<ComponentPropsWithoutRef<"div">, "content">,
		FileBrowserActionHandlers {
	/** Display path. Omit for content that is not backed by a file. */
	path?: string;
	/** Header text shown instead of the display path. */
	headerLabel?: string;
	/** ID for the visible header label, usable by a surrounding region or source editor. */
	headerLabelId?: string;
	/** Fixed viewport by default; content grows to its bounds and scrolls within the body. */
	sizing?: "fixed" | "content";
	/** Minimum body height in content sizing. CSS length; numbers are pixels. Defaults to 0. */
	minBodyHeight?: number | string;
	/** Maximum body height in content sizing. CSS length; numbers are pixels. Defaults to the fixed body height (36rem). */
	maxBodyHeight?: number | string;
	/** Show the file actions menu when a path is available. Defaults to true. */
	showActions?: boolean;
	/** Full local path or remote URL passed to actions. Defaults to the display path. */
	actionPath?: string;
	/** Mount the actions menu and mode tooltips inside a themed wrapper. */
	actionsPortalContainer?: HTMLElement | null;
	/** Complete file contents, shown verbatim in Source mode. */
	content?: string;
	/** Host-owned source editor. Stays mounted while previewing to preserve editor state. */
	source?: ReactNode;
	/** Accessible label for Source mode. Defaults to "Source". */
	sourceLabel?: string;
	/** Initial display mode. Defaults to "preview"; source-only content always shows source. */
	defaultMode?: "preview" | "source";
	/** Host-rendered preview. Omit for files that only support Source mode. */
	preview?: ReactNode;
	/** Show a placeholder in the preview pane while the selected file loads. */
	loading?: boolean;
	loadingLabel?: string;
	/** Host-owned state that takes precedence over the file contents. */
	children?: ReactNode;
}

function FileBrowserContentSkeleton() {
	return (
		<div
			aria-hidden="true"
			className="cline-ui-file-browser__skeleton-content"
			data-slot="file-browser-content-skeleton"
		>
			{["72%", "88%", "64%"].map((width) => (
				<div className="cline-ui-file-browser__skeleton-section" key={width}>
					<div className="cline-ui-file-browser__skeleton-block cline-ui-file-browser__skeleton-heading" />
					<div className="cline-ui-file-browser__skeleton-paragraph">
						<div className="cline-ui-file-browser__skeleton-block" />
						<div className="cline-ui-file-browser__skeleton-block" />
						<div
							className="cline-ui-file-browser__skeleton-block"
							style={{ width }}
						/>
					</div>
				</div>
			))}
		</div>
	);
}

function FileBrowserSkeleton() {
	return (
		<div
			aria-hidden="true"
			className="cline-ui-file-browser__layout"
			data-slot="file-browser-skeleton"
		>
			<div className="cline-ui-file-browser__sidebar">
				<div className="cline-ui-file-browser__navigation">
					{["64%", "76%", "88%", "68%", "80%", "56%"].map((width, index) => (
						<div
							className="cline-ui-file-browser__skeleton-entry"
							data-nested={(index > 0 && index < 5) || undefined}
							key={width}
						>
							<div className="cline-ui-file-browser__skeleton-block cline-ui-file-browser__skeleton-icon" />
							<div
								className="cline-ui-file-browser__skeleton-block"
								style={{ width }}
							/>
						</div>
					))}
				</div>
			</div>
			<div className="cline-ui-file-browser__content">
				<div className="cline-ui-file-browser__header">
					<div className="cline-ui-file-browser__skeleton-block cline-ui-file-browser__skeleton-path" />
					<div className="cline-ui-file-browser__skeleton-block cline-ui-file-browser__skeleton-control" />
				</div>
				<div className="cline-ui-file-browser__body">
					<FileBrowserContentSkeleton />
				</div>
			</div>
		</div>
	);
}

/** A controlled file tree beside a preview pane. Hosts own file access and selection. */
export const FileBrowser = forwardRef<HTMLElement, FileBrowserProps>(
	function FileBrowser(
		{
			files,
			selectedPath,
			onSelect,
			filesLabel = "Files",
			emptyMessage = "No preview files available.",
			unselectedMessage = "Select a file to preview.",
			loading = false,
			loadingLabel = "Loading files…",
			children,
			className,
			style,
			...props
		},
		ref,
	) {
		return (
			<section
				{...props}
				className={clsx("cline-ui-file-browser", className)}
				style={{ ...fileBrowserLayoutStyle, ...style }}
				data-slot="file-browser"
				ref={ref}
			>
				<output className="cline-ui-file-browser__loading-label">
					{loading ? loadingLabel : undefined}
				</output>
				<div
					className="cline-ui-file-browser__frame"
					aria-busy={loading || undefined}
				>
					{loading ? (
						<FileBrowserSkeleton />
					) : files.length > 0 ? (
						<div className="cline-ui-file-browser__layout">
							<FileBrowserNavigation
								label={filesLabel}
								files={files}
								onSelect={onSelect}
								selectedPath={selectedPath}
							/>
							{hasContent(children) ? (
								children
							) : (
								<div className="cline-ui-file-browser__content cline-ui-file-browser__unselected">
									<p className="cline-ui-file-browser__empty">
										{unselectedMessage}
									</p>
								</div>
							)}
						</div>
					) : hasContent(children) ? (
						children
					) : (
						<p className="cline-ui-file-browser__empty">{emptyMessage}</p>
					)}
				</div>
			</section>
		);
	},
);

/** Key by path to reset the display mode and scroll position when selecting a file. */
export const FileBrowserContent = forwardRef<
	HTMLDivElement,
	FileBrowserContentProps
>(function FileBrowserContent(
	{
		path,
		headerLabel,
		headerLabelId,
		sizing = "fixed",
		minBodyHeight,
		maxBodyHeight,
		showActions = true,
		actionPath = path,
		onOpenFileLocation,
		onCopyPath,
		actionsPortalContainer,
		content,
		source,
		sourceLabel = "Source",
		defaultMode = "preview",
		preview,
		loading = false,
		loadingLabel = "Loading file…",
		children,
		className,
		style,
		...props
	},
	ref,
) {
	const [mode, setMode] = useState<string>(defaultMode);
	const [actionError, setActionError] = useState<{
		path: string;
		message: string;
	} | null>(null);
	const hasPreview = hasContent(preview);
	const hasSource = hasContent(source);
	const showPreview = hasPreview && mode === "preview";
	return (
		<div
			{...props}
			className={clsx("cline-ui-file-browser__content", className)}
			data-slot="file-browser-content"
			data-sizing={sizing}
			style={
				{
					"--cline-ui-file-browser-body-min-height":
						typeof minBodyHeight === "number"
							? `${minBodyHeight}px`
							: minBodyHeight,
					"--cline-ui-file-browser-body-max-height":
						typeof maxBodyHeight === "number"
							? `${maxBodyHeight}px`
							: maxBodyHeight,
					...style,
				} as CSSProperties
			}
			ref={ref}
		>
			<div className="cline-ui-file-browser__header">
				<span
					className="cline-ui-file-browser__path"
					id={headerLabelId}
					title={headerLabel ?? path}
				>
					{headerLabel ?? (path ? `/${path}` : undefined)}
				</span>
				<div className="cline-ui-file-browser__controls">
					{hasPreview && !loading ? (
						<TooltipProvider delayDuration={600}>
							<SegmentedControl
								aria-label={
									headerLabel ? `${headerLabel} display` : "File display"
								}
								iconOnly
								onValueChange={setMode}
								options={[
									{
										value: "source",
										label: sourceLabel,
										icon: <Code />,
										tooltip: sourceLabel,
									},
									{
										value: "preview",
										label: "Preview",
										icon: <Eye />,
										tooltip: "Preview",
									},
								]}
								size="xs"
								tooltipPortalContainer={actionsPortalContainer}
								value={mode}
							/>
						</TooltipProvider>
					) : null}
					{showActions && actionPath && !loading ? (
						<FileBrowserActions
							key={actionPath}
							path={actionPath}
							onOpenFileLocation={onOpenFileLocation}
							onCopyPath={onCopyPath}
							portalContainer={actionsPortalContainer}
							onError={(message) =>
								setActionError(message ? { path: actionPath, message } : null)
							}
						/>
					) : null}
				</div>
			</div>
			{showActions &&
			actionPath &&
			!loading &&
			actionError?.path === actionPath ? (
				<div className="cline-ui-file-browser__action-error">
					<Banner tone="error" description={actionError.message} />
				</div>
			) : null}
			<output className="cline-ui-file-browser__loading-label">
				{loading ? loadingLabel : undefined}
			</output>
			<div
				className="cline-ui-file-browser__body"
				aria-busy={loading || undefined}
				aria-label={headerLabel ?? path ?? "File contents"}
				role="document"
				// biome-ignore lint/a11y/noNoninteractiveTabindex: Allow keyboard users to scroll file contents independently of the navigation.
				tabIndex={0}
			>
				{loading ? (
					<FileBrowserContentSkeleton />
				) : hasContent(children) ? (
					children
				) : hasSource ? (
					<>
						<div className="cline-ui-file-browser__editor" hidden={showPreview}>
							{source}
						</div>
						{showPreview ? (
							<div className="cline-ui-file-browser__preview">{preview}</div>
						) : null}
					</>
				) : showPreview ? (
					<div className="cline-ui-file-browser__preview">{preview}</div>
				) : (
					<section aria-label="File source">
						<pre className="cline-ui-file-browser__source">
							<code>{content}</code>
						</pre>
					</section>
				)}
			</div>
		</div>
	);
});
