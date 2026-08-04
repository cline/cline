import {
	CheckCircleIcon,
	CircleIcon,
	ClockIcon,
	XCircleIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";

import type { ToolPart } from "./tool";

const statusIcons: Record<ToolPart["state"], ReactNode | null> = {
	"approval-requested": <ClockIcon className="size-4 text-yellow-600" />,
	"approval-responded": <CheckCircleIcon className="size-4 text-blue-600" />,
	"input-available": <ClockIcon className="size-4 animate-pulse" />,
	"input-streaming": <CircleIcon className="size-4" />,
	"output-available": <CheckCircleIcon className="size-4 text-green-600" />,
	"output-denied": <XCircleIcon className="size-4 text-orange-600" />,
	"output-error": <XCircleIcon className="size-4 text-red-600" />,
};

export function getStatusBadge(status: ToolPart["state"]) {
	return (
		<Badge className="gap-1.5 text-xs" variant="secondary">
			{statusIcons[status]}
		</Badge>
	);
}
