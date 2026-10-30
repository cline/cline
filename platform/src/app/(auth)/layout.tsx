import Link from "next/link";
import { Attribution, BrandLink } from "@/components/brand";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
	return (
		<div className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
			<div className="relative hidden overflow-hidden border-r border-white/[0.07] lg:flex lg:flex-col lg:justify-between">
				<div className="pointer-events-none absolute inset-0 grid-noise" />
				<div className="pointer-events-none absolute -left-32 top-1/3 size-[28rem] rounded-full bg-signal-500/[0.07] blur-3xl" />
				<header className="relative z-10 p-10">
					<BrandLink />
				</header>
				<div className="relative z-10 max-w-lg px-10 pb-10">
					<p className="eyebrow">Cloud AI coding</p>
					<p className="display mt-5 text-[2.6rem] font-semibold leading-[1.02]">
						Real agents.
						<br />
						Real sandboxes.
						<br />
						<span className="text-signal-300">Real diffs.</span>
					</p>
					<p className="mt-5 max-w-sm text-sm leading-relaxed text-mist-500">
						21 Agent plans, edits and tests inside an isolated cloud workspace — then shows you the
						terminal output and file changes so you can verify the work.
					</p>
					<div className="mt-8 flex flex-wrap gap-2">
						<span className="chip">Cline runtime</span>
						<span className="chip">Daytona sandboxes</span>
						<span className="chip">OpenRouter models</span>
						<span className="chip">Supabase auth</span>
					</div>
				</div>
				<footer className="relative z-10 px-10 pb-8">
					<Attribution />
				</footer>
			</div>

			<div className="relative flex min-h-dvh flex-col">
				<header className="flex items-center justify-between p-6 lg:hidden">
					<BrandLink />
					<Link href="/" className="text-xs text-mist-500 hover:text-mist-200">
						Home
					</Link>
				</header>
				<div className="flex flex-1 items-center justify-center px-6 py-10">{children}</div>
				<footer className="px-6 py-6 text-center lg:hidden">
					<Attribution />
				</footer>
			</div>
		</div>
	);
}
