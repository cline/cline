"use client";

import { IconButton } from "@cline/ui";
import { Copy, EllipsisVertical, FolderOpen } from "lucide-react";
import { useState } from "react";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAsyncAction } from "@/hooks/use-async-action";
import { toast } from "@/hooks/use-toast";
import { desktopClient } from "@/lib/desktop-client";
import { revealActionLabel } from "@/lib/reveal-label";

type PathActionsMenuProps = {
	path?: string;
	label?: string;
	onError: (error: string | null) => void;
};

export function PathActionsMenu({
	path,
	label = "Path",
	onError,
}: PathActionsMenuProps) {
	return (
		<PathActionsMenuContent
			key={path}
			path={path}
			label={label}
			onError={onError}
		/>
	);
}

function PathActionsMenuContent({
	path,
	label,
	onError,
}: PathActionsMenuProps & { label: string }) {
	const [copied, setCopied] = useState(false);
	const { pending: busy, run } = useAsyncAction();

	const runAction = async (action: "reveal" | "copy") => {
		if (!path) return;
		await run(
			async () => {
				onError(null);
				if (action === "reveal") {
					await desktopClient.invoke("reveal_path", { path });
					return;
				}
				setCopied(false);
				await navigator.clipboard.writeText(path);
				// The menu closes on selection, so confirm where it can be seen.
				toast({ title: `${label} copied` });
			},
			{
				onSuccess: () => {
					if (action === "copy") setCopied(true);
				},
				onError: () =>
					onError(
						action === "reveal"
							? `Could not open ${label.toLowerCase()} location.`
							: `Could not copy ${label.toLowerCase()}.`,
					),
			},
		);
	};

	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<IconButton
						aria-label={`${label} actions`}
						aria-busy={busy}
						size="xs"
						title={`${label} actions`}
						tone="neutral"
						type="button"
						variant="ghost"
						icon={EllipsisVertical}
					/>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end">
					<DropdownMenuItem
						disabled={!path || busy}
						onSelect={() => void runAction("reveal")}
					>
						<FolderOpen />
						{revealActionLabel()}
					</DropdownMenuItem>
					<DropdownMenuItem
						disabled={!path || busy}
						onSelect={() => void runAction("copy")}
					>
						<Copy />
						Copy path
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
			<output className="sr-only">{copied ? `${label} copied.` : ""}</output>
		</>
	);
}
