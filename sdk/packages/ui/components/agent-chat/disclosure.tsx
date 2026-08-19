"use client";

import {
	type HTMLAttributes,
	version as reactVersion,
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

type InertAttributeValue = boolean | "" | undefined;

export function getInertAttributeValue(
	isOpen: boolean,
	version = reactVersion,
): InertAttributeValue {
	if (isOpen) return undefined;
	const majorVersion = Number.parseInt(version, 10);
	return majorVersion >= 19 ? true : "";
}

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
	// React 18 treats `inert` as an unknown string attribute and drops boolean
	// `true`, while React 19 models it as a boolean and drops an empty string.
	// Select the form understood by the consumer's React runtime.
	const inert = getInertAttributeValue(isOpen);

	return (
		<div
			aria-hidden={!isOpen}
			className="cline-chat-disclosure-content-motion"
			data-state={isOpen ? "open" : "closed"}
			id={panelId}
			inert={inert as boolean | undefined}
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
