"use client";

import { clsx } from "clsx";
import type { ComponentPropsWithoutRef, ReactNode } from "react";

export type AgentSessionContentProps = ComponentPropsWithoutRef<"div">;

/** Shared width constraint for both the transcript and its composer. */
export function AgentSessionContent({
	children,
	className,
	...props
}: AgentSessionContentProps) {
	return (
		<div
			{...props}
			className={clsx(
				"mx-auto w-full min-w-0 max-w-(--breakpoint-lg)",
				className,
			)}
		>
			{children}
		</div>
	);
}

export interface AgentConversationHeaderProps
	extends Omit<ComponentPropsWithoutRef<"header">, "children" | "title"> {
	/** Status, title/editor, and title menu, in reading order. */
	children: ReactNode;
	/** Host-owned controls. Omit to remove the action group entirely. */
	actions?: ReactNode;
}

/** Presentation only: title editing, menus, navigation and native chrome stay with the host. */
export function AgentConversationHeader({
	children,
	actions,
	className,
	...props
}: AgentConversationHeaderProps) {
	return (
		<header
			{...props}
			className={clsx(
				"flex h-12 items-center justify-between gap-2 px-4",
				className,
			)}
		>
			<div className="flex min-w-0 flex-1 items-center gap-2">{children}</div>
			{actions != null && actions !== false ? (
				<div className="flex shrink-0 items-center gap-2">{actions}</div>
			) : null}
		</header>
	);
}

export interface AgentConversationLayoutProps {
	/** Switches between the welcome composition and an existing conversation. */
	welcome: boolean;
	welcomeHeader?: ReactNode;
	body: ReactNode;
	composer: ReactNode;
	notice?: ReactNode;
	/** An onboarding or setup surface above the composer. */
	welcomeSetup?: ReactNode;
	/** Hide without unmounting the welcome composer while setup is shown. */
	hideWelcomeComposer?: boolean;
	welcomeFooter?: ReactNode;
	/** Optional host animation class for the conversation body. */
	bodyClassName?: string;
}

/** Keeps transcript and composer containers mounted while the welcome state changes. */
export function AgentConversationLayout({
	welcome,
	welcomeHeader,
	body,
	composer,
	notice,
	welcomeSetup,
	hideWelcomeComposer = false,
	welcomeFooter,
	bodyClassName,
}: AgentConversationLayoutProps) {
	return (
		<div
			className={
				welcome
					? "relative h-full min-h-0 overflow-hidden bg-cline-ui-background"
					: "contents"
			}
		>
			<div
				className={
					welcome
						? "relative z-10 h-full w-full overflow-x-hidden overflow-y-auto"
						: "contents"
				}
			>
				<div
					className={
						welcome
							? "mx-auto flex w-full max-w-240 flex-col px-6 pb-32 pt-[clamp(8rem,26vh,17rem)] max-[720px]:px-4 max-[720px]:pb-20 max-[720px]:pt-16"
							: "contents"
					}
				>
					{welcome ? welcomeHeader : null}
					<div
						className={
							welcome
								? "hidden"
								: clsx(bodyClassName, "h-full min-h-0 overflow-hidden")
						}
						key="conversation-body"
					>
						{body}
					</div>
					{welcome ? notice : null}
					{welcome ? welcomeSetup : null}
					<div
						className={clsx(
							welcome ? "mt-4 w-full" : "z-20 shrink-0 px-6 pb-6",
							welcome && hideWelcomeComposer && "hidden",
						)}
						key="persistent-composer"
					>
						{welcome ? (
							composer
						) : (
							<AgentSessionContent>{composer}</AgentSessionContent>
						)}
					</div>
					{welcome ? welcomeFooter : null}
				</div>
			</div>
		</div>
	);
}
