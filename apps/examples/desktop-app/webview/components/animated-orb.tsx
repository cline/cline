"use client";

import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";

export function AnimatedOrb({
	className,
	intensity = 0,
}: {
	className?: string;
	intensity?: number;
}) {
	const normalizedIntensity = Math.min(1, Math.max(0, intensity));
	const animationStyle = {
		"--orb-fast-duration": `${Math.max(1.8, 6 - normalizedIntensity * 4.2)}s`,
		"--orb-slow-duration": `${Math.max(1.2, 3.5 - normalizedIntensity * 2.3)}s`,
	} as CSSProperties;

	return (
		<span
			aria-hidden="true"
			className={cn(
				"relative block size-5 shrink-0 overflow-hidden rounded-full bg-[#ebf4ff]",
				className,
			)}
			style={{
				...animationStyle,
				filter: `saturate(${1 + normalizedIntensity * 0.5}) drop-shadow(0 0 ${normalizedIntensity * 8}px rgba(118, 11, 226, 0.55))`,
				transform: `scale(${1 + normalizedIntensity * 0.22})`,
				transition: "transform 75ms ease-out, filter 100ms ease-out",
			}}
		>
			<span className="absolute inset-0 animate-[spin_var(--orb-fast-duration)_linear_infinite] blur-[2.5px]">
				<span className="absolute left-[8%] top-[12%] size-[55%] rounded-full bg-[#760be2]" />
				<span className="absolute right-[3%] top-[18%] size-[45%] rounded-full bg-[#f5adff]" />
				<span className="absolute bottom-[2%] left-[18%] size-[58%] rounded-full bg-[#ebf4ff]" />
				<span className="absolute bottom-[18%] right-[4%] size-[38%] rounded-full bg-[#760be2]" />
			</span>
			<span className="absolute inset-[12%] animate-[spin_var(--orb-slow-duration)_linear_infinite_reverse] rounded-full bg-[linear-gradient(176deg,#f5adff_0%,#ebf4ff_35%,#760be2_100%)] blur-[2px]" />
			<span className="pointer-events-none absolute inset-0 rounded-full bg-linear-to-b from-white/55 via-transparent to-[#760be2]/15" />
		</span>
	);
}
