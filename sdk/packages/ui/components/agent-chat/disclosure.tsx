"use client";

import {
	type HTMLAttributes,
	useCallback,
	useEffect,
	useId,
	useState,
} from "react";

function classNames(...values: Array<string | undefined | false>): string {
	return values.filter(Boolean).join(" ");
}

export type DisclosureState = {
	isOpen: boolean;
	panelId: string;
	setIsOpen: (open: boolean) => void;
};

export function useDisclosureState({
	defaultOpen = false,
	enabled = true,
	onOpenChange,
	open,
}: {
	defaultOpen?: boolean;
	enabled?: boolean;
	onOpenChange?: (open: boolean) => void;
	open?: boolean;
}): DisclosureState {
	const [internalOpen, setInternalOpen] = useState(defaultOpen);
	const panelId = useId();
	const isOpen = enabled && (open ?? internalOpen);
	const setIsOpen = useCallback(
		(nextOpen: boolean) => {
			if (!enabled) return;
			if (open === undefined) setInternalOpen(nextOpen);
			onOpenChange?.(nextOpen);
		},
		[enabled, onOpenChange, open],
	);

	return { isOpen, panelId, setIsOpen };
}

export type DisclosureContentPresentation = "panel" | "rail";

export type DisclosureContentProps = Omit<
	HTMLAttributes<HTMLDivElement>,
	"hidden" | "id"
> & {
	contentClassName: string;
	isOpen: boolean;
	lazyContent?: boolean;
	panelId: string;
	presentation?: DisclosureContentPresentation;
};

export function DisclosureContent({
	className,
	contentClassName,
	isOpen,
	lazyContent = false,
	panelId,
	presentation = "panel",
	...props
}: DisclosureContentProps) {
	const [hasOpened, setHasOpened] = useState(isOpen);
	useEffect(() => {
		if (isOpen) setHasOpened(true);
	}, [isOpen]);
	const shouldRenderContent = !lazyContent || isOpen || hasOpened;

	return (
		<div
			aria-hidden={!isOpen}
			className="cline-chat-disclosure-content-motion"
			data-state={isOpen ? "open" : "closed"}
			id={panelId}
			inert={!isOpen ? true : undefined}
		>
			<div className="cline-chat-disclosure-content-motion-inner">
				{shouldRenderContent ? (
					<div
						{...props}
						className={classNames(
							contentClassName,
							presentation === "rail" && "cline-chat-panel-rail",
							className,
						)}
					/>
				) : null}
			</div>
		</div>
	);
}
