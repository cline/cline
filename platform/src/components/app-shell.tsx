"use client";

import {
	Boxes,
	ChevronDown,
	Cpu,
	Gauge,
	LayoutDashboard,
	LogOut,
	Menu,
	Plus,
	Settings,
	TerminalSquare,
	X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { LogoMark } from "@/components/brand";
import { humanizeStatus, initials } from "@/lib/utils";

export type ShellUser = {
	email: string;
	name: string | null;
	plan: "free" | "pro";
	avatarUrl: string | null;
};

const nav = [
	{ href: "/app", label: "Overview", icon: LayoutDashboard, exact: true },
	{ href: "/app/projects", label: "Projects", icon: Boxes },
	{ href: "/app/tasks", label: "Tasks", icon: TerminalSquare },
	{ href: "/app/models", label: "Models", icon: Cpu },
	{ href: "/app/usage", label: "Usage", icon: Gauge },
	{ href: "/app/settings", label: "Settings", icon: Settings },
];

function isActive(pathname: string, href: string, exact?: boolean) {
	if (exact) return pathname === href;
	return pathname === href || pathname.startsWith(`${href}/`);
}

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
	const pathname = usePathname();
	return (
		<nav className="space-y-0.5">
			{nav.map((item) => (
				<Link
					key={item.href}
					href={item.href}
					onClick={onNavigate}
					className="nav-item"
					data-active={isActive(pathname, item.href, item.exact)}
				>
					<item.icon className="size-4" strokeWidth={1.7} />
					{item.label}
				</Link>
			))}
		</nav>
	);
}

function UserCard({ user }: { user: ShellUser }) {
	const [open, setOpen] = useState(false);
	return (
		<div className="relative">
			<button
				type="button"
				onClick={() => setOpen((value) => !value)}
				className="flex w-full items-center gap-2.5 rounded-xl border border-white/[0.07] bg-white/[0.025] p-2 text-left transition hover:border-white/[0.12] hover:bg-white/[0.04]"
			>
				<span className="grid size-8 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-signal-400 to-mint-400 text-[0.7rem] font-bold text-ink-950">
					{initials(user.name, user.email)}
				</span>
				<span className="min-w-0 flex-1">
					<span className="block truncate text-xs font-medium text-mist-100">
						{user.name || user.email.split("@")[0]}
					</span>
					<span className="block truncate text-[0.65rem] text-mist-600">{user.email}</span>
				</span>
				<ChevronDown className="size-3.5 shrink-0 text-mist-600" />
			</button>
			{open ? (
				<div className="absolute bottom-full left-0 mb-2 w-full overflow-hidden rounded-xl border border-white/10 bg-ink-850 p-1 shadow-lift">
					<div className="px-2.5 py-2">
						<span className="chip border-signal-500/20 capitalize text-signal-300">
							{user.plan} plan
						</span>
					</div>
					<Link href="/app/settings" onClick={() => setOpen(false)} className="nav-item">
						<Settings className="size-4" /> Account settings
					</Link>
					<form action="/auth/signout" method="post">
						<button type="submit" className="nav-item w-full text-left">
							<LogOut className="size-4" /> Sign out
						</button>
					</form>
				</div>
			) : null}
		</div>
	);
}

export function Sidebar({
	user,
	sandboxReady,
	modelReady,
}: {
	user: ShellUser;
	sandboxReady: boolean;
	modelReady: boolean;
}) {
	return (
		<aside className="hidden h-dvh w-[248px] shrink-0 flex-col border-r border-white/[0.07] bg-ink-900/60 px-4 py-5 backdrop-blur-xl lg:flex">
			<Link href="/app" className="flex items-center gap-2.5 px-1">
				<LogoMark className="size-8" />
				<span className="font-display text-[1rem] font-semibold tracking-[-0.03em]">21 Agent</span>
			</Link>

			<Link href="/app/projects?new=1" className="btn btn-primary mt-6 w-full">
				<Plus className="size-4" strokeWidth={2.2} /> New project
			</Link>

			<div className="mt-6">
				<p className="mb-2 px-2 text-[0.6rem] font-semibold uppercase tracking-[0.14em] text-mist-600">
					Workspace
				</p>
				<NavLinks />
			</div>

			<div className="mt-auto space-y-3">
				<div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
					<p className="text-[0.6rem] font-semibold uppercase tracking-[0.14em] text-mist-600">
						System status
					</p>
					<div className="mt-2 space-y-1.5 text-[0.6875rem]">
						<StatusLine
							label="Daytona sandboxes"
							ok={sandboxReady}
							okText="connected"
							badText="not configured"
						/>
						<StatusLine
							label="OpenRouter"
							ok={modelReady}
							okText="key available"
							badText="add a key"
						/>
					</div>
				</div>
				<UserCard user={user} />
			</div>
		</aside>
	);
}

function StatusLine({
	label,
	ok,
	okText,
	badText,
}: {
	label: string;
	ok: boolean;
	okText: string;
	badText: string;
}) {
	return (
		<div className="flex items-center justify-between gap-2">
			<span className="text-mist-500">{label}</span>
			<span className={ok ? "text-signal-300" : "text-amber-400"}>{ok ? okText : badText}</span>
		</div>
	);
}

export function MobileTopbar({ user }: { user: ShellUser }) {
	const [open, setOpen] = useState(false);

	useEffect(() => {
		document.body.style.overflow = open ? "hidden" : "";
		return () => {
			document.body.style.overflow = "";
		};
	}, [open]);

	return (
		<>
			<header className="sticky top-0 z-30 flex items-center justify-between border-b border-white/[0.07] bg-ink-950/85 px-4 py-3 backdrop-blur-xl lg:hidden">
				<Link href="/app" className="flex items-center gap-2">
					<LogoMark className="size-7" />
					<span className="font-display text-sm font-semibold">21 Agent</span>
				</Link>
				<div className="flex items-center gap-1.5">
					<Link
						href="/app/projects?new=1"
						className="btn btn-primary size-9 px-0"
						aria-label="New project"
					>
						<Plus className="size-4" />
					</Link>
					<button
						type="button"
						onClick={() => setOpen(true)}
						className="btn btn-secondary size-9 px-0"
						aria-label="Open navigation"
					>
						<Menu className="size-4" />
					</button>
				</div>
			</header>

			{open ? (
				<div className="fixed inset-0 z-50 lg:hidden">
					<button
						type="button"
						aria-label="Close navigation"
						onClick={() => setOpen(false)}
						className="absolute inset-0 bg-black/70 backdrop-blur-sm"
					/>
					<div className="absolute inset-y-0 right-0 w-[300px] border-l border-white/10 bg-ink-900 p-4 shadow-lift">
						<div className="flex items-center justify-between">
							<span className="font-display text-sm font-semibold">Navigation</span>
							<button
								type="button"
								onClick={() => setOpen(false)}
								className="btn btn-ghost size-8 px-0"
								aria-label="Close"
							>
								<X className="size-4" />
							</button>
						</div>
						<div className="mt-5">
							<NavLinks onNavigate={() => setOpen(false)} />
						</div>
						<div className="absolute inset-x-4 bottom-4">
							<UserCard user={user} />
						</div>
					</div>
				</div>
			) : null}
		</>
	);
}

export function WorkspaceStatusChip({ state }: { state: string | null }) {
	if (!state) {
		return <span className="chip text-mist-500">sandbox not provisioned</span>;
	}
	return (
		<span className="chip">
			<span
				className={
					state === "ready"
						? "size-1.5 rounded-full bg-signal-400"
						: "size-1.5 rounded-full bg-amber-400"
				}
			/>
			sandbox {humanizeStatus(state)}
		</span>
	);
}
