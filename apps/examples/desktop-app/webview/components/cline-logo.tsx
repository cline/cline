import { cn } from "@/lib/utils";

export function ClineLogo({ className }: { className?: string }) {
	return (
		<span
			aria-hidden="true"
			className={cn("inline-block shrink-0 bg-current", className)}
			style={{
				maskImage: "url('/cline-logo-filled.svg')",
				maskPosition: "center",
				maskRepeat: "no-repeat",
				maskSize: "contain",
				WebkitMaskImage: "url('/cline-logo-filled.svg')",
				WebkitMaskPosition: "center",
				WebkitMaskRepeat: "no-repeat",
				WebkitMaskSize: "contain",
			}}
		/>
	);
}
