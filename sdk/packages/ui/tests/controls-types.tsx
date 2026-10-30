// Compiler-only regression fixture; included by the package typecheck, not Vitest.
import { createRef, forwardRef } from "react";
import {
	Badge,
	type BadgeProps,
	type InteractiveBadgeProps,
} from "../components/badge.js";
import { Switch, type SwitchProps } from "../components/switch.js";

// Existing consumers can extend BadgeProps and forward a span ref unchanged.
interface LegacyBadgeProps extends BadgeProps {
	label: string;
}

export const LegacyBadge = forwardRef<HTMLSpanElement, LegacyBadgeProps>(
	({ label, ...props }, ref) => (
		<Badge {...props} ref={ref}>
			{label}
		</Badge>
	),
);

interface ActionBadgeProps extends InteractiveBadgeProps {
	label: string;
}

export const ActionBadge = forwardRef<HTMLButtonElement, ActionBadgeProps>(
	({ label, ...props }, ref) => (
		<Badge {...props} ref={ref}>
			{label}
		</Badge>
	),
);

interface PreferenceSwitchProps extends SwitchProps {
	label: string;
}

export const PreferenceSwitch = forwardRef<
	HTMLInputElement,
	PreferenceSwitchProps
>(({ label, ...props }, ref) => (
	<Switch {...props} aria-label={label} ref={ref} />
));

export function ControlsTypeCompatibility() {
	const spanRef = createRef<HTMLSpanElement>();
	const buttonRef = createRef<HTMLButtonElement>();
	const inputRef = createRef<HTMLInputElement>();

	return (
		<>
			<LegacyBadge
				label="Ready"
				ref={spanRef}
				onClick={(event) => {
					const span: HTMLSpanElement = event.currentTarget;
					span.focus();
					// @ts-expect-error Legacy callbacks target a span, not a button.
					event.currentTarget.disabled = true;
				}}
			/>
			<ActionBadge
				interactive
				label="Apply"
				ref={buttonRef}
				onClick={(event) => {
					const button: HTMLButtonElement = event.currentTarget;
					button.disabled = true;
				}}
			/>
			<Badge
				interactive
				ref={buttonRef}
				onClick={(event) => event.currentTarget.focus()}
			>
				Apply
			</Badge>
			<PreferenceSwitch
				label="Notifications"
				ref={inputRef}
				tone="neutral"
				onChange={(event) => {
					const input: HTMLInputElement = event.currentTarget;
					input.focus();
				}}
			/>
			{/* @ts-expect-error An interactive badge requires a button ref. */}
			<Badge interactive ref={spanRef}>
				Invalid ref
			</Badge>
			{/* @ts-expect-error A static badge does not accept button-only props. */}
			<Badge interactive={false} disabled>
				Invalid disabled span
			</Badge>
			{/* @ts-expect-error Interactive badges always render a native button. */}
			<Badge interactive asChild>
				<a href="/">Invalid composition</a>
			</Badge>
		</>
	);
}
