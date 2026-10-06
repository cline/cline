"use client";

import {
	type KeyboardEvent as ReactKeyboardEvent,
	type ReactNode,
	type RefObject,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { ICONS, Icon } from "./icons.js";

/** Toolbar button and the PNG/MMD download menu for the Mermaid block. */

export function ToolbarButton({
	children,
	disabled,
	label,
	onClick,
	buttonRef,
}: {
	buttonRef?: RefObject<HTMLButtonElement | null>;
	children: ReactNode;
	disabled?: boolean;
	label: string;
	onClick: () => void;
}) {
	return (
		<button
			aria-label={label}
			className="cline-mermaid__button"
			disabled={disabled}
			onClick={onClick}
			ref={buttonRef}
			title={label}
			type="button"
		>
			{children}
		</button>
	);
}

export function DownloadMenu({
	onMmd,
	onPng,
	pngDisabled,
}: {
	onMmd: () => void;
	onPng: () => void;
	pngDisabled: boolean;
}) {
	const [open, setOpen] = useState(false);
	const rootRef = useRef<HTMLDivElement>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);

	const close = useCallback((restoreFocus: boolean) => {
		setOpen(false);
		if (restoreFocus) triggerRef.current?.focus();
	}, []);

	useEffect(() => {
		if (!open) return;
		rootRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
		const onPointerDown = (event: PointerEvent) => {
			if (
				event.target instanceof Node &&
				rootRef.current?.contains(event.target)
			) {
				return;
			}
			setOpen(false);
		};
		document.addEventListener("pointerdown", onPointerDown);
		return () => document.removeEventListener("pointerdown", onPointerDown);
	}, [open]);

	const onMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
		if (event.key === "Escape") {
			// Keep an enclosing fullscreen dialog open.
			event.preventDefault();
			event.stopPropagation();
			close(true);
			return;
		}
		if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
		event.preventDefault();
		const items = [
			...event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]'),
		].filter((item) => !item.hasAttribute("disabled"));
		if (items.length === 0) return;
		const active = document.activeElement;
		const index = active instanceof HTMLElement ? items.indexOf(active) : -1;
		const step = event.key === "ArrowDown" ? 1 : -1;
		items[(index + step + items.length) % items.length]?.focus();
	};

	const choose = (action: () => void) => () => {
		close(true);
		action();
	};

	return (
		<div className="cline-mermaid__menu-root" ref={rootRef}>
			<button
				aria-expanded={open}
				aria-haspopup="menu"
				aria-label="Download diagram"
				className="cline-mermaid__button"
				onClick={() => setOpen((current) => !current)}
				ref={triggerRef}
				title="Download diagram"
				type="button"
			>
				<Icon>{ICONS.download}</Icon>
			</button>
			{open ? (
				<div
					aria-label="Download diagram"
					className="cline-mermaid__menu"
					onKeyDown={onMenuKeyDown}
					role="menu"
					tabIndex={-1}
				>
					<button
						className="cline-mermaid__menu-item"
						disabled={pngDisabled}
						onClick={choose(onPng)}
						role="menuitem"
						type="button"
					>
						PNG image
					</button>
					<button
						className="cline-mermaid__menu-item"
						onClick={choose(onMmd)}
						role="menuitem"
						type="button"
					>
						Mermaid source (.mmd)
					</button>
				</div>
			) : null}
		</div>
	);
}
