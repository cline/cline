import Link from "next/link";
import { cn } from "@/lib/utils";

export function LogoMark({ className }: { className?: string }) {
	return (
		<svg viewBox="0 0 40 40" fill="none" aria-hidden="true" className={cn("size-9", className)}>
			<rect width="40" height="40" rx="11" fill="#0B0E13" />
			<rect
				x="0.75"
				y="0.75"
				width="38.5"
				height="38.5"
				rx="10.25"
				stroke="white"
				strokeOpacity="0.1"
			/>
			<path d="M11 11.5h18" stroke="#C2EF4A" strokeWidth="1.4" strokeLinecap="round" />
			<path
				d="M14.4 27.5h3.1l3.4-9.1-3.3 1.7"
				stroke="#F4F6F8"
				strokeWidth="2.1"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
			<path d="M23.2 18.6v8.9" stroke="#F4F6F8" strokeWidth="2.1" strokeLinecap="round" />
			<circle cx="29.3" cy="12.2" r="2.1" fill="#C2EF4A" />
		</svg>
	);
}

export function Wordmark({ className }: { className?: string }) {
	return (
		<span className={cn("inline-flex items-center gap-2.5", className)}>
			<LogoMark className="size-8" />
			<span className="font-display text-[1.05rem] font-semibold tracking-[-0.03em] text-mist-50">
				21 Agent
			</span>
		</span>
	);
}

export function BrandLink({ href = "/" }: { href?: string }) {
	return (
		<Link href={href} className="inline-flex items-center gap-2.5" aria-label="21 Agent home">
			<LogoMark className="size-8" />
			<span className="font-display text-[1.05rem] font-semibold tracking-[-0.03em]">21 Agent</span>
		</Link>
	);
}

export function Attribution() {
	return (
		<p className="text-[0.6875rem] leading-relaxed text-mist-600">
			Agent runtime adapted from{" "}
			<a
				href="https://github.com/cline/cline"
				className="text-mist-400 underline decoration-white/20 underline-offset-2 hover:text-mist-200"
				target="_blank"
				rel="noreferrer"
			>
				Cline
			</a>{" "}
			(Apache-2.0). Sandboxes by Daytona. Models by OpenRouter.
		</p>
	);
}
