import type { KeyboardEvent, ReactNode, TextareaHTMLAttributes } from "react";
import { useLayoutEffect, useRef } from "react";
import { Button } from "./button.js";
import { cx } from "./utils.js";

function ArrowIcon() {
	return (
		<svg aria-hidden="true" fill="none" viewBox="0 0 16 16">
			<path
				d="M8 12.5v-9m0 0L4.5 7M8 3.5 11.5 7"
				stroke="currentColor"
				strokeLinecap="round"
				strokeLinejoin="round"
				strokeWidth="1.5"
			/>
		</svg>
	);
}

function StopIcon() {
	return (
		<svg aria-hidden="true" fill="none" viewBox="0 0 16 16">
			<rect
				fill="currentColor"
				height="7"
				rx="1.25"
				width="7"
				x="4.5"
				y="4.5"
			/>
		</svg>
	);
}

export interface AgentComposerProps
	extends Omit<
		TextareaHTMLAttributes<HTMLTextAreaElement>,
		"onChange" | "value"
	> {
	actions?: ReactNode;
	className?: string;
	footer?: ReactNode;
	loading?: boolean;
	onStop?: () => void;
	onSubmit: () => void;
	onValueChange: (value: string) => void;
	running?: boolean;
	stopLabel?: string;
	submitDisabled?: boolean;
	submitLabel?: string;
	submitOnEnter?: boolean;
	variant?: "conversation" | "welcome";
	value: string;
}

export function AgentComposer({
	actions,
	className,
	disabled,
	enterKeyHint,
	footer,
	loading = false,
	onKeyDown,
	onStop,
	onSubmit,
	onValueChange,
	placeholder = "Describe what you want to build…",
	readOnly,
	running = false,
	stopLabel = "Stop the current run",
	submitDisabled = false,
	submitLabel = "Send message",
	submitOnEnter = true,
	variant = "conversation",
	value,
	...textareaProps
}: AgentComposerProps) {
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const empty = value.trim().length === 0;

	useLayoutEffect(() => {
		const textarea = textareaRef.current;
		if (!textarea) return;
		textarea.style.height = "auto";
		textarea.style.height = `${textarea.scrollHeight}px`;
	});

	function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
		onKeyDown?.(event);
		if (event.defaultPrevented) return;
		if (
			submitOnEnter &&
			event.key === "Enter" &&
			!event.shiftKey &&
			!event.repeat &&
			!event.nativeEvent.isComposing &&
			event.nativeEvent.keyCode !== 229 &&
			!disabled &&
			!empty &&
			!submitDisabled &&
			!loading &&
			!running
		) {
			event.preventDefault();
			onSubmit();
		}
	}

	return (
		<div
			className={cx(
				"cline-ui-composer",
				`cline-ui-composer--${variant}`,
				className,
			)}
		>
			<textarea
				aria-label={textareaProps["aria-label"] ?? "Message the agent"}
				aria-busy={loading || undefined}
				autoComplete={textareaProps.autoComplete ?? "off"}
				className="cline-ui-composer__input"
				disabled={disabled}
				enterKeyHint={enterKeyHint ?? (submitOnEnter ? "send" : "enter")}
				name={textareaProps.name ?? "prompt"}
				onChange={(event) => onValueChange(event.target.value)}
				onKeyDown={handleKeyDown}
				placeholder={placeholder}
				readOnly={readOnly || loading}
				ref={textareaRef}
				rows={textareaProps.rows ?? (variant === "welcome" ? 2 : 1)}
				value={value}
				{...textareaProps}
			/>
			<div className="cline-ui-composer__toolbar">
				<div className="cline-ui-composer__actions">{actions}</div>
				{running && onStop ? (
					<Button
						aria-label={stopLabel}
						disabled={disabled}
						iconOnly
						onClick={onStop}
						size="sm"
						variant="secondary"
					>
						<StopIcon />
					</Button>
				) : !running ? (
					<Button
						aria-label={submitLabel}
						disabled={disabled || empty || submitDisabled}
						iconOnly
						loading={loading}
						onClick={onSubmit}
						size="sm"
						variant="primary"
					>
						{loading ? null : <ArrowIcon />}
					</Button>
				) : null}
			</div>
			{footer ? (
				<div className="cline-ui-composer__footer">{footer}</div>
			) : null}
		</div>
	);
}
