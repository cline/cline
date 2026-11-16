"use client";

import {
	Badge,
	Banner,
	Button,
	IconButton,
	SectionHeading,
	Switch,
} from "@cline/ui";
import { ArrowUpRight, BadgeCheck, Check, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { openExternalUrl } from "@/lib/desktop-client";
import type { McpServer } from "@/lib/extension-inventory";
import {
	getCachedMarketplaceCatalog,
	type MarketplaceEntry,
} from "@/lib/marketplace";
import { useUnsavedChangesGuard } from "@/lib/unsaved-changes";
import { DiscardChangesDialog } from "../../shared/discard-changes-dialog";
import { EditableTitle } from "../../shared/editable-title";
import { CustomizationDescription } from "../shared/customization-description";
import { CustomizationDetailPage } from "../shared/customization-detail-page";
import { CustomizationItemDetails } from "../shared/customization-item-details";
import { CustomizationTypeBadge } from "../shared/customization-type-badge";
import {
	EnvironmentRequirements,
	InstallationNotes,
} from "../shared/environment-setup";
import { McpServerDeleteDialog, McpServerStatus } from "./mcp-server-controls";
import { McpServerForm } from "./mcp-server-form";
import {
	type McpEditorBack,
	useMcpServerEditor,
} from "./use-mcp-server-editor";

export function McpServerEditorPage({
	server,
	entry,
	onBack,
	backLabel = "Manage",
}: {
	server?: McpServer;
	entry?: MarketplaceEntry;
	onBack: McpEditorBack;
	backLabel?: string;
}) {
	const editor = useMcpServerEditor({ server, onBack });
	const { form, setForm, persistedServer, state, isBusy, isSaving, isSaved } =
		editor;
	const unsavedChanges = useUnsavedChangesGuard(editor.hasUnsavedChangesNow);
	// Back, a category, or a type badge all leave the page the same way.
	const leave = () => unsavedChanges.requestLeave(editor.close);
	const nameRef = useRef<HTMLInputElement>(null);
	// A new server starts at its name; an existing one starts at Back.
	const isNewServer = useRef(!server).current;
	useEffect(() => {
		if (isNewServer) nameRef.current?.focus({ preventScroll: true });
	}, [isNewServer]);
	const [deleteTarget, setDeleteTarget] = useState<McpServer | null>(null);
	const errorRef = useRef<HTMLDivElement>(null);
	const title = form.name.trim() || "New MCP server";
	const learnMoreUrl = entry?.homepage ?? entry?.repo;
	const authorUrl = entry?.author?.url;
	const error = editor.error || state.errorMessage;
	const actionError = persistedServer
		? state.serverActionErrors[persistedServer.name]
		: undefined;
	const visibleError = error || actionError?.message;
	const hasFeedback = Boolean(
		visibleError ||
			persistedServer?.configurationError ||
			persistedServer?.oauthStatus?.authorizationRequired ||
			persistedServer?.oauthStatus?.configured ||
			(!persistedServer?.disabled && persistedServer?.oauthStatus?.lastError),
	);
	useEffect(() => {
		if (visibleError) errorRef.current?.focus();
	}, [visibleError]);
	const headerActions = (
		<>
			{persistedServer ? (
				<IconButton
					type="button"
					aria-label={`Delete ${persistedServer.name}`}
					icon={Trash2}
					variant="ghost"
					tone="destructive"
					size="sm"
					disabled={isBusy}
					onClick={() => setDeleteTarget(persistedServer)}
				/>
			) : null}
			<Button
				type="submit"
				size="sm"
				tone="neutral"
				disabled={isBusy}
				aria-busy={isSaving}
				aria-live="polite"
				className="[&_[data-icon=leading]]:text-(--success-6)"
				leadingIcon={isSaved ? Check : undefined}
			>
				{isSaving ? "Saving…" : isSaved ? "Saved" : "Save"}
			</Button>
		</>
	);
	return (
		<CustomizationDetailPage
			backLabel={backLabel}
			onBack={leave}
			backDisabled={isBusy}
			focusBackOnMount={!isNewServer}
			navigationLabel="MCP navigation"
		>
			<form
				noValidate
				aria-label={persistedServer ? "Edit MCP server" : "New MCP server"}
				onSubmit={(event) => {
					event.preventDefault();
					void editor.save();
				}}
			>
				<CustomizationItemDetails
					title={title}
					headerActions={headerActions}
					categories={entry?.tags ?? []}
					categoryNavigationDisabled={isBusy}
					onCategorySelected={leave}
					tagLabels={
						new Map(
							getCachedMarketplaceCatalog()?.tags.map((tag) => [
								tag.id,
								tag.label,
							]) ?? [],
						)
					}
					header={(titleRef, actions) => (
						<fieldset disabled={isBusy} className="flex min-w-0 flex-col gap-6">
							<CustomizationTypeBadge
								className="self-start"
								type="mcp"
								onSelected={leave}
							/>
							<div className="flex min-w-0 flex-col gap-2">
								<div className="flex min-w-0 flex-wrap items-start justify-between gap-4">
									<div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
										<EditableTitle
											titleRef={titleRef}
											inputRef={nameRef}
											id="mcp-name"
											title={title}
											label="Server name"
											placeholder="Server name"
											value={form.name}
											onChange={(name) =>
												setForm((current) => ({ ...current, name }))
											}
											disabled={isBusy}
										/>
										{entry?.verified ? (
											<Badge className="gap-1" tone="info">
												<BadgeCheck className="size-3" />
												Verified
											</Badge>
										) : null}
									</div>
									{actions}
								</div>
								{entry?.tagline ? (
									<CustomizationDescription className="text-muted-foreground text-sm">
										{entry.tagline}
									</CustomizationDescription>
								) : null}
								{entry?.author ? (
									<p className="mt-5 text-muted-foreground text-sm">
										By{" "}
										{authorUrl ? (
											<a
												className="rounded-sm underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
												href={authorUrl}
												onClick={(event) => {
													event.preventDefault();
													void openExternalUrl(authorUrl);
												}}
											>
												{entry.author.name}
											</a>
										) : (
											entry.author.name
										)}
									</p>
								) : null}
							</div>
							{learnMoreUrl ? (
								<div className="flex">
									<Button
										type="button"
										size="sm"
										tone="neutral"
										variant="secondary"
										trailingIcon={ArrowUpRight}
										iconTone="muted"
										onClick={() => void openExternalUrl(learnMoreUrl)}
									>
										Learn more
									</Button>
								</div>
							) : null}
						</fieldset>
					)}
					leadingActions={
						<label
							className="flex cursor-pointer items-center gap-3"
							htmlFor="mcp-enabled"
						>
							<Switch
								id="mcp-enabled"
								aria-label={
									persistedServer
										? `Enable ${persistedServer.name}`
										: "Enable on add"
								}
								checked={!form.disabled}
								disabled={isBusy}
								onCheckedChange={(enabled) =>
									void editor.changeEnabled(enabled)
								}
							/>
							<span className="text-sm">
								{persistedServer ? "Enable" : "Enable on add"}
							</span>
						</label>
					}
					feedback={
						hasFeedback ? (
							<div
								ref={errorRef}
								tabIndex={-1}
								className="grid gap-2 rounded-md focus-visible:outline-2 focus-visible:outline-ring"
							>
								{error ? <Banner tone="error">{error}</Banner> : null}
								{persistedServer ? (
									<McpServerStatus
										server={persistedServer}
										actionError={
											actionError?.message === error ? undefined : actionError
										}
										busy={
											editor.isCancelling || (isBusy && !editor.isAuthorizing)
										}
										authorizing={editor.isAuthorizing}
										onAuthorize={editor.authorizeOAuth}
										onCancel={editor.cancelOAuth}
									/>
								) : null}
							</div>
						) : null
					}
				>
					{entry ? (
						<div id="mcp-about">
							<fieldset disabled={isBusy} className="min-w-0">
								<legend className="sr-only">About this MCP server</legend>
								<McpServerAbout entry={entry} />
							</fieldset>
						</div>
					) : null}
					<div id="mcp-settings" className="min-w-0 space-y-4">
						{entry ? (
							<SectionHeading size="md" headingLevel={2} title="Settings" />
						) : null}
						<McpServerForm
							form={form}
							setForm={setForm}
							disabled={isBusy}
							settingsPath={state.settingsPath}
						/>
					</div>
				</CustomizationItemDetails>
			</form>
			<McpServerDeleteDialog
				server={deleteTarget}
				busy={isBusy}
				onClose={() => setDeleteTarget(null)}
				onDelete={editor.deleteServer}
			/>
			<DiscardChangesDialog
				guard={unsavedChanges}
				description={
					persistedServer
						? `Your edits to "${persistedServer.name}" have not been saved.`
						: "This MCP server has not been saved."
				}
			/>
		</CustomizationDetailPage>
	);
}

function McpServerAbout({ entry }: { entry: MarketplaceEntry }) {
	const requirements = entry.install.env ?? [];
	return (
		<div className="grid min-w-0 gap-8">
			{entry.description ? (
				<CustomizationDescription className="text-muted-foreground text-sm leading-6">
					{entry.description}
				</CustomizationDescription>
			) : null}
			{requirements.length > 0 ? (
				<section className="grid gap-4">
					<SectionHeading size="base" title="Environment setup" />
					<EnvironmentRequirements requirements={requirements} />
				</section>
			) : null}
			<InstallationNotes notes={entry.install.notes} />
		</div>
	);
}
