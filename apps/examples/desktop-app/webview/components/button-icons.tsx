import { ChevronRight } from "lucide-react";
import type { SVGProps } from "react";
import { cn } from "@/lib/utils";

export function AdvancedOptionsIcon({
	className,
	...props
}: SVGProps<SVGSVGElement>) {
	return (
		<ChevronRight
			{...props}
			className={cn(
				"transition-transform group-aria-expanded:rotate-90",
				className,
			)}
		/>
	);
}
