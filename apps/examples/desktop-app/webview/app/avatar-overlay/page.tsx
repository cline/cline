"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
	AVATAR_CHANGED_EVENT,
	AVATAR_NOTIFICATION_EVENT,
	AVATAR_SHOWN_EVENT,
	AVATAR_TASK_STATUS_EVENT,
	getSelectedAvatar,
	performAvatarOverlayAction,
	type AvatarNotification,
	type AvatarTaskStatus,
	type SelectedAvatar,
} from "@/lib/avatar";
import {
	AVATAR_ATLAS_COLUMNS,
	AVATAR_ATLAS_ROWS,
	AVATAR_CELL_HEIGHT,
	AVATAR_CELL_WIDTH,
	AVATAR_DISPLAY_SCALE,
	AVATAR_IDLE_DURATIONS_MS,
	AVATAR_JUMP_DURATIONS_MS,
	AVATAR_RUNNING_DURATIONS_MS,
	AVATAR_WAVE_DURATIONS_MS,
	avatarFrameBackgroundPosition,
} from "@/lib/avatar-sprite";

type Animation = "idle" | "running" | "jumping" | "waving";
type ContextMenuPosition = { x: number; y: number };

const DISPLAY_WIDTH = AVATAR_CELL_WIDTH * AVATAR_DISPLAY_SCALE;
const DISPLAY_HEIGHT = AVATAR_CELL_HEIGHT * AVATAR_DISPLAY_SCALE;
const CONTEXT_MENU_WIDTH = 132;
const CONTEXT_MENU_HEIGHT = 70;
const NOTIFICATION_DURATION_MS = 8_000;

export default function AvatarOverlayPage() {
	const [avatar, setAvatar] = useState<SelectedAvatar | null>(null);
	const [animation, setAnimation] = useState<Animation>("waving");
	const [frame, setFrame] = useState(0);
	const [contextMenu, setContextMenu] = useState<ContextMenuPosition | null>(
		null,
	);
	const [notification, setNotification] = useState<AvatarNotification | null>(
		null,
	);
	const [taskRunning, setTaskRunning] = useState(false);
	const [taskStatusHidden, setTaskStatusHidden] = useState(false);
	const notificationTimerRef = useRef<number | null>(null);
	const contextMenuRef = useRef<HTMLDivElement | null>(null);
	const dragTimerRef = useRef<number | null>(null);
	const draggingRef = useRef(false);
	const suppressActivationRef = useRef(false);

	const loadAvatar = useCallback(async () => {
		const selected = await getSelectedAvatar();
		setAvatar(selected);
		void import("@tauri-apps/api/window").then(({ getCurrentWindow }) =>
			getCurrentWindow().setTitle(selected.displayName),
		);
		setAnimation("waving");
		setFrame(0);
	}, []);

	useEffect(() => {
		void loadAvatar();
		let disposed = false;
		let unlisten: (() => void) | undefined;
		void import("@tauri-apps/api/event").then(async ({ listen }) => {
			const stopChanged = await listen(AVATAR_CHANGED_EVENT, () => {
				if (!disposed) void loadAvatar();
			});
			const stopShown = await listen(AVATAR_SHOWN_EVENT, () => {
				if (!disposed) {
					setAnimation("waving");
					setFrame(0);
				}
			});
			const stopNotification = await listen<AvatarNotification>(
				AVATAR_NOTIFICATION_EVENT,
				({ payload }) => {
					if (!payload?.title || !payload?.body) return;
					if (notificationTimerRef.current !== null) {
						window.clearTimeout(notificationTimerRef.current);
					}
					setNotification(payload);
					notificationTimerRef.current = window.setTimeout(() => {
						setNotification(null);
						notificationTimerRef.current = null;
					}, NOTIFICATION_DURATION_MS);
				},
			);
			const stopTaskStatus = await listen<AvatarTaskStatus>(
				AVATAR_TASK_STATUS_EVENT,
				({ payload }) => {
					const state = payload?.state;
					const running = state === "running";
					setTaskRunning(running);
					if (running) {
						setTaskStatusHidden(false);
						setAnimation("running");
						setFrame(0);
					} else if (state === "completed") {
						setAnimation("waving");
						setFrame(0);
					} else if (state === "failed" || state === "idle") {
						setAnimation("idle");
						setFrame(0);
					}
				},
			);
			const stop = () => {
				stopChanged();
				stopShown();
				stopNotification();
				stopTaskStatus();
			};
			if (disposed) stop();
			else unlisten = stop;
		});
		return () => {
			disposed = true;
			unlisten?.();
			if (notificationTimerRef.current !== null) {
				window.clearTimeout(notificationTimerRef.current);
			}
		};
	}, [loadAvatar]);

	useEffect(() => {
		if (!contextMenu) return;
		const dismissOutside = (event: PointerEvent) => {
			if (contextMenuRef.current?.contains(event.target as Node)) return;
			suppressActivationRef.current = true;
			setContextMenu(null);
		};
		const dismissOnBlur = () => setContextMenu(null);
		window.addEventListener("pointerdown", dismissOutside, true);
		window.addEventListener("blur", dismissOnBlur);
		return () => {
			window.removeEventListener("pointerdown", dismissOutside, true);
			window.removeEventListener("blur", dismissOnBlur);
		};
	}, [contextMenu]);

	useEffect(() => {
		const durations =
			animation === "running"
				? AVATAR_RUNNING_DURATIONS_MS
				: animation === "jumping"
				? AVATAR_JUMP_DURATIONS_MS
				: animation === "waving"
					? AVATAR_WAVE_DURATIONS_MS
					: AVATAR_IDLE_DURATIONS_MS;
		const timeout = window.setTimeout(() => {
			if (
				(animation === "waving" || animation === "jumping") &&
				frame === durations.length - 1
			) {
				setAnimation("idle");
				setFrame(0);
				return;
			}
			setFrame((current) => (current + 1) % durations.length);
		}, durations[frame]);
		return () => window.clearTimeout(timeout);
	}, [animation, frame]);

	const clearDragTimer = () => {
		if (dragTimerRef.current !== null) {
			window.clearTimeout(dragTimerRef.current);
			dragTimerRef.current = null;
		}
	};

	const handlePointerDown = (event: React.PointerEvent) => {
		if (event.button !== 0 || contextMenu) return;
		draggingRef.current = false;
		clearDragTimer();
		dragTimerRef.current = window.setTimeout(() => {
			draggingRef.current = true;
			void import("@tauri-apps/api/window").then(({ getCurrentWindow }) =>
				getCurrentWindow().startDragging(),
			);
		}, 180);
	};

	const handlePointerUp = () => {
		const wasDragging = draggingRef.current;
		clearDragTimer();
		draggingRef.current = false;
		if (suppressActivationRef.current) {
			suppressActivationRef.current = false;
			return;
		}
		if (!wasDragging && !contextMenu) {
			void performAvatarOverlayAction("open-cline");
		}
	};

	const closeAvatar = async () => {
		setContextMenu(null);
		await performAvatarOverlayAction("hide-avatar");
	};

	const animationRow =
		animation === "running" ? 1 : animation === "waving" ? 3 : animation === "jumping" ? 4 : 0;

	return (
		<main
			aria-label={`${avatar?.displayName ?? "Avatar"} desktop avatar`}
			className="relative h-screen w-screen select-none overflow-hidden bg-transparent"
		>
			<div
				aria-label="Open Cline"
				className="absolute bottom-0 right-0 cursor-pointer"
				onContextMenu={(event) => {
					event.preventDefault();
					clearDragTimer();
					setContextMenu({
						x: Math.min(event.clientX, window.innerWidth - CONTEXT_MENU_WIDTH),
						y: Math.min(
							event.clientY,
							window.innerHeight - CONTEXT_MENU_HEIGHT,
						),
					});
				}}
				onPointerDown={handlePointerDown}
				onPointerEnter={() => {
					if (animation === "idle") {
						setAnimation("jumping");
						setFrame(0);
					}
				}}
				onPointerLeave={clearDragTimer}
				onPointerUp={handlePointerUp}
				role="button"
				style={{ height: DISPLAY_HEIGHT, width: DISPLAY_WIDTH }}
				tabIndex={0}
			>
				{avatar ? (
					<div
						aria-hidden="true"
						style={{
							backgroundImage: `url(${JSON.stringify(avatar.spriteUrl)})`,
							backgroundPosition: avatarFrameBackgroundPosition(
								animationRow,
								frame,
								AVATAR_DISPLAY_SCALE,
							),
							backgroundRepeat: "no-repeat",
							backgroundSize: `${AVATAR_ATLAS_COLUMNS * AVATAR_CELL_WIDTH * AVATAR_DISPLAY_SCALE}px ${AVATAR_ATLAS_ROWS * AVATAR_CELL_HEIGHT * AVATAR_DISPLAY_SCALE}px`,
							height: DISPLAY_HEIGHT,
							imageRendering: "pixelated",
							width: DISPLAY_WIDTH,
						}}
					/>
				) : null}
			</div>
			{taskRunning && !taskStatusHidden ? (
				<div
					aria-label="Cline is working"
					aria-live="polite"
					className="absolute bottom-[148px] right-1 z-20 flex w-[140px] items-center justify-center rounded-2xl border border-white/20 bg-neutral-950/95 px-4 py-4 text-2xl tracking-[0.4em] text-white shadow-2xl backdrop-blur"
				>
					<span className="relative -right-1 -top-1 inline-flex gap-1">
						<span className="animate-bounce [animation-delay:-0.3s]">•</span>
						<span className="animate-bounce [animation-delay:-0.15s]">•</span>
						<span className="animate-bounce">•</span>
					</span>
					<button
						aria-label="Hide notification"
						className="absolute right-2 top-1 rounded-md px-1 text-sm leading-none text-white/60 hover:bg-white/10 hover:text-white"
						onClick={() => setTaskStatusHidden(true)}
						type="button"
					>
						×
					</button>
					<div className="absolute -bottom-2 right-12 size-4 rotate-45 border-b border-r border-white/20 bg-neutral-950/95" />
				</div>
			) : notification ? (
				<div
					aria-live="polite"
					className="absolute bottom-[148px] right-1 z-20 w-[280px] rounded-2xl border border-white/20 bg-neutral-950/95 px-4 py-3 text-white shadow-2xl backdrop-blur"
				>
					<div className="absolute -bottom-2 right-12 size-4 rotate-45 border-b border-r border-white/20 bg-neutral-950/95" />
					<div className="relative flex items-start gap-3">
						<div className="min-w-0 flex-1">
							<div className="text-xs font-semibold">{notification.title}</div>
							<div className="mt-1 text-xs leading-4 text-white/75">
								{notification.body}
							</div>
						</div>
						<button
							aria-label="Hide notification"
							className="-mr-1 -mt-1 rounded-md px-1.5 py-0.5 text-lg leading-none text-white/60 hover:bg-white/10 hover:text-white"
							onClick={() => {
								setNotification(null);
								if (notificationTimerRef.current !== null) {
									window.clearTimeout(notificationTimerRef.current);
									notificationTimerRef.current = null;
								}
							}}
							type="button"
						>
							×
						</button>
					</div>
				</div>
			) : null}
			{contextMenu ? (
				<div
					className="absolute z-30 w-[132px] overflow-hidden rounded-md border border-white/15 bg-neutral-950/95 p-1 text-[11px] text-white shadow-xl backdrop-blur"
					ref={contextMenuRef}
					style={{ left: contextMenu.x, top: contextMenu.y }}
				>
					<button
						className="block w-full rounded px-2 py-1.5 text-left hover:bg-white/10"
						onClick={() => {
							setContextMenu(null);
							void performAvatarOverlayAction("open-cline");
						}}
						type="button"
					>
						Open Cline
					</button>
					<button
						className="block w-full rounded px-2 py-1.5 text-left text-red-300 hover:bg-white/10"
						onClick={() => void closeAvatar()}
						type="button"
					>
						Close avatar
					</button>
				</div>
			) : null}
		</main>
	);
}
