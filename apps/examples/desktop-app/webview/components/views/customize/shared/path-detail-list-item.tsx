"use client";

import { DetailListItem, type DetailListItemProps } from "@cline/ui";
import { useState } from "react";
import { PathActionsMenu } from "./path-actions-menu";

type PathDetailListItemProps = Omit<
	DetailListItemProps,
	"actions" | "description"
> & {
	path?: string;
	label?: string;
	showActions?: boolean;
};

export function PathDetailListItem(props: PathDetailListItemProps) {
	return <PathDetailListItemContent key={props.path} {...props} />;
}

function PathDetailListItemContent({
	path,
	label,
	showActions = true,
	...props
}: PathDetailListItemProps) {
	const [error, setError] = useState<string | null>(null);

	return (
		<DetailListItem
			{...props}
			description={
				showActions && error ? (
					<span className="text-error-text" role="alert">
						{error}
					</span>
				) : undefined
			}
			actions={
				showActions ? (
					<PathActionsMenu path={path} label={label} onError={setError} />
				) : undefined
			}
		/>
	);
}
