import type { Meta } from "@storybook/react-vite";

const colors = [
	["Background", "--background"],
	["Foreground", "--foreground"],
	["Card", "--card"],
	["Primary", "--primary"],
	["Secondary", "--secondary"],
	["Muted", "--muted"],
	["Accent", "--accent"],
	["Destructive", "--destructive"],
	["Border", "--border"],
] as const;

const meta: Meta = {
	title: "Foundations/Theme",
	tags: ["autodocs"],
	parameters: {
		docs: {
			description: {
				component:
					"The shared Cline semantic color, typography, radius, and interaction contract. Use the toolbar to compare light and dark modes.",
			},
		},
	},
};

export default meta;

export const Overview = () => (
	<main className="mx-auto grid max-w-5xl gap-10 p-8">
		<header className="space-y-3">
			<p className="text-sm font-medium text-primary">@cline/ui</p>
			<h1 className="text-4xl font-semibold tracking-tight">
				Cline visual foundations
			</h1>
			<p className="max-w-2xl text-base text-muted-foreground">
				Semantic values let products share a recognizable visual language while
				retaining their own layouts and workflows.
			</p>
		</header>

		<section className="space-y-4">
			<h2 className="text-xl font-semibold">Semantic colors</h2>
			<div className="grid grid-cols-2 gap-3 md:grid-cols-3">
				{colors.map(([label, token]) => (
					<div
						className="overflow-hidden rounded-lg border bg-card"
						key={token}
					>
						<div
							className="h-20 border-b"
							style={{ background: `var(${token})` }}
						/>
						<div className="p-3">
							<div className="text-sm font-medium">{label}</div>
							<code className="text-xs text-muted-foreground">{token}</code>
						</div>
					</div>
				))}
			</div>
		</section>

		<section className="grid gap-6 md:grid-cols-2">
			<div className="space-y-4 rounded-xl border bg-card p-6">
				<h2 className="text-xl font-semibold">Typography</h2>
				<div className="space-y-3">
					<p className="text-3xl font-semibold">Schibsted Grotesk</p>
					<p className="text-base text-muted-foreground">
						Readable product copy with a warm, technical character.
					</p>
					<code className="block rounded-md bg-muted p-3 font-mono text-sm">
						Azeret Mono · npm run build
					</code>
				</div>
			</div>

			<div className="space-y-4 rounded-xl border bg-card p-6">
				<h2 className="text-xl font-semibold">Controls</h2>
				<div className="flex flex-wrap gap-3">
					<button
						className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
						type="button"
					>
						Primary
					</button>
					<button
						className="rounded-md border bg-background px-4 py-2 text-sm font-medium"
						type="button"
					>
						Secondary
					</button>
					<button
						className="rounded-md px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground"
						type="button"
					>
						Ghost
					</button>
				</div>
				<input
					aria-label="Example input"
					className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
					placeholder="Ask Cline something..."
				/>
			</div>
		</section>
	</main>
);
