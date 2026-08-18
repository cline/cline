"use client";

import { Brain, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { BotAvatar } from "@/components/bot-avatar";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { getInitialChatConfig } from "@/hooks/chat-session/constants";
import { toast } from "@/hooks/use-toast";
import {
	BOT_COLORS,
	BOT_SHAPES,
	type BotShape,
	type BotSummary,
	createBot,
	deleteBot,
	readBotMemory,
	updateBot,
	updateBotMemory,
} from "@/lib/bots";
import { cn } from "@/lib/utils";

type BotDraft = {
	name: string;
	shape: BotShape;
	color: string;
};

const DEFAULT_DRAFT: BotDraft = {
	name: "",
	shape: "circle",
	color: BOT_COLORS[0],
};

export function BotsPanel({
	bots,
	botsLoaded,
	activeBotId,
	onOpenBot,
	onBotDeleted,
	onRefreshBots,
}: {
	bots: BotSummary[];
	botsLoaded: boolean;
	activeBotId: string | null;
	onOpenBot: (bot: BotSummary) => void;
	onBotDeleted: (botId: string) => void;
	onRefreshBots: () => Promise<void>;
}) {
	const [editorOpen, setEditorOpen] = useState(false);
	const [editingBot, setEditingBot] = useState<BotSummary | null>(null);
	const [draft, setDraft] = useState<BotDraft>(DEFAULT_DRAFT);
	const [savingBot, setSavingBot] = useState(false);
	const [memoryBot, setMemoryBot] = useState<BotSummary | null>(null);
	const [deleteConfirmBot, setDeleteConfirmBot] = useState<BotSummary | null>(
		null,
	);
	const [deletingBot, setDeletingBot] = useState(false);

	const openCreateDialog = useCallback(() => {
		setEditingBot(null);
		setDraft({
			...DEFAULT_DRAFT,
			color: BOT_COLORS[bots.length % BOT_COLORS.length],
		});
		setEditorOpen(true);
	}, [bots.length]);

	const openEditDialog = useCallback((bot: BotSummary) => {
		setEditingBot(bot);
		setDraft({ name: bot.name, shape: bot.shape, color: bot.color });
		setEditorOpen(true);
	}, []);

	const saveBot = useCallback(async () => {
		const name = draft.name.trim();
		if (!name || savingBot) {
			return;
		}
		setSavingBot(true);
		try {
			if (editingBot) {
				await updateBot(editingBot.id, {
					name,
					shape: draft.shape,
					color: draft.color,
				});
			} else {
				// Seed the bot with the remembered provider/model so other bots can
				// message it before its chat has ever been opened.
				const initialConfig = getInitialChatConfig();
				const created = await createBot({
					name,
					shape: draft.shape,
					color: draft.color,
					provider: initialConfig.provider,
					model: initialConfig.model,
				});
				onOpenBot(created);
			}
			await onRefreshBots();
			setEditorOpen(false);
		} catch (error) {
			toast({
				variant: "destructive",
				title: editingBot ? "Could not update bot" : "Could not create bot",
				description: error instanceof Error ? error.message : String(error),
			});
		} finally {
			setSavingBot(false);
		}
	}, [draft, editingBot, onOpenBot, onRefreshBots, savingBot]);

	const confirmDeleteBot = useCallback(async () => {
		if (!deleteConfirmBot || deletingBot) {
			return;
		}
		setDeletingBot(true);
		try {
			await deleteBot(deleteConfirmBot.id);
			onBotDeleted(deleteConfirmBot.id);
			await onRefreshBots();
			setDeleteConfirmBot(null);
		} catch (error) {
			toast({
				variant: "destructive",
				title: "Could not delete bot",
				description: error instanceof Error ? error.message : String(error),
			});
		} finally {
			setDeletingBot(false);
		}
	}, [deleteConfirmBot, deletingBot, onBotDeleted, onRefreshBots]);

	return (
		<>
			<div className="mt-1 shrink-0 pl-4 pr-2">
				<div className="flex h-8 items-center justify-between gap-2">
					<p className="min-w-0 truncate text-sm font-medium text-sidebar-foreground">
						Bots
					</p>
					<Button
						aria-label="New bot"
						className="m-0! size-8 p-0! text-muted-foreground hover:bg-surface-hover"
						onClick={openCreateDialog}
						size="icon"
						title="New bot"
						type="button"
						variant="ghost"
					>
						<Plus className="size-4" />
					</Button>
				</div>
			</div>
			<div className="mt-1 min-h-0 w-full flex-1">
				<ScrollArea className="h-full min-h-0 w-full min-w-0">
					<div className="flex min-w-0 flex-col gap-0.5 px-2 pb-3">
						{!botsLoaded ? (
							<div className="p-4 text-xs text-muted-foreground">
								Loading bots...
							</div>
						) : bots.length === 0 ? (
							<div className="px-2 py-4 text-xs text-muted-foreground">
								No bots yet. Create a bot to give your agent a persistent
								identity and memory — bots can message each other and work
								together.
							</div>
						) : (
							bots.map((bot) => (
								<ContextMenu key={bot.id}>
									<ContextMenuTrigger asChild>
										<button
											className={cn(
												"group flex w-full min-w-0 items-center gap-2.5 rounded-md px-2 py-2 text-left hover:bg-surface-hover",
												activeBotId === bot.id &&
													"bg-surface-hover text-sidebar-foreground",
											)}
											onClick={() => onOpenBot(bot)}
											type="button"
										>
											<BotAvatar
												className="size-7"
												color={bot.color}
												shape={bot.shape}
											/>
											<span className="flex min-w-0 flex-1 flex-col leading-tight">
												<span className="truncate text-sm font-medium">
													{bot.name}
												</span>
												<span className="truncate text-[11px] text-muted-foreground">
													{bot.memoryPreview ||
														(bot.sessionId ? "No memory yet" : "New bot")}
												</span>
											</span>
										</button>
									</ContextMenuTrigger>
									<ContextMenuContent>
										<ContextMenuItem onSelect={() => openEditDialog(bot)}>
											<Pencil className="size-4" />
											Edit bot
										</ContextMenuItem>
										<ContextMenuItem onSelect={() => setMemoryBot(bot)}>
											<Brain className="size-4" />
											Memory
										</ContextMenuItem>
										<ContextMenuItem
											onSelect={() => setDeleteConfirmBot(bot)}
											variant="destructive"
										>
											<Trash2 className="size-4" />
											Delete bot
										</ContextMenuItem>
									</ContextMenuContent>
								</ContextMenu>
							))
						)}
					</div>
				</ScrollArea>
			</div>

			<Dialog onOpenChange={setEditorOpen} open={editorOpen}>
				<DialogContent className="sm:max-w-md">
					<DialogHeader>
						<DialogTitle>{editingBot ? "Edit bot" : "New bot"}</DialogTitle>
						<DialogDescription>
							{editingBot
								? "Update this bot's name and look."
								: "A bot is a persistent agent with its own memory. Tell it who it is in its first chat — it will remember."}
						</DialogDescription>
					</DialogHeader>
					<div className="flex flex-col gap-4">
						<div className="flex items-center justify-center py-2">
							<BotAvatar
								className="size-16"
								color={draft.color}
								shape={draft.shape}
							/>
						</div>
						<Input
							autoFocus={true}
							maxLength={40}
							onChange={(event) =>
								setDraft((prev) => ({ ...prev, name: event.target.value }))
							}
							onKeyDown={(event) => {
								if (event.key === "Enter") {
									event.preventDefault();
									void saveBot();
								}
							}}
							placeholder="Bot name (e.g. Chief of Staff)"
							value={draft.name}
						/>
						<div className="flex flex-wrap items-center gap-2">
							{BOT_SHAPES.map((shape) => (
								<button
									aria-label={`Shape: ${shape}`}
									aria-pressed={draft.shape === shape}
									className={cn(
										"flex size-10 items-center justify-center rounded-md border border-border hover:bg-surface-hover",
										draft.shape === shape && "border-primary bg-surface-hover",
									)}
									key={shape}
									onClick={() => setDraft((prev) => ({ ...prev, shape }))}
									title={shape}
									type="button"
								>
									<BotAvatar
										className="size-6"
										color={draft.color}
										shape={shape}
									/>
								</button>
							))}
						</div>
						<div className="flex flex-wrap items-center gap-2">
							{BOT_COLORS.map((color) => (
								<button
									aria-label={`Color: ${color}`}
									aria-pressed={draft.color === color}
									className={cn(
										"size-8 rounded-full border-2 border-transparent",
										draft.color === color && "border-foreground",
									)}
									key={color}
									onClick={() => setDraft((prev) => ({ ...prev, color }))}
									style={{ backgroundColor: color }}
									title={color}
									type="button"
								/>
							))}
						</div>
					</div>
					<DialogFooter>
						<Button
							onClick={() => setEditorOpen(false)}
							type="button"
							variant="outline"
						>
							Cancel
						</Button>
						<Button
							disabled={!draft.name.trim() || savingBot}
							onClick={() => void saveBot()}
							type="button"
						>
							{savingBot ? (
								<>
									<Loader2 className="size-4 animate-spin" />
									Saving...
								</>
							) : editingBot ? (
								"Save"
							) : (
								"Create bot"
							)}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			<BotMemoryDialog bot={memoryBot} onClose={() => setMemoryBot(null)} />

			<AlertDialog
				onOpenChange={(open) => {
					if (!open && !deletingBot) {
						setDeleteConfirmBot(null);
					}
				}}
				open={deleteConfirmBot !== null}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete bot?</AlertDialogTitle>
						<AlertDialogDescription>
							This permanently removes "{deleteConfirmBot?.name}" and its
							memory. Its past chat stays in session history.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={deletingBot}>Cancel</AlertDialogCancel>
						<AlertDialogAction
							className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
							disabled={deletingBot}
							onClick={(event) => {
								event.preventDefault();
								void confirmDeleteBot();
							}}
						>
							{deletingBot ? (
								<>
									<Loader2 className="size-4 animate-spin" />
									Deleting...
								</>
							) : (
								"Delete"
							)}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}

export function BotMemoryDialog({
	bot,
	onClose,
}: {
	bot: BotSummary | null;
	onClose: () => void;
}) {
	const [memory, setMemory] = useState("");
	const [loading, setLoading] = useState(false);
	const [saving, setSaving] = useState(false);

	useEffect(() => {
		if (!bot) {
			return;
		}
		let cancelled = false;
		setLoading(true);
		setMemory("");
		void readBotMemory(bot.id)
			.then((content) => {
				if (!cancelled) {
					setMemory(content);
				}
			})
			.catch(() => {})
			.finally(() => {
				if (!cancelled) {
					setLoading(false);
				}
			});
		return () => {
			cancelled = true;
		};
	}, [bot]);

	const saveMemory = useCallback(async () => {
		if (!bot || saving) {
			return;
		}
		setSaving(true);
		try {
			await updateBotMemory(bot.id, memory);
			onClose();
		} catch (error) {
			toast({
				variant: "destructive",
				title: "Could not save memory",
				description: error instanceof Error ? error.message : String(error),
			});
		} finally {
			setSaving(false);
		}
	}, [bot, memory, onClose, saving]);

	return (
		<Dialog
			onOpenChange={(open) => {
				if (!open) {
					onClose();
				}
			}}
			open={bot !== null}
		>
			<DialogContent className="sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						{bot ? (
							<BotAvatar
								className="size-6"
								color={bot.color}
								shape={bot.shape}
							/>
						) : null}
						{bot?.name} — memory
					</DialogTitle>
					<DialogDescription>
						The bot curates this markdown file itself and reads it at the start
						of every session. You can edit it directly.
					</DialogDescription>
				</DialogHeader>
				{loading ? (
					<div className="flex h-64 items-center justify-center">
						<Loader2 className="size-5 animate-spin text-muted-foreground" />
					</div>
				) : (
					<Textarea
						className="h-64 resize-none font-mono text-xs"
						onChange={(event) => setMemory(event.target.value)}
						placeholder="(empty — the bot has not written any memory yet)"
						value={memory}
					/>
				)}
				<DialogFooter>
					<Button onClick={onClose} type="button" variant="outline">
						Cancel
					</Button>
					<Button
						disabled={loading || saving}
						onClick={() => void saveMemory()}
						type="button"
					>
						{saving ? (
							<>
								<Loader2 className="size-4 animate-spin" />
								Saving...
							</>
						) : (
							"Save memory"
						)}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
