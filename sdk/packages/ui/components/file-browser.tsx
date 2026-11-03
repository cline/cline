"use client";

import { clsx } from "clsx";
import { Code, Eye } from "lucide-react";
import {
	type ComponentPropsWithoutRef,
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
	path: string;
	/** Show the file actions menu. Defaults to true. */
	showActions?: boolean;
	/** Full local path or remote URL passed to actions. Defaults to the display path. */
	actionPath?: string;
	/** Mount the actions menu inside a themed wrapper when using scoped tokens. */
	actionsPortalContainer?: HTMLElement | null;
	/** Complete file contents, shown verbatim in Source mode. */
	content?: string;
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
		showActions = true,
		actionPath = path,
		onOpenFileLocation,
		onCopyPath,
		actionsPortalContainer,
		content,
		preview,
		loading = false,
		loadingLabel = "Loading file…",
		children,
		className,
		...props
	},
	ref,
) {
	const [mode, setMode] = useState("preview");
	const [actionError, setActionError] = useState<{
		path: string;
		message: string;
	} | null>(null);
	const hasPreview = hasContent(preview);
	return (
		<div
			{...props}
			className={clsx("cline-ui-file-browser__content", className)}
			data-slot="file-browser-content"
			ref={ref}
		>
			<div className="cline-ui-file-browser__header">
				<span className="cline-ui-file-browser__path" title={path}>
					/{path}
				</span>
				<div className="cline-ui-file-browser__controls">
					{hasPreview && !loading ? (
						<SegmentedControl
							aria-label="File display"
							iconOnly
							onValueChange={setMode}
							options={[
								{ value: "preview", label: "Preview", icon: <Eye /> },
								{ value: "source", label: "Source", icon: <Code /> },
							]}
							size="xs"
							value={mode}
						/>
					) : null}
					{showActions && !loading ? (
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
			{showActions && !loading && actionError?.path === actionPath ? (
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
			>
				{loading ? (
					<FileBrowserContentSkeleton />
				) : hasContent(children) ? (
					children
				) : hasPreview && mode === "preview" ? (
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
