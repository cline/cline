import { type RefObject, useLayoutEffect, useRef } from "react";
import {
	findScrollViewport,
	followScroll,
} from "@/components/views/shared/page-scroll";

/** Fade content only once its sticky header reaches the scroll edge. */
export function useScrollHeaderFade(
	headerRef: RefObject<HTMLElement | null>,
	enabled = true,
) {
	const subscription = useRef<{
		header: HTMLElement;
		stop: () => void;
	} | null>(null);

	useLayoutEffect(() => {
		const header = headerRef.current;
		const viewport = findScrollViewport(header);
		if (subscription.current?.header === header && enabled) return;
		subscription.current?.stop();
		subscription.current = null;
		if (!enabled || !header || !viewport) return;

		const measure = () => {
			const style = getComputedStyle(header);
			const top = Number.parseFloat(style.top);
			const pinned = String(
				viewport.scrollTop > 0 &&
					style.position === "sticky" &&
					Number.isFinite(top) &&
					Math.abs(
						header.getBoundingClientRect().top -
							(viewport.getBoundingClientRect().top + top),
					) <= 1,
			);
			// Most scrolls change nothing, and an unchanged page needs no new layout.
			if (header.dataset.scrollFade === pinned) return undefined;
			return () => {
				header.dataset.scrollFade = pinned;
			};
		};
		const update = () => measure()?.();
		update();
		const stopFollowing = followScroll(viewport, measure);
		const observer = new ResizeObserver(update);
		observer.observe(viewport);
		observer.observe(header);
		if (header.parentElement) observer.observe(header.parentElement);
		subscription.current = {
			header,
			stop: () => {
				stopFollowing();
				observer.disconnect();
				delete header.dataset.scrollFade;
			},
		};
	});

	useLayoutEffect(
		() => () => {
			subscription.current?.stop();
			subscription.current = null;
		},
		[],
	);
}
