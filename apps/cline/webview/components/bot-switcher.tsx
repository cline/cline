"use client";

import { convertFileSrc } from "@tauri-apps/api/core";
import { ChevronDown, Plus } from "lucide-react";
import { useCallback, useState } from "react";
import { SystemPromptEditor } from "@/components/system-prompt-editor";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { BotSummary } from "@/hooks/use-bots";
import { basenamePath } from "@/hooks/use-session-history";
import { desktopClient, isTauriAvailable } from "@/lib/desktop-client";
import { cn } from "@/lib/utils";

// Create the preset based on number of icons in the bot-icons folder
const BOT_ICON_COUNT = 9;

const BOT_ICON_PRESETS: Array<{ path: string; label: string }> = Array.from(
	{ length: BOT_ICON_COUNT },
	(_, i) => ({
		path: `/bot-icons/${String(i + 1).padStart(3, "0")}.png`,
		label: String(i + 1).padStart(3, "0"),
	}),
);

/**
 * Resolves a bot's `icon` field to something an <img src> can load. It's one
 * of three shapes: a bundled preset (app-relative, served by Next as a
 * static asset), a plain URL, or an arbitrary local filesystem path picked
 * via the OS file dialog - only that last one needs conversion, since a raw
 * file:// path isn't otherwise reachable from the webview (see
 * tauri.conf.json's security.assetProtocol, which this requires enabled).
 */
function resolveIconSrc(icon: string): string {
	if (icon.startsWith("/") || /^https?:\/\//.test(icon)) {
		return icon;
	}
	return isTauriAvailable() ? convertFileSrc(icon) : icon;
}

function BotIcon({
	icon,
	className,
}: {
	icon: string | undefined;
	className?: string;
}) {
	if (!icon) {
		// Return first preset icon as default if no icon is set
		return (
			// biome-ignore lint/performance/noImgElement: bot icons are arbitrary user-picked local files or URLs, not static assets Next's optimizer can process.
			<img
				alt=""
				className={cn("shrink-0 rounded-sm object-cover", className)}
				src={BOT_ICON_PRESETS[0].path}
			/>
		);
	}
	return (
		// biome-ignore lint/performance/noImgElement: bot icons are arbitrary user-picked local files or URLs, not static assets Next's optimizer can process.
		<img
			alt=""
			className={cn("shrink-0 rounded-sm object-cover", className)}
			src={resolveIconSrc(icon)}
		/>
	);
}

export function BotSwitcher({
	bots,
	activeBotId,
	canCreateBot,
	onCreateBot,
	onSwitchBot,
	isCollapsed,
}: {
	bots: BotSummary[];
	activeBotId: string;
	canCreateBot: boolean;
	onCreateBot: (
		name: string,
		initialProjectPath?: string,
		icon?: string,
		systemPrompt?: string,
	) => Promise<BotSummary>;
	onSwitchBot: (botId: string) => Promise<void>;
	isCollapsed: boolean;
}) {
	const [createDialogOpen, setCreateDialogOpen] = useState(false);
	const [newBotName, setNewBotName] = useState("");
	const [newBotProjectPath, setNewBotProjectPath] = useState<string | null>(
		null,
	);
	const [newBotIcon, setNewBotIcon] = useState("");
	const [newBotSystemPrompt, setNewBotSystemPrompt] = useState("");
	const [isCreating, setIsCreating] = useState(false);
	const [createError, setCreateError] = useState<string | null>(null);

	const activeBot = bots.find((bot) => bot.id === activeBotId);
	const activeBotName = activeBot?.name ?? "Cline";

	const handlePickFolder = useCallback(async () => {
		try {
			const selected = await desktopClient.invoke<string | null>(
				"pick_workspace_directory",
				{},
			);
			if (typeof selected === "string" && selected.trim()) {
				setNewBotProjectPath(selected.trim());
			}
		} catch {
			// Folder picker failures (e.g. no zenity/kdialog on Linux) just
			// leave the optional project unset - creation still works without one.
		}
	}, []);

	const handlePickIconFile = useCallback(async () => {
		try {
			const selected = await desktopClient.invoke<string | null>(
				"pick_bot_icon_file",
				{},
			);
			if (typeof selected === "string" && selected.trim()) {
				setNewBotIcon(selected.trim());
			}
		} catch {
			// File picker failures just leave the icon field as-is - creation
			// still works without a custom icon.
		}
	}, []);

	const resetCreateDialog = useCallback(() => {
		setNewBotName("");
		setNewBotProjectPath(null);
		setNewBotIcon("");
		setNewBotSystemPrompt("");
		setCreateError(null);
		setIsCreating(false);
	}, []);

	const handleCreate = useCallback(async () => {
		const trimmedName = newBotName.trim();
		if (!trimmedName) {
			setCreateError("Give the new bot a name.");
			return;
		}
		setIsCreating(true);
		setCreateError(null);
		try {
			await onCreateBot(
				trimmedName,
				newBotProjectPath ?? undefined,
				newBotIcon || undefined,
				newBotSystemPrompt || undefined,
			);
			setCreateDialogOpen(false);
			resetCreateDialog();
		} catch (error) {
			setCreateError(
				error instanceof Error
					? error.message
					: "Could not create the new bot.",
			);
			setIsCreating(false);
		}
	}, [
		newBotName,
		newBotProjectPath,
		newBotIcon,
		newBotSystemPrompt,
		onCreateBot,
		resetCreateDialog,
	]);

	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<button
						aria-label="Cline — switch or create bot"
						className={cn(
							"flex min-w-0 shrink-0 items-center gap-2 rounded-md text-sidebar-foreground hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
							isCollapsed ? "size-9 justify-center px-0" : "px-1.5 py-1",
						)}
						type="button"
					>
						<BotIcon className="size-5" icon={activeBot?.icon} />
						{!isCollapsed ? (
							<>
								<span className="max-w-24 truncate text-sm font-medium">
									{activeBotName}
								</span>
								<ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
							</>
						) : null}
					</button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="start" className="w-64">
					<DropdownMenuRadioGroup
						onValueChange={(botId) => void onSwitchBot(botId)}
						value={activeBotId}
					>
						{bots.map((bot) => (
							<DropdownMenuRadioItem key={bot.id} value={bot.id}>
								<BotIcon className="size-5" icon={bot.icon} />
								{bot.name}
							</DropdownMenuRadioItem>
						))}
					</DropdownMenuRadioGroup>
					<DropdownMenuSeparator />
					<DropdownMenuItem
						disabled={!canCreateBot}
						onSelect={() => setCreateDialogOpen(true)}
					>
						<Plus className="size-4" />
						New Bot
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>

			<Dialog
				onOpenChange={(open) => {
					setCreateDialogOpen(open);
					if (!open) {
						resetCreateDialog();
					}
				}}
				open={createDialogOpen}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Creating a New Bot</DialogTitle>
						<DialogDescription className="text-xs text-muted-foreground">
							Each bot has its own identity, sessions, settings, and sandboxed
							access.
						</DialogDescription>
					</DialogHeader>
					<div className="grid gap-4 py-2">
						<div className="grid gap-2">
							<Label htmlFor="new-bot-name">Name</Label>
							<Input
								autoFocus
								id="new-bot-name"
								onChange={(event) => setNewBotName(event.target.value)}
								placeholder="e.g. PR Reviewer"
								value={newBotName}
							/>
						</div>
						<div className="grid gap-2">
							<Label>Workspace (optional)</Label>
							<Button
								onClick={() => void handlePickFolder()}
								type="button"
								size="sm"
								variant="outline"
							>
								{newBotProjectPath
									? basenamePath(newBotProjectPath)
									: "Choose Folder"}
							</Button>
						</div>
						<div className="grid gap-2">
							<Label htmlFor="new-bot-icon">Icon (optional)</Label>
							<div className="flex flex-wrap gap-2">
								{BOT_ICON_PRESETS.map((preset) => (
									<button
										aria-label={preset.label}
										aria-pressed={newBotIcon === preset.path}
										className={cn(
											"flex size-9 items-center justify-center rounded-md border transition-colors",
											newBotIcon === preset.path
												? "border-primary ring-2 ring-primary/40"
												: "border-border hover:border-primary/60",
										)}
										key={preset.path}
										onClick={() =>
											setNewBotIcon((current) =>
												current === preset.path ? "" : preset.path,
											)
										}
										title={preset.label}
										type="button"
									>
										{/* biome-ignore lint/performance/noImgElement: small fixed preset thumbnails, not worth Next's image optimizer. */}
										<img
											alt={preset.label}
											className="size-full rounded-sm object-cover"
											src={preset.path}
										/>
									</button>
								))}
							</div>
							<Input
								id="new-bot-icon"
								onChange={(event) => setNewBotIcon(event.target.value)}
								placeholder="Or enter image URL or local path"
								value={newBotIcon.startsWith("/bot-icons/") ? "" : newBotIcon}
							/>
							<Button
								className="justify-self-start hidden"
								onClick={() => void handlePickIconFile()}
								size="sm"
								type="button"
								variant="outline"
							>
								Upload Icon
							</Button>
						</div>
						<SystemPromptEditor
							disabled={isCreating}
							onSystemPromptChange={setNewBotSystemPrompt}
							systemPrompt={newBotSystemPrompt}
						/>
						{createError ? (
							<p className="text-sm text-destructive">{createError}</p>
						) : null}
					</div>
					<DialogFooter>
						<Button
							disabled={isCreating}
							size="sm"
							onClick={() => setCreateDialogOpen(false)}
							type="button"
							variant="ghost"
						>
							Cancel
						</Button>
						<Button
							disabled={isCreating}
							size="sm"
							onClick={() => void handleCreate()}
							type="button"
						>
							{isCreating ? "Creating…" : "Create"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}
