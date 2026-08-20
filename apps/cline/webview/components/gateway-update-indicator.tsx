"use client";

import { CircleArrowUp, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { desktopClient } from "@/lib/desktop-client";
import { cn } from "@/lib/utils";

type GatewayUpdateStatus = { updateRequired: boolean };

export function GatewayUpdateIndicator({ className }: { className?: string }) {
	const [required, setRequired] = useState(false);
	const [updating, setUpdating] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		void desktopClient.invoke<GatewayUpdateStatus>("get_gateway_update_status")
			.then((status) => setRequired(status.updateRequired))
			.catch(() => {});
	}, []);

	if (!required) return null;

	return (
		<Popover>
			<PopoverTrigger asChild>
				<Button
					aria-label="Gateway update required"
					className={cn("relative size-8 shrink-0 justify-center px-0 text-amber-500 hover:text-amber-400", className)}
					title="Gateway update required"
					type="button"
					variant="sidebarItem"
				>
					<CircleArrowUp className="size-4" />
					<span className="absolute right-1 top-1 size-2 rounded-full bg-amber-500" />
				</Button>
			</PopoverTrigger>
			<PopoverContent align="start" className="w-72 p-3" side="bottom">
				<p className="text-sm font-medium">Gateway update required</p>
				<p className="mt-1 text-xs text-muted-foreground">
					A Gateway from an older Cline Bots version is running. Update it to the server bundled with this app before continuing.
				</p>
				{error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}
				<Button
					className="mt-3 w-full"
					disabled={updating}
					onClick={() => {
						setUpdating(true);
						setError(null);
						void desktopClient.invoke("update_gateway_server").then(
							() => window.location.reload(),
							(reason) => {
								setError(reason instanceof Error ? reason.message : String(reason));
								setUpdating(false);
							},
						);
					}}
					size="sm"
					type="button"
				>
					{updating ? <><Loader2 className="size-4 animate-spin" />Updating Gateway…</> : "Update Gateway"}
				</Button>
			</PopoverContent>
		</Popover>
	);
}
