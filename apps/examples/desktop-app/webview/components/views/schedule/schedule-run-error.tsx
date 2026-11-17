import { useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/** A run's error, shortened to a few lines until the reader asks for all of it. */
export function ScheduleRunError({ message }: { message: string }) {
	const textRef = useRef<HTMLSpanElement>(null);
	const [expanded, setExpanded] = useState(false);
	const [overflows, setOverflows] = useState(false);
	// biome-ignore lint/correctness/useExhaustiveDependencies: a different message can be longer or shorter.
	useLayoutEffect(() => {
		const text = textRef.current;
		if (!text || expanded) return;
		const measure = () =>
			setOverflows(text.scrollHeight > text.clientHeight + 1);
		measure();
		if (typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(measure);
		observer.observe(text);
		return () => observer.disconnect();
	}, [message, expanded]);
	return (
		<span className="flex min-w-0 flex-col items-start gap-1">
			<span
				ref={textRef}
				className={cn(
					"whitespace-pre-wrap break-words text-muted-foreground text-sm",
					!expanded && "line-clamp-5",
				)}
			>
				{message}
			</span>
			{overflows || expanded ? (
				<button
					type="button"
					aria-expanded={expanded}
					className="cursor-pointer rounded-sm text-foreground text-xs underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-ring"
					onClick={() => setExpanded((value) => !value)}
				>
					{expanded ? "Show less" : "Show full error"}
				</button>
			) : null}
		</span>
	);
}
