import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function SideConversationMenu({ onDelete }: { onDelete: () => void }) {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					variant="ghost"
					size="icon-xs"
					aria-label="Side chat actions"
					title="Side chat actions"
					className="text-muted-foreground"
				>
					<MoreHorizontal className="size-4" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent side="top" align="end">
				<DropdownMenuItem variant="destructive" onSelect={onDelete}>
					Delete side chat
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
