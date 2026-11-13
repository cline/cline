// Compiler-only public API checks; included by the package typecheck.
import { Plus } from "lucide-react";
import { createRef, forwardRef } from "react";
import {
	Badge,
	type BadgeProps,
	Button,
	IconButton,
	type InteractiveBadgeProps,
} from "../components/index.js";

// Existing span wrappers and new action wrappers must retain specific ref/event types.
interface LegacyBadgeProps extends BadgeProps {
	label: string;
}

const LegacyBadge = forwardRef<HTMLSpanElement, LegacyBadgeProps>(
	({ label, ...props }, ref) => (
		<Badge {...props} ref={ref}>
			{label}
		</Badge>
	),
);

interface ActionBadgeProps extends InteractiveBadgeProps {
	label: string;
}

const ActionBadge = forwardRef<HTMLButtonElement, ActionBadgeProps>(
	({ label, ...props }, ref) => (
		<Badge {...props} ref={ref}>
			{label}
		</Badge>
	),
);

<LegacyBadge
	label="Ready"
	ref={createRef<HTMLSpanElement>()}
	onClick={(event) => {
		event.currentTarget.focus();
		// @ts-expect-error Static callbacks target a span, not a button.
		event.currentTarget.disabled = true;
	}}
/>;
<ActionBadge
	interactive
	label="Apply"
	ref={createRef<HTMLButtonElement>()}
	onClick={(event) => {
		event.currentTarget.disabled = true;
	}}
/>;

// @ts-expect-error An interactive badge requires a button ref.
<Badge interactive ref={createRef<HTMLSpanElement>()}>
	Invalid ref
</Badge>;
// @ts-expect-error A static badge does not accept button-only props.
<Badge interactive={false} disabled>
	Invalid disabled span
</Badge>;
// @ts-expect-error Interactive badges always render a native button.
<Badge interactive asChild>
	<a href="/">Invalid composition</a>
</Badge>;

<Button leadingIcon={Plus}>Continue</Button>;
<IconButton aria-label="Add" icon={Plus} />;
// @ts-expect-error Icon slots accept components, not pre-sized elements.
<Button leadingIcon={<Plus size={32} />}>Invalid icon</Button>;
// @ts-expect-error The button size owns icon dimensions.
<Button iconSize={32}>Invalid size</Button>;
// @ts-expect-error Icon-only controls require an accessible name.
<IconButton icon={Plus} />;
