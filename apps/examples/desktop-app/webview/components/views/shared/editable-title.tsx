import type { Ref } from "react";
import { Input } from "@/components/ui/input";

/** A page title edited in place: it reads as the heading and behaves as a field. */
export function EditableTitle({
	titleRef,
	inputRef,
	id,
	title,
	label,
	placeholder,
	value,
	onChange,
	onFocus,
	disabled = false,
	invalid = false,
}: {
	/** The heading element, for the compact header that appears on scroll. */
	titleRef: Ref<HTMLHeadingElement>;
	inputRef?: Ref<HTMLInputElement>;
	id: string;
	/** The heading's text: the name, or a stand-in while it is empty. */
	title: string;
	label: string;
	placeholder: string;
	value: string;
	onChange: (value: string) => void;
	onFocus?: () => void;
	disabled?: boolean;
	invalid?: boolean;
}) {
	return (
		<h1 ref={titleRef} aria-label={title} className="min-w-0 flex-1">
			<Input
				ref={inputRef}
				id={id}
				aria-label={label}
				aria-invalid={invalid || undefined}
				placeholder={placeholder}
				disabled={disabled}
				value={value}
				onFocus={onFocus}
				onChange={(event) => onChange(event.target.value)}
				className="-ml-1 h-8 w-full border-transparent bg-transparent px-1 py-0 font-cline-ui-medium text-2xl shadow-none md:text-2xl dark:bg-transparent"
			/>
		</h1>
	);
}
