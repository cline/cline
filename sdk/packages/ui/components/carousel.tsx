"use client";

import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	type ComponentProps,
	type ReactNode,
} from "react";
import useEmblaCarousel from "embla-carousel-react";
import { ArrowLeft, ArrowRight } from "lucide-react";

import { clsx as cn } from "clsx";

export type CarouselApi = ReturnType<typeof useEmblaCarousel>[1];
type CarouselOptions = Parameters<typeof useEmblaCarousel>[0];
const Context = createContext<{
	viewport: ReturnType<typeof useEmblaCarousel>[0];
	api: CarouselApi;
} | null>(null);
function useCarousel() {
	const value = useContext(Context);
	if (!value) throw new Error("Carousel components must be inside Carousel");
	return value;
}
export function Carousel({
	opts,
	setApi,
	children,
	className,
	onKeyDown,
	...props
}: ComponentProps<"div"> & {
	opts?: CarouselOptions;
	setApi?: (api: CarouselApi) => void;
	children: ReactNode;
}) {
	const [viewport, api] = useEmblaCarousel({ align: "start", ...opts });
	useEffect(() => {
		setApi?.(api);
	}, [api, setApi]);
	const handleKeyDown = useCallback(
		(event: React.KeyboardEvent<HTMLDivElement>) => {
			onKeyDown?.(event);
			if (event.defaultPrevented) return;
			if (
				event.target instanceof HTMLElement &&
				event.target.closest("input, textarea, select")
			)
				return;
			if (event.key === "ArrowLeft") {
				event.preventDefault();
				api?.scrollPrev();
			}
			if (event.key === "ArrowRight") {
				event.preventDefault();
				api?.scrollNext();
			}
		},
		[api, onKeyDown],
	);
	return (
		<Context.Provider value={{ viewport, api }}>
			{/* biome-ignore lint/a11y/useSemanticElements: section would break carousel structure */}
			<div
				{...props}
				className={cn("relative", className)}
				role="region"
				tabIndex={props.tabIndex ?? 0}
				aria-roledescription="carousel"
				onKeyDown={handleKeyDown}
			>
				{children}
			</div>
		</Context.Provider>
	);
}
export function CarouselContent({
	className,
	...props
}: ComponentProps<"div">) {
	const { viewport } = useCarousel();
	return (
		<div ref={viewport} className="overflow-hidden">
			<div {...props} className={cn("flex touch-pan-y", className)} />
		</div>
	);
}
export function CarouselItem({ className, ...props }: ComponentProps<"div">) {
	return (
		// biome-ignore lint/a11y/useSemanticElements: fieldset would break layout styling
		<div
			{...props}
			role="group"
			aria-roledescription="slide"
			className={cn("min-w-0 shrink-0 grow-0 basis-full", className)}
		/>
	);
}
export function CarouselPrevious(props: ComponentProps<"button">) {
	const { api } = useCarousel();
	return (
		<button
			type="button"
			{...props}
			onClick={(event) => {
				props.onClick?.(event);
				api?.scrollPrev();
			}}
			aria-label="Previous screenshot"
		>
			<ArrowLeft className="size-4" />
		</button>
	);
}
export function CarouselNext(props: ComponentProps<"button">) {
	const { api } = useCarousel();
	return (
		<button
			type="button"
			{...props}
			onClick={(event) => {
				props.onClick?.(event);
				api?.scrollNext();
			}}
			aria-label="Next screenshot"
		>
			<ArrowRight className="size-4" />
		</button>
	);
}
