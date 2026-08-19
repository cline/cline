import type { Meta } from "@storybook/react-vite";

const steps = Array.from({ length: 12 }, (_, index) => index + 1);

const palettes = [
	["Neutral · Slate", "neutral"],
	["Accent · Violet", "accent"],
	["Error · Ruby", "error"],
	["Success · Green", "success"],
	["Warning · Amber", "warning"],
	["Info · Sky", "info"],
] as const;

const visualRoles = [
	["Surface 1", "--surface-1"],
	["Surface 2", "--surface-2"],
	["Surface 3", "--surface-3"],
	["Surface hover lighter", "--surface-hover-lighter"],
	["Surface hover", "--surface-hover"],
	["Surface hover darker", "--surface-hover-darker"],
	["Text 1", "--text-1"],
	["Text 2", "--text-2"],
	["Text disabled", "--text-disabled"],
	["Border 1", "--border-1"],
	["Border 2", "--border-2"],
	["Focus ring", "--focus-ring"],
] as const;

const semanticColors = [
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

const sidebarColors = [
	["Sidebar", "--sidebar"],
	["Sidebar foreground", "--sidebar-foreground"],
	["Sidebar primary", "--sidebar-primary"],
	["Sidebar primary foreground", "--sidebar-primary-foreground"],
	["Sidebar accent", "--sidebar-accent"],
	["Sidebar accent foreground", "--sidebar-accent-foreground"],
	["Sidebar border", "--sidebar-border"],
	["Sidebar ring", "--sidebar-ring"],
] as const;

const statuses = [
	["Success", "success"],
	["Warning", "warning"],
	["Error", "error"],
	["Info", "info"],
] as const;

const meta: Meta = {
	title: "Foundations/Theme",
	tags: ["autodocs"],
	parameters: {
		docs: {
			description: {
				component:
					"Cline-owned color palettes feed readable visual roles and the shadcn semantic compatibility contract. Use the toolbar to compare light and dark modes.",
			},
		},
	},
};

export default meta;

const TokenCard = ({ label, token }: { label: string; token: string }) => (
	<div className="overflow-hidden rounded-lg border bg-card">
		<div className="h-16 border-b" style={{ background: `var(${token})` }} />
		<div className="p-3">
			<div className="text-sm font-medium">{label}</div>
			<code className="text-xs text-muted-foreground">{token}</code>
		</div>
	</div>
);

export const Overview = () => (
	<main className="mx-auto grid max-w-6xl gap-10 p-8">
		<header className="space-y-3">
			<p className="text-sm font-medium text-primary">@cline/ui</p>
			<h1 className="text-4xl font-semibold tracking-tight">
				Cline visual foundations
			</h1>
			<p className="max-w-3xl text-base text-muted-foreground">
				Adjust Cline-owned palettes and visual roles; shadcn semantic tokens
				remain the stable component compatibility layer.
			</p>
		</header>

		<section className="space-y-4">
			<div>
				<h2 className="text-xl font-semibold">Cline-owned palettes</h2>
				<p className="text-sm text-muted-foreground">
					Solid and alpha values copied from Radix Colors 3.0.0.
				</p>
			</div>
			<div className="grid gap-5">
				{palettes.map(([label, prefix]) => (
					<div className="space-y-2 rounded-xl border bg-card p-4" key={prefix}>
						<div className="flex items-baseline justify-between gap-4">
							<h3 className="text-sm font-semibold">{label}</h3>
							<code className="text-xs text-muted-foreground">
								--{prefix}-*
							</code>
						</div>
						<div className="grid grid-cols-12 overflow-hidden rounded-md border">
							{steps.map((step) => (
								<div
									className="aspect-square"
									key={step}
									style={{ background: `var(--${prefix}-${step})` }}
									title={`--${prefix}-${step}`}
								/>
							))}
						</div>
						<div className="grid grid-cols-12 overflow-hidden rounded-md border bg-background">
							{steps.map((step) => (
								<div
									className="aspect-square"
									key={step}
									style={{ background: `var(--${prefix}-a${step})` }}
									title={`--${prefix}-a${step}`}
								/>
							))}
						</div>
					</div>
				))}
			</div>
		</section>

		<section className="space-y-4">
			<div>
				<h2 className="text-xl font-semibold">Visual roles</h2>
				<p className="text-sm text-muted-foreground">
					These are the preferred tokens for designing and tuning surfaces.
				</p>
			</div>
			<div className="grid grid-cols-2 gap-3 md:grid-cols-5">
				{visualRoles.map(([label, token]) => (
					<TokenCard key={token} label={label} token={token} />
				))}
			</div>
		</section>

		<section className="space-y-4">
			<h2 className="text-xl font-semibold">Status roles</h2>
			<div className="grid gap-3 md:grid-cols-2">
				{statuses.map(([label, prefix]) => (
					<div
						className="rounded-xl border p-4"
						key={prefix}
						style={{
							background: `var(--${prefix}-surface)`,
							borderColor: `var(--${prefix}-border)`,
							color: `var(--${prefix}-text)`,
						}}
					>
						<div className="flex items-center justify-between gap-4">
							<div>
								<div className="font-semibold">{label}</div>
								<code className="text-xs">--{prefix}-surface</code>
							</div>
							<span
								className="rounded-md px-3 py-1 text-xs font-semibold"
								style={{
									background: `var(--${prefix}-solid)`,
									color: `var(--${prefix}-contrast)`,
								}}
							>
								Solid
							</span>
						</div>
					</div>
				))}
			</div>
		</section>

		<section className="space-y-4">
			<div>
				<h2 className="text-xl font-semibold">shadcn compatibility</h2>
				<p className="text-sm text-muted-foreground">
					Components continue to consume these stable semantic names.
				</p>
			</div>
			<div className="grid grid-cols-2 gap-3 md:grid-cols-3">
				{semanticColors.map(([label, token]) => (
					<TokenCard key={token} label={label} token={token} />
				))}
			</div>
		</section>

		<section className="space-y-4">
			<div>
				<h2 className="text-xl font-semibold">Sidebar surfaces</h2>
				<p className="text-sm text-muted-foreground">
					Semantic tokens consumed by host sidebars, such as the desktop app.
				</p>
			</div>
			<div className="grid grid-cols-2 gap-3 md:grid-cols-4">
				{sidebarColors.map(([label, token]) => (
					<TokenCard key={token} label={label} token={token} />
				))}
			</div>
		</section>

		<section className="grid gap-6 md:grid-cols-2">
			<div className="space-y-4 rounded-xl border bg-card p-6">
				<h2 className="text-xl font-semibold">Typography</h2>
				<div className="space-y-3">
					<p className="text-3xl font-semibold">Inter</p>
					<p className="text-base text-muted-foreground">
						Readable product copy with a warm, technical character.
					</p>
					<code className="block rounded-md bg-muted p-3 font-mono text-sm">
						Geist Mono · bun run build
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
						Accent
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
