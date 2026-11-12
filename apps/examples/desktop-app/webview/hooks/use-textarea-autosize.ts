import { type RefObject, useLayoutEffect, useRef } from "react";

function supportsFieldSizing(): boolean {
	return (
		typeof CSS !== "undefined" && CSS.supports?.("field-sizing", "content")
	);
}

/**
 * Grow a textarea with its content where `field-sizing: content` is missing
 * (WebKit before Safari 26.2, including the macOS and Linux webviews, and
 * Firefox before 152). Engines with native support are left alone.
 */
export function useTextareaAutosize(
	ref: RefObject<HTMLTextAreaElement | null>,
	_value: string,
) {
	const subscription = useRef<{
		textarea: HTMLTextAreaElement;
		resize: () => void;
		observer?: ResizeObserver;
	} | null>(null);

	useLayoutEffect(() => {
		const textarea = ref.current;
		if (!textarea || supportsFieldSizing()) {
			subscription.current?.observer?.disconnect();
			subscription.current = null;
			return;
		}
		if (subscription.current?.textarea === textarea) {
			subscription.current.resize();
			return;
		}
		subscription.current?.observer?.disconnect();
		const resize = () => {
			// Hidden fields report no scroll height; the observer resizes on reveal.
			if (textarea.scrollHeight === 0) return;
			const borders = textarea.offsetHeight - textarea.clientHeight;
			textarea.style.height = "auto";
			textarea.style.height = `${textarea.scrollHeight + borders}px`;
		};
		resize();
		if (typeof ResizeObserver === "undefined") {
			subscription.current = { textarea, resize };
			return;
		}
		// Width changes rewrap the text, and a revealed field gains a size.
		let width = textarea.offsetWidth;
		const observer = new ResizeObserver(() => {
			if (textarea.offsetWidth === width) return;
			width = textarea.offsetWidth;
			resize();
		});
		observer.observe(textarea);
		subscription.current = { textarea, resize, observer };
	});

	useLayoutEffect(
		() => () => {
			subscription.current?.observer?.disconnect();
			subscription.current = null;
		},
		[],
	);
}
