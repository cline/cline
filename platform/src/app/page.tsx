import {
	ArrowRight,
	Boxes,
	CheckCircle2,
	GitBranch,
	Globe2,
	ShieldCheck,
	Sparkles,
	Terminal,
	Workflow,
} from "lucide-react";
import Link from "next/link";
import { Attribution, BrandLink } from "@/components/brand";
import { getCurrentUser } from "@/lib/auth";

const capabilities = [
	{
		icon: Terminal,
		title: "A real terminal",
		body: "Shell commands run in a persistent Daytona sandbox, with exit codes, stdout and stderr streamed back to the task log.",
	},
	{
		icon: Boxes,
		title: "Multi-language by default",
		body: "Python, TypeScript, Java, C/C++, Go, Rust, PHP and Ruby workspaces with dependency installation and test runs.",
	},
	{
		icon: GitBranch,
		title: "Diffs you can inspect",
		body: "Every write is captured before and after. Review proposed changes, file by file, before you trust the summary.",
	},
	{
		icon: ShieldCheck,
		title: "Isolated by construction",
		body: "Untrusted code never touches the app server. Per-user sandboxes, ownership checks on every request, server-only secrets.",
	},
	{
		icon: Workflow,
		title: "Durable orchestration",
		body: "Tasks are queued in Postgres and leased to a long-lived worker with heartbeats, retries and cancellation.",
	},
	{
		icon: Globe2,
		title: "Preview what you built",
		body: "Start a dev server inside the sandbox and open its preview URL without leaving the workspace.",
	},
];

const steps = [
	{
		number: "01",
		title: "Describe the outcome",
		body: "Pick a model, choose a language template, and write the task the way you would brief an engineer.",
	},
	{
		number: "02",
		title: "Watch the agent work",
		body: "It plans, lists files, reads code, edits, runs commands and tests — each step visible in the live activity feed.",
	},
	{
		number: "03",
		title: "Review the evidence",
		body: "Inspect diffs, terminal output and test results. The summary only claims what actually happened.",
	},
];

export default async function LandingPage() {
	const user = await getCurrentUser();

	return (
		<div className="relative overflow-hidden">
			<div className="pointer-events-none absolute inset-x-0 top-0 h-[42rem] grid-noise" />

			<header className="relative z-10 mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-6">
				<BrandLink />
				<nav className="hidden items-center gap-7 text-[0.8125rem] text-mist-400 md:flex">
					<a href="#capabilities" className="transition hover:text-mist-50">
						Capabilities
					</a>
					<a href="#how" className="transition hover:text-mist-50">
						How it works
					</a>
					<a href="#trust" className="transition hover:text-mist-50">
						Architecture
					</a>
				</nav>
				<div className="flex items-center gap-2">
					{user ? (
						<Link href="/app" className="btn btn-primary">
							Open workspace <ArrowRight className="size-3.5" />
						</Link>
					) : (
						<>
							<Link href="/sign-in" className="btn btn-ghost hidden sm:inline-flex">
								Sign in
							</Link>
							<Link href="/sign-up" className="btn btn-primary">
								Start building <ArrowRight className="size-3.5" />
							</Link>
						</>
					)}
				</div>
			</header>

			<main className="relative z-10">
				<section className="mx-auto w-full max-w-6xl px-6 pb-16 pt-16 sm:pt-24">
					<div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-[0.6875rem] text-mist-400">
						<span className="size-1.5 rounded-full bg-signal-400" />
						Cline agent runtime · Daytona sandboxes · OpenRouter models
					</div>

					<h1 className="display mt-7 max-w-4xl text-[clamp(2.8rem,7vw,5.2rem)] font-semibold text-mist-50">
						An agent that
						<span className="text-signal-300"> actually ships.</span>
					</h1>
					<p className="mt-6 max-w-2xl text-[0.95rem] leading-relaxed text-mist-400 sm:text-base">
						21 Agent is a cloud AI coding workspace. Describe a task and a real agent plans, edits
						files, installs dependencies, runs tests and shows its terminal output — inside an
						isolated sandbox, never on our servers.
					</p>

					<div className="mt-8 flex flex-wrap items-center gap-3">
						<Link href={user ? "/app/projects" : "/sign-up"} className="btn btn-primary h-11 px-5">
							{user ? "Create a project" : "Create your first project"}{" "}
							<ArrowRight className="size-4" />
						</Link>
						<Link href="#how" className="btn btn-secondary h-11 px-5">
							See how it works
						</Link>
					</div>

					<div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-[0.6875rem] text-mist-600">
						<span className="inline-flex items-center gap-1.5">
							<CheckCircle2 className="size-3.5 text-signal-500" /> Real sandbox execution
						</span>
						<span className="inline-flex items-center gap-1.5">
							<CheckCircle2 className="size-3.5 text-signal-500" /> Your own OpenRouter key
						</span>
						<span className="inline-flex items-center gap-1.5">
							<CheckCircle2 className="size-3.5 text-signal-500" /> No code leaves its sandbox
						</span>
					</div>

					<div className="relative mt-14 overflow-hidden rounded-2xl border border-white/10 bg-ink-900/80 shadow-lift">
						<div className="flex items-center justify-between border-b border-white/[0.07] px-4 py-2.5">
							<div className="flex items-center gap-1.5">
								<span className="size-2.5 rounded-full bg-rose-400/60" />
								<span className="size-2.5 rounded-full bg-amber-400/60" />
								<span className="size-2.5 rounded-full bg-signal-500/60" />
							</div>
							<p className="font-mono text-[0.625rem] text-mist-600">
								task / fix-flaky-checkout-test
							</p>
							<span className="chip border-signal-500/20 text-signal-300">
								<span className="size-1.5 animate-pulse-soft rounded-full bg-signal-400" />
								running
							</span>
						</div>
						<div className="grid gap-0 lg:grid-cols-[1.2fr_1fr]">
							<div className="border-b border-white/[0.07] p-5 lg:border-b-0 lg:border-r">
								<div className="space-y-3.5 font-mono text-[0.72rem] leading-relaxed">
									<p className="text-mist-500">
										<span className="text-signal-400">›</span> Analyze the failing test and fix the
										root cause
									</p>
									<div className="rounded-lg border border-white/[0.06] bg-black/30 px-3 py-2.5 text-mist-400">
										<p>
											<span className="text-iris-400">tool</span> read_file{" "}
											<span className="text-mist-600">src/checkout/cart.test.ts</span>
										</p>
										<p>
											<span className="text-iris-400">tool</span> run_command{" "}
											<span className="text-mist-600">npm test -- cart</span>
										</p>
										<p className="text-rose-400/80">exit 1 · expected 2 items, received 1</p>
										<p>
											<span className="text-iris-400">tool</span> edit_file{" "}
											<span className="text-mist-600">src/checkout/cart.ts</span>
										</p>
										<p className="text-signal-300">patch applied · 4 insertions, 2 deletions</p>
									</div>
									<p className="text-mist-400">
										The cart merged duplicate lines before applying quantity. Fixed the reducer and
										added a regression assertion.
									</p>
								</div>
							</div>
							<div className="bg-black/20 p-5">
								<p className="font-mono text-[0.625rem] uppercase tracking-[0.16em] text-mist-600">
									live output
								</p>
								<pre className="mt-3 overflow-x-auto font-mono text-[0.7rem] leading-relaxed text-mint-400/90">
									{`$ npm test -- cart\n\nPASS src/checkout/cart.test.ts\n  ✓ adds a single line item\n  ✓ merges quantities\n  ✓ keeps totals correct\n\nTests: 3 passed, 3 total\nTime:  1.276 s`}
								</pre>
								<div className="mt-4 flex items-center gap-2">
									<span className="chip border-mint-400/20 text-mint-400">3 files changed</span>
									<span className="chip">tests passing</span>
								</div>
							</div>
						</div>
					</div>
				</section>

				<section id="capabilities" className="mx-auto w-full max-w-6xl px-6 py-20">
					<p className="eyebrow">Capabilities</p>
					<h2 className="display mt-3 max-w-2xl text-3xl font-semibold sm:text-4xl">
						Built for work that has to be verifiable.
					</h2>
					<div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
						{capabilities.map((item) => (
							<div key={item.title} className="surface group p-5 transition hover:border-white/15">
								<span className="grid size-9 place-items-center rounded-lg border border-white/10 bg-white/[0.04] text-signal-300">
									<item.icon className="size-4" strokeWidth={1.7} />
								</span>
								<h3 className="mt-4 font-display text-[0.95rem] font-semibold">{item.title}</h3>
								<p className="mt-1.5 text-xs leading-relaxed text-mist-500">{item.body}</p>
							</div>
						))}
					</div>
				</section>

				<section id="how" className="border-y border-white/[0.06] bg-white/[0.012]">
					<div className="mx-auto w-full max-w-6xl px-6 py-20">
						<p className="eyebrow">Workflow</p>
						<h2 className="display mt-3 text-3xl font-semibold sm:text-4xl">
							Brief. Watch. Verify.
						</h2>
						<div className="mt-10 grid gap-8 md:grid-cols-3">
							{steps.map((step) => (
								<div key={step.number}>
									<p className="font-mono text-xs text-signal-400">{step.number}</p>
									<h3 className="mt-3 font-display text-lg font-semibold">{step.title}</h3>
									<p className="mt-2 text-sm leading-relaxed text-mist-500">{step.body}</p>
								</div>
							))}
						</div>
					</div>
				</section>

				<section
					id="trust"
					className="mx-auto grid w-full max-w-6xl gap-10 px-6 py-20 lg:grid-cols-[1fr_1.1fr]"
				>
					<div>
						<p className="eyebrow">Architecture</p>
						<h2 className="display mt-3 text-3xl font-semibold sm:text-4xl">
							Premium surface.
							<span className="text-mist-500"> Serious substrate.</span>
						</h2>
						<p className="mt-4 max-w-md text-sm leading-relaxed text-mist-500">
							The web app only orchestrates. Model keys stay server-side, the agent runs in a
							worker, and every command executes inside a Daytona sandbox scoped to one owner.
						</p>
					</div>
					<div className="surface divide-y divide-white/[0.06] overflow-hidden">
						{[
							["Web & API", "Next.js on Vercel · Supabase Auth sessions · RLS"],
							["Agent", "Cline runtime loop · OpenRouter tool-calling models"],
							["Queue", "Postgres jobs · leases, heartbeats, retries"],
							["Execution", "Daytona sandbox per project · streaming logs · preview URLs"],
						].map(([label, detail]) => (
							<div key={label} className="flex items-start gap-4 px-5 py-4">
								<span className="mt-1 size-1.5 shrink-0 rounded-full bg-signal-400" />
								<div>
									<p className="text-[0.8125rem] font-medium text-mist-100">{label}</p>
									<p className="mt-0.5 font-mono text-[0.7rem] leading-relaxed text-mist-600">
										{detail}
									</p>
								</div>
							</div>
						))}
					</div>
				</section>

				<section className="mx-auto w-full max-w-6xl px-6 pb-24">
					<div className="surface relative overflow-hidden px-8 py-12 sm:px-12">
						<div className="pointer-events-none absolute -right-24 -top-24 size-72 rounded-full bg-signal-500/10 blur-3xl" />
						<Sparkles className="size-5 text-signal-300" />
						<h2 className="display mt-4 max-w-xl text-3xl font-semibold sm:text-4xl">
							Your next commit starts with a sentence.
						</h2>
						<p className="mt-3 max-w-xl text-sm text-mist-400">
							Create a project, choose a model, and hand the agent something real.
						</p>
						<div className="mt-7 flex flex-wrap gap-3">
							<Link
								href={user ? "/app/projects" : "/sign-up"}
								className="btn btn-primary h-11 px-5"
							>
								{user ? "Open projects" : "Create an account"} <ArrowRight className="size-4" />
							</Link>
							<Link href="/sign-in" className="btn btn-secondary h-11 px-5">
								Sign in
							</Link>
						</div>
					</div>
				</section>
			</main>

			<footer className="relative z-10 border-t border-white/[0.06]">
				<div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-6 py-8 sm:flex-row sm:items-center sm:justify-between">
					<div className="space-y-2">
						<BrandLink />
						<Attribution />
					</div>
					<div className="flex gap-5 text-xs text-mist-500">
						<Link href="/sign-in" className="hover:text-mist-200">
							Sign in
						</Link>
						<Link href="/sign-up" className="hover:text-mist-200">
							Get started
						</Link>
						<a
							href="https://github.com/cline/cline"
							target="_blank"
							rel="noreferrer"
							className="hover:text-mist-200"
						>
							Cline source
						</a>
					</div>
				</div>
			</footer>
		</div>
	);
}
