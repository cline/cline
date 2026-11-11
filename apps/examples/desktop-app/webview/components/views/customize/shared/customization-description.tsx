import { MemoizedMarkdown } from "@/components/ui/markdown";

/** Render catalog Markdown without changing the surrounding description typography. */
export function CustomizationDescription({
	children,
	className,
}: {
	children: string;
	className?: string;
}) {
	return (
		<div className={className}>
			<MemoizedMarkdown
				classNames="[font-size:inherit]! [line-height:inherit]! [letter-spacing:inherit]! [&_[data-streamdown=inline-code]]:text-[0.9em]!"
				content={children}
			/>
		</div>
	);
}
