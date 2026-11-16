import { ItemCard } from "@cline/ui";
import {
	Check,
	CircleAlert,
	Clock,
	type LucideIcon,
	TriangleAlert,
} from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

export const ERROR_STATUS_LABELS = {
	"install-failed": "Install failed",
	"uninstall-failed": "Uninstall failed",
	"disconnect-failed": "Disconnect failed",
	"connection-error": "Connection error",
	"invalid-plugin": "Invalid plugin",
	"load-error": "Load error",
	"action-failed": "Action failed",
	"invalid-configuration": "Invalid configuration",
	"delete-failed": "Delete failed",
};

export type CustomizationStatus =
	| "installed"
	| "auth-required"
	| keyof typeof ERROR_STATUS_LABELS;

export function CustomizationItemStatus({
	status,
}: {
	status: CustomizationStatus;
}) {
	const Icon =
		status === "installed"
			? Check
			: status === "auth-required"
				? TriangleAlert
				: CircleAlert;
	const label =
		status === "installed"
			? "Installed"
			: status === "auth-required"
				? "Auth required"
				: ERROR_STATUS_LABELS[status];
	return (
		<output
			className={cn(
				"inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-xs",
				status === "installed"
					? "text-success-text"
					: status === "auth-required"
						? "text-warning-text"
						: "text-error-text",
			)}
		>
			<Icon aria-hidden="true" className="size-3.5" />
			{label}
		</output>
	);
}

export function CustomizationExecutionStatus({ count }: { count: number }) {
	const executed = count > 0;
	const Icon = executed ? Check : Clock;
	return (
		<output
			className={cn(
				"inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-xs",
				executed ? "text-success-text" : "text-muted-foreground",
			)}
		>
			<Icon aria-hidden="true" className="size-3.5" />
			{executed ? `${count} executed` : "Never executed"}
		</output>
	);
}

type CustomizationItemCardProps = Omit<
	ComponentProps<typeof ItemCard>,
	"icon" | "footer" | "children" | "primaryAction"
> & {
	icon: LucideIcon;
	glyph?: ReactNode;
	authorName?: string;
	status?: CustomizationStatus;
	primaryAction?: Omit<
		NonNullable<ComponentProps<typeof ItemCard>["primaryAction"]>,
		"expanded" | "controls"
	>;
};

/** Cards requiring attention show status only; recovery actions live in details. */
export function CustomizationItemCard({
	icon: Icon,
	glyph,
	authorName,
	status,
	actions,
	...props
}: CustomizationItemCardProps) {
	const author = authorName?.trim();
	return (
		<ItemCard
			{...props}
			icon={glyph ?? <Icon className="size-4.5" />}
			actions={
				<>
					{status ? <CustomizationItemStatus status={status} /> : null}
					{status && status !== "installed" ? null : actions}
				</>
			}
			footer={
				author ? (
					<span className="block truncate" title={author}>
						By {author}
					</span>
				) : null
			}
		/>
	);
}
