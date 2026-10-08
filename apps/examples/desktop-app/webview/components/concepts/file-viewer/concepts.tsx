"use client";

import {
	AppWindow,
	ArrowUpRight,
	AtSign,
	BookOpen,
	Check,
	ChevronDown,
	ChevronRight,
	ChevronsDownUp,
	Columns3,
	Copy,
	CornerDownLeft,
	Eye,
	FileDiff as FileDiffIcon,
	FilePlus2,
	Folder,
	FolderOpen,
	FolderTree,
	GitBranch,
	History,
	List,
	ListTree,
	MessageSquarePlus,
	PanelLeft,
	PanelRight,
	Pencil,
	Search,
	Sparkles,
	X,
} from "lucide-react";
import type { ReactNode } from "react";
import { EditorIcon } from "@/components/views/chat/editor-icons";
import { cn } from "@/lib/utils";
import {
	CONTENTS,
	FILES,
	fileByPath,
	INVOICE_TABLE_CHANGED,
	PROJECT,
	README,
	SESSION_TITLE,
} from "./mock-data";
import {
	AgentMark,
	Breadcrumb,
	ChangesView,
	CodeView,
	DiffCount,
	FileIcon,
	FileTree,
	GitBadge,
	Kbd,
	Pill,
} from "./parts";
import {
	AppFrame,
	ChatConversation,
	ClineMark,
	Composer,
	ContextChip,
	HeaderIconButton,
	SessionHeader,
	SidebarFooter,
	SidebarNavHeader,
} from "./shell";

const INVOICE = "src/components/invoice-table.tsx";

const INVOICE_OLD = (CONTENTS[INVOICE] ?? "")
	.replace('import { ExportButton } from "./export-button";\n', "")
	.replace('import { toCsv } from "../lib/csv";\n', "")
	.replace(/\tconst handleExport = [\s\S]*?\n\t};\n\n/, "")
	.replace(
		/\t\t\t<header[\s\S]*?<\/header>\n/,
		'\t\t\t<h2 className="text-lg font-semibold">Invoices</h2>\n',
	);

function PanelTabs({
	tabs,
	active,
}: {
	tabs: { label: string; count?: number; icon?: ReactNode }[];
	active: string;
}) {
	return (
		<div className="flex items-center gap-0.5 rounded-lg bg-muted p-0.5">
			{tabs.map((tab) => (
				<span
					className={cn(
						"inline-flex h-6 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-muted-foreground",
						tab.label === active && "bg-background text-foreground shadow-xs",
					)}
					key={tab.label}
				>
					{tab.icon}
					{tab.label}
					{tab.count ? (
						<span className="rounded bg-foreground/8 px-1 font-mono text-[10px]">
							{tab.count}
						</span>
					) : null}
				</span>
			))}
		</div>
	);
}

function SearchField({
	placeholder,
	value,
	className,
	kbd,
}: {
	placeholder: string;
	value?: string;
	className?: string;
	kbd?: string;
}) {
	return (
		<div
			className={cn(
				"flex h-8 items-center gap-2 rounded-md border border-border bg-background px-2.5 text-xs",
				className,
			)}
		>
			<Search className="size-3.5 shrink-0 text-muted-foreground" />
			<span
				className={cn(
					"min-w-0 flex-1 truncate",
					value ? "text-foreground" : "text-muted-foreground",
				)}
			>
				{value ?? placeholder}
			</span>
			{kbd ? <Kbd>{kbd}</Kbd> : null}
		</div>
	);
}

function IconBtn({
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
}) {
	return (
		<span
			className={cn(
				"inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground",
				className,
			)}
		>
			{children}
		</span>
	);
}

function FileActions({ compact }: { compact?: boolean }) {
	return (
		<div className="flex shrink-0 items-center gap-1">
			<span className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-background px-2 text-xs font-medium">
				<AtSign className="size-3.5" />
				{compact ? null : "Add to chat"}
			</span>
			<span className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-background px-2 text-xs font-medium">
				<EditorIcon className="size-3.5" editorId="vscode" />
				{compact ? null : "Open in VS Code"}
				<ChevronDown className="size-3 text-muted-foreground" />
			</span>
		</div>
	);
}

/* 1. Inspector panel: Files and Changes share one right-hand panel. */
export function ConceptInspector() {
	return (
		<AppFrame>
			<SessionHeader
				actions={
					<HeaderIconButton active>
						<PanelRight className="size-4" />
					</HeaderIconButton>
				}
			/>
			<div className="flex min-h-0 flex-1">
				<div className="flex min-w-0 flex-1 flex-col">
					<ChatConversation />
					<Composer />
				</div>
				<aside className="flex w-[340px] shrink-0 flex-col border-l border-border/70 bg-sidebar/60">
					<div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-border/70 px-3">
						<PanelTabs
							active="Files"
							tabs={[{ label: "Files" }, { label: "Changes", count: 4 }]}
						/>
						<div className="flex items-center">
							<IconBtn>
								<ChevronsDownUp className="size-3.5" />
							</IconBtn>
							<IconBtn>
								<X className="size-3.5" />
							</IconBtn>
						</div>
					</div>
					<div className="px-3 pt-3 pb-1">
						<SearchField kbd="⌘P" placeholder="Filter files" />
					</div>
					<div className="flex items-center justify-between px-4 pt-2 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
						<span>{PROJECT.name}</span>
						<span className="flex items-center gap-1 normal-case tracking-normal">
							<ClineMark className="size-2.5 text-primary" />
							touched by Cline
						</span>
					</div>
					<div className="min-h-0 flex-1 overflow-hidden">
						<FileTree selected={INVOICE} />
					</div>
					<div className="flex shrink-0 items-center gap-1.5 border-t border-border/70 px-4 py-2.5 text-[11px] text-muted-foreground">
						<GitBranch className="size-3" />
						{PROJECT.branch}
						<span className="ml-auto">4 changed · 23 files</span>
					</div>
				</aside>
			</div>
		</AppFrame>
	);
}

/* 2. Workbench: chat, tree, and an open-file pane side by side. */
export function ConceptWorkbench() {
	return (
		<AppFrame sidebar={null}>
			<SessionHeader
				actions={
					<HeaderIconButton active label="Files">
						<FolderTree className="size-3.5" />
					</HeaderIconButton>
				}
				leading={
					<span className="mr-1 flex items-center gap-2 pl-16 text-muted-foreground">
						<PanelLeft className="size-4" />
					</span>
				}
			/>
			<div className="flex min-h-0 flex-1">
				<div className="flex w-[440px] shrink-0 flex-col border-r border-border/70">
					<ChatConversation compact />
					<Composer compact />
				</div>
				<div className="flex w-[248px] shrink-0 flex-col border-r border-border/70 bg-sidebar/50">
					<div className="flex h-10 items-center justify-between px-3 text-xs font-medium text-muted-foreground">
						<span className="uppercase tracking-wide">Explorer</span>
						<div className="flex">
							<IconBtn className="size-6">
								<Search className="size-3.5" />
							</IconBtn>
							<IconBtn className="size-6">
								<ChevronsDownUp className="size-3.5" />
							</IconBtn>
						</div>
					</div>
					<FileTree dense selected={INVOICE} />
				</div>
				<div className="flex min-w-0 flex-1 flex-col">
					<div className="flex h-10 shrink-0 items-end gap-0 border-b border-border/70 bg-sidebar/40 pl-1">
						{[
							{ path: INVOICE, active: true },
							{ path: "src/lib/csv.ts" },
							{ path: "src/components/export-button.tsx" },
						].map((tab) => (
							<span
								className={cn(
									"relative -mb-px flex h-9 items-center gap-1.5 border-x border-t border-transparent px-3 text-xs",
									tab.active
										? "rounded-t-md border-border/70 bg-background text-foreground"
										: "text-muted-foreground",
								)}
								key={tab.path}
							>
								<FileIcon name={tab.path} />
								{tab.path.split("/").pop()}
								<AgentMark touch={fileByPath(tab.path)?.agent} />
								{tab.active ? (
									<X className="ml-1 size-3 text-muted-foreground" />
								) : null}
							</span>
						))}
					</div>
					<div className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-border/70 px-4">
						<div className="flex min-w-0 items-center gap-2.5">
							<Breadcrumb path={INVOICE} />
							<Pill tone="primary">
								<ClineMark className="size-2.5" />
								Edited by Cline
							</Pill>
							<DiffCount additions={31} deletions={4} className="text-[11px]" />
						</div>
						<div className="flex items-center gap-2">
							<PanelTabs
								active="File"
								tabs={[{ label: "File" }, { label: "Changes" }]}
							/>
							<FileActions compact />
						</div>
					</div>
					<div className="min-h-0 flex-1 overflow-hidden pt-2">
						<CodeView path={INVOICE} selected={INVOICE_TABLE_CHANGED} />
					</div>
				</div>
			</div>
		</AppFrame>
	);
}

/* 3. Quick open: a keyboard-first palette with a live preview. */
export function ConceptQuickOpen() {
	const results = [
		{ path: INVOICE, match: [0, 7] },
		{ path: "src/app/invoices/page.tsx", match: [8, 15], dir: true },
		{ path: "src/app/api/invoices/route.ts", match: [12, 19], dir: true },
		{ path: "src/components/ui/table.tsx" },
		{ path: "src/lib/format.ts" },
	];
	return (
		<AppFrame>
			<SessionHeader />
			<div className="flex min-h-0 flex-1 flex-col">
				<ChatConversation />
				<Composer />
			</div>
			<div className="absolute inset-0 z-40 bg-black/25 backdrop-blur-[1px]" />
			<div className="absolute top-16 left-1/2 z-50 flex h-[440px] w-[880px] -translate-x-1/2 overflow-hidden rounded-xl border border-border bg-popover shadow-2xl">
				<div className="flex w-[380px] shrink-0 flex-col border-r border-border/70">
					<div className="flex h-12 items-center gap-2 border-b border-border/70 px-3.5">
						<Search className="size-4 text-muted-foreground" />
						<span className="text-sm text-foreground">
							invoice
							<span className="ml-px inline-block h-4 w-px translate-y-0.5 animate-pulse bg-foreground" />
						</span>
						<span className="ml-auto">
							<Pill>Files</Pill>
						</span>
					</div>
					<div className="min-h-0 flex-1 overflow-hidden p-1.5">
						<div className="px-2 pt-1.5 pb-1 text-[11px] font-medium text-muted-foreground">
							Matches
						</div>
						{results.map((result, index) => {
							const name = result.path.split("/").pop() ?? "";
							const dir = result.path.split("/").slice(0, -1).join("/");
							const file = fileByPath(result.path);
							return (
								<div
									className={cn(
										"flex h-11 items-center gap-2.5 rounded-md px-2",
										index === 0 &&
											"bg-primary/10 ring-1 ring-primary/20 ring-inset",
									)}
									key={result.path}
								>
									<FileIcon className="size-4" name={name} />
									<div className="flex min-w-0 flex-1 flex-col gap-0.5 leading-4">
										<span className="truncate text-[13px]">
											{result.match && !result.dir ? (
												<>
													<span className="font-semibold text-primary">
														{name.slice(0, 7)}
													</span>
													{name.slice(7)}
												</>
											) : (
												name
											)}
										</span>
										<span className="truncate text-[11px] text-muted-foreground">
											{result.dir ? (
												<>
													{dir.replace("invoices", "")}
													<span className="font-semibold text-primary">
														invoices
													</span>
												</>
											) : (
												dir
											)}
										</span>
									</div>
									<AgentMark touch={file?.agent} />
									<GitBadge status={file?.git} />
								</div>
							);
						})}
						<div className="px-2 pt-3 pb-1 text-[11px] font-medium text-muted-foreground">
							Changed in this session
						</div>
						{["src/lib/csv.ts", "src/components/export-button.tsx"].map(
							(path) => (
								<div className="flex h-8 items-center gap-2.5 px-2" key={path}>
									<FileIcon name={path} />
									<span className="truncate text-[13px]">
										{path.split("/").pop()}
									</span>
									<span className="truncate text-[11px] text-muted-foreground">
										{path.split("/").slice(0, -1).join("/")}
									</span>
									<span className="ml-auto">
										<GitBadge status="A" />
									</span>
								</div>
							),
						)}
					</div>
					<div className="flex h-9 shrink-0 items-center gap-3 border-t border-border/70 px-3 text-[11px] text-muted-foreground">
						<span className="flex items-center gap-1">
							<Kbd>↵</Kbd> Open
						</span>
						<span className="flex items-center gap-1">
							<Kbd>⌘↵</Kbd> Add to chat
						</span>
						<span className="flex items-center gap-1">
							<Kbd>⌥↵</Kbd> Editor
						</span>
					</div>
				</div>
				<div className="flex min-w-0 flex-1 flex-col bg-background">
					<div className="flex h-12 shrink-0 items-center justify-between border-b border-border/70 px-4">
						<Breadcrumb path={INVOICE} />
						<DiffCount additions={31} deletions={4} className="text-[11px]" />
					</div>
					<div className="min-h-0 flex-1 overflow-hidden pt-2">
						<CodeView path={INVOICE} selected={INVOICE_TABLE_CHANGED} />
					</div>
				</div>
			</div>
		</AppFrame>
	);
}

/* 4. Composer-anchored browser for picking files to reference. */
export function ConceptComposerPicker() {
	const col = (
		items: {
			name: string;
			dir?: boolean;
			checked?: boolean;
			active?: boolean;
		}[],
		className?: string,
	) => (
		<div
			className={cn("flex w-[188px] shrink-0 flex-col gap-px p-1.5", className)}
		>
			{items.map((item) => {
				const file = FILES.find((f) => f.path.endsWith(`/${item.name}`));
				return (
					<div
						className={cn(
							"flex h-7 items-center gap-2 rounded-md px-2 text-[13px]",
							item.active && "bg-surface-hover",
							item.checked && "bg-primary/10 text-foreground",
						)}
						key={item.name}
					>
						{item.dir ? (
							<span className="w-3.5" />
						) : (
							<span
								className={cn(
									"flex size-3.5 shrink-0 items-center justify-center rounded-[4px] border",
									item.checked
										? "border-primary bg-primary text-primary-foreground"
										: "border-border",
								)}
							>
								{item.checked ? <Check className="size-2.5" /> : null}
							</span>
						)}
						{item.dir ? (
							<Folder className="size-3.5 text-muted-foreground" />
						) : (
							<FileIcon name={item.name} />
						)}
						<span className="min-w-0 flex-1 truncate">{item.name}</span>
						{item.dir ? (
							<ChevronRight className="size-3 text-muted-foreground" />
						) : (
							<AgentMark touch={file?.agent} />
						)}
					</div>
				);
			})}
		</div>
	);
	return (
		<AppFrame>
			<SessionHeader />
			<div className="flex min-h-0 flex-1 flex-col">
				<ChatConversation />
				<Composer
					above={
						<div className="absolute right-0 bottom-[calc(100%+8px)] left-0 z-30 overflow-hidden rounded-xl border border-border bg-popover shadow-xl">
							<div className="flex h-11 items-center gap-3 border-b border-border/70 px-3">
								<div className="flex items-center gap-1 text-xs text-muted-foreground">
									<span className="font-medium text-foreground">
										{PROJECT.name}
									</span>
									<ChevronRight className="size-3" />
									src
									<ChevronRight className="size-3" />
									<span className="text-foreground">components</span>
								</div>
								<SearchField
									className="ml-auto h-7 w-56"
									placeholder="Search project"
								/>
							</div>
							<div className="flex h-[236px] divide-x divide-border/70">
								{col([
									{ name: ".github", dir: true },
									{ name: "public", dir: true },
									{ name: "src", dir: true, active: true },
									{ name: "tests", dir: true },
									{ name: "package.json" },
									{ name: "README.md" },
									{ name: "tsconfig.json" },
								])}
								{col([
									{ name: "app", dir: true },
									{ name: "components", dir: true, active: true },
									{ name: "lib", dir: true },
									{ name: "styles", dir: true },
								])}
								{col([
									{ name: "ui", dir: true },
									{ name: "export-button.tsx", checked: true },
									{ name: "invoice-table.tsx", checked: true },
									{ name: "sidebar-nav.tsx" },
								])}
								<div className="min-w-0 flex-1 overflow-hidden bg-background">
									<div className="flex h-8 items-center gap-2 px-3 text-[11px] text-muted-foreground">
										<Eye className="size-3" />
										Preview · invoice-table.tsx
									</div>
									<div className="pointer-events-none origin-top-left scale-[0.92]">
										<CodeView path={INVOICE} />
									</div>
								</div>
							</div>
							<div className="flex h-10 items-center justify-between border-t border-border/70 px-3 text-xs text-muted-foreground">
								<span>
									Space to select · <Kbd>⌘A</Kbd> select folder
								</span>
								<span className="inline-flex h-7 items-center gap-1.5 rounded-md bg-primary px-2.5 font-medium text-primary-foreground">
									Add 2 files
									<CornerDownLeft className="size-3" />
								</span>
							</div>
						</div>
					}
					chips={
						<>
							<ContextChip icon={<FileIcon name="a.tsx" className="size-3" />}>
								export-button.tsx
							</ContextChip>
							<ContextChip icon={<FileIcon name="a.tsx" className="size-3" />}>
								invoice-table.tsx
							</ContextChip>
						</>
					}
					text="Can you add a loading state to the export button while the CSV builds?"
					toolbarStart={
						<span className="inline-flex items-center gap-1.5 rounded-md bg-surface-hover px-2 py-1 text-sm text-foreground">
							<FolderOpen className="size-3.5" />
							Files
						</span>
					}
				/>
			</div>
		</AppFrame>
	);
}

/* 5. Working set: files grouped by what Cline did with them. */
export function ConceptWorkingSet() {
	const changed = FILES.filter((f) => f.git);
	const read = FILES.filter((f) => f.agent === "read");
	const total = changed.reduce((n, f) => n + (f.additions ?? 0), 0);
	const row = (
		path: string,
		detail: ReactNode,
		extra?: ReactNode,
		active?: boolean,
	) => (
		<div
			className={cn(
				"group flex h-11 items-center gap-2.5 rounded-lg px-2.5",
				active && "bg-surface-hover",
			)}
			key={path}
		>
			<FileIcon className="size-4" name={path} />
			<div className="flex min-w-0 flex-1 flex-col gap-0.5 leading-4">
				<span className="truncate text-[13px]">{path.split("/").pop()}</span>
				<span className="truncate text-[11px] text-muted-foreground">
					{detail}
				</span>
			</div>
			{extra}
			{active ? (
				<div className="flex items-center gap-0.5">
					<IconBtn className="size-6 bg-background">
						<Eye className="size-3.5" />
					</IconBtn>
					<IconBtn className="size-6 bg-background">
						<AtSign className="size-3.5" />
					</IconBtn>
				</div>
			) : null}
		</div>
	);
	return (
		<AppFrame>
			<SessionHeader
				actions={
					<HeaderIconButton active label="Working set">
						<ClineMark className="size-3" />
					</HeaderIconButton>
				}
			/>
			<div className="flex min-h-0 flex-1">
				<div className="flex min-w-0 flex-1 flex-col">
					<ChatConversation />
					<Composer />
				</div>
				<aside className="flex w-[380px] shrink-0 flex-col border-l border-border/70">
					<div className="border-b border-border/70 px-4 pt-3.5 pb-3">
						<div className="flex items-center justify-between">
							<span className="text-sm font-medium">Working set</span>
							<IconBtn className="-mr-1.5">
								<X className="size-3.5" />
							</IconBtn>
						</div>
						<div className="mt-1 text-xs text-muted-foreground">
							9 files touched · 4 changed ·{" "}
							<span className="font-mono text-chart-2">+{total}</span>{" "}
							<span className="font-mono text-destructive">-6</span>
						</div>
						<div className="mt-2.5 flex h-1.5 overflow-hidden rounded-full bg-muted">
							<span className="w-[38%] bg-chart-2" />
							<span className="w-[18%] bg-amber-500" />
							<span className="w-[44%] bg-muted-foreground/25" />
						</div>
						<div className="mt-2 flex gap-3 text-[11px] text-muted-foreground">
							<span className="flex items-center gap-1">
								<span className="size-1.5 rounded-full bg-chart-2" /> Created 3
							</span>
							<span className="flex items-center gap-1">
								<span className="size-1.5 rounded-full bg-amber-500" /> Edited 2
							</span>
							<span className="flex items-center gap-1">
								<span className="size-1.5 rounded-full bg-muted-foreground/40" />{" "}
								Read 5
							</span>
						</div>
					</div>
					<div className="min-h-0 flex-1 overflow-hidden px-2 py-2">
						<div className="flex items-center gap-1.5 px-2.5 pt-1 pb-1.5 text-[11px] font-medium text-muted-foreground">
							<ChevronDown className="size-3" /> Changed by Cline
						</div>
						{changed.map((file, index) =>
							row(
								file.path,
								<>
									{file.git === "A" ? "Created" : "Edited 3×"} ·{" "}
									{file.path.split("/").slice(0, -1).join("/")}
								</>,
								index === 1 ? null : (
									<DiffCount
										additions={file.additions}
										deletions={file.deletions}
									/>
								),
								index === 1,
							),
						)}
						<div className="flex items-center gap-1.5 px-2.5 pt-3 pb-1.5 text-[11px] font-medium text-muted-foreground">
							<ChevronDown className="size-3" /> Read for context
						</div>
						{read.map((file) =>
							row(
								file.path,
								file.path.split("/").slice(0, -1).join("/"),
								<span className="text-[11px] text-muted-foreground">
									{file.path.includes("format") ? "2×" : ""}
								</span>,
							),
						)}
					</div>
					<div className="flex h-11 shrink-0 items-center gap-2 border-t border-border/70 px-4 text-xs text-muted-foreground">
						<FolderTree className="size-3.5" />
						Browse all project files
						<span className="ml-auto font-mono text-[11px]">23</span>
						<ChevronRight className="size-3.5" />
					</div>
				</aside>
			</div>
		</AppFrame>
	);
}

/* 6. Sidebar mode: the left sidebar flips between Sessions and Files. */
export function ConceptSidebarMode() {
	return (
		<AppFrame
			sidebar={
				<aside className="flex h-full w-[260px] shrink-0 flex-col overflow-hidden border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
					<SidebarNavHeader />
					<div className="mx-2 mt-1 grid grid-cols-2 gap-0.5 rounded-lg bg-muted p-0.5 text-xs font-medium">
						<span className="flex h-7 items-center justify-center gap-1.5 rounded-md text-muted-foreground">
							<History className="size-3.5" />
							Sessions
						</span>
						<span className="flex h-7 items-center justify-center gap-1.5 rounded-md bg-background text-foreground shadow-xs">
							<FolderTree className="size-3.5" />
							Files
						</span>
					</div>
					<div className="mx-2 mt-3 flex items-center gap-2 rounded-md px-2 py-1.5">
						<span className="flex size-6 items-center justify-center rounded-md bg-primary/12 text-[11px] font-semibold text-primary">
							A
						</span>
						<div className="flex min-w-0 flex-1 flex-col">
							<span className="truncate text-sm font-medium">
								{PROJECT.name}
							</span>
							<span className="flex items-center gap-1 truncate text-[11px] text-muted-foreground">
								<GitBranch className="size-2.5" />
								{PROJECT.branch}
							</span>
						</div>
						<Search className="size-3.5 text-muted-foreground" />
					</div>
					<div className="min-h-0 flex-1 overflow-hidden">
						<FileTree
							expanded={["src", "src/components", "src/lib"]}
							hovered="src/lib/csv.ts"
						/>
					</div>
					<SidebarFooter />
				</aside>
			}
		>
			<SessionHeader />
			<div className="flex min-h-0 flex-1 flex-col">
				<ChatConversation />
				<Composer />
			</div>
			<div className="absolute top-[388px] left-2 z-40 w-[440px] overflow-hidden rounded-xl border border-border bg-popover shadow-xl">
				<div className="flex h-10 items-center justify-between border-b border-border/70 px-3">
					<div className="flex items-center gap-2">
						<Breadcrumb path="src/lib/csv.ts" />
						<Pill tone="success">New</Pill>
					</div>
					<div className="flex items-center gap-0.5">
						<IconBtn className="size-6">
							<AtSign className="size-3.5" />
						</IconBtn>
						<IconBtn className="size-6">
							<ArrowUpRight className="size-3.5" />
						</IconBtn>
					</div>
				</div>
				<div className="max-h-[300px] overflow-hidden py-1.5">
					<CodeView path="src/lib/csv.ts" />
				</div>
			</div>
		</AppFrame>
	);
}

/* 7. Finder-style column browser that takes over the session area. */
export function ConceptColumns() {
	const column = (
		items: { name: string; dir?: boolean; active?: boolean; path?: string }[],
	) => (
		<div className="flex w-[210px] shrink-0 flex-col gap-px border-r border-border/70 p-1.5">
			{items.map((item) => {
				const file = item.path ? fileByPath(item.path) : undefined;
				return (
					<div
						className={cn(
							"flex h-7 items-center gap-2 rounded-md px-2 text-[13px]",
							item.active && item.dir && "bg-surface-hover",
							item.active && !item.dir && "bg-primary text-primary-foreground",
						)}
						key={item.name}
					>
						{item.dir ? (
							<Folder
								className={cn(
									"size-3.5 shrink-0",
									item.active ? "text-foreground" : "text-muted-foreground",
								)}
							/>
						) : (
							<FileIcon
								className={item.active ? "text-primary-foreground" : undefined}
								name={item.name}
							/>
						)}
						<span className="min-w-0 flex-1 truncate">{item.name}</span>
						{item.dir ? (
							<ChevronRight className="size-3 text-muted-foreground" />
						) : item.active ? null : (
							<>
								<AgentMark touch={file?.agent} />
								<GitBadge status={file?.git} />
							</>
						)}
					</div>
				);
			})}
		</div>
	);
	return (
		<AppFrame>
			<SessionHeader
				actions={
					<HeaderIconButton active label="Files">
						<FolderTree className="size-3.5" />
					</HeaderIconButton>
				}
			/>
			<div className="flex min-h-0 flex-1 flex-col">
				<div className="flex h-11 shrink-0 items-center gap-3 border-b border-border/70 px-4">
					<span className="text-sm font-medium">Project files</span>
					<div className="flex items-center gap-1 text-xs text-muted-foreground">
						{PROJECT.name}
						<ChevronRight className="size-3" />
						src
						<ChevronRight className="size-3" />
						<span className="text-foreground">components</span>
					</div>
					<div className="ml-auto flex items-center gap-2">
						<SearchField
							className="h-7 w-60"
							kbd="⌘P"
							placeholder="Search files"
						/>
						<div className="flex items-center rounded-md bg-muted p-0.5">
							<span className="flex size-6 items-center justify-center rounded text-muted-foreground">
								<ListTree className="size-3.5" />
							</span>
							<span className="flex size-6 items-center justify-center rounded bg-background shadow-xs">
								<Columns3 className="size-3.5" />
							</span>
							<span className="flex size-6 items-center justify-center rounded text-muted-foreground">
								<List className="size-3.5" />
							</span>
						</div>
						<IconBtn>
							<X className="size-4" />
						</IconBtn>
					</div>
				</div>
				<div className="flex min-h-0 flex-1 overflow-hidden">
					{column([
						{ name: ".github", dir: true },
						{ name: "public", dir: true },
						{ name: "src", dir: true, active: true },
						{ name: "tests", dir: true },
						{ name: ".env.example", path: ".env.example" },
						{ name: ".gitignore", path: ".gitignore" },
						{ name: "next.config.mjs", path: "next.config.mjs" },
						{ name: "package.json", path: "package.json" },
						{ name: "README.md", path: "README.md" },
						{ name: "tsconfig.json", path: "tsconfig.json" },
					])}
					{column([
						{ name: "app", dir: true },
						{ name: "components", dir: true, active: true },
						{ name: "lib", dir: true },
						{ name: "styles", dir: true },
					])}
					{column([
						{ name: "ui", dir: true },
						{
							name: "export-button.tsx",
							path: "src/components/export-button.tsx",
						},
						{ name: "invoice-table.tsx", path: INVOICE, active: true },
						{ name: "sidebar-nav.tsx", path: "src/components/sidebar-nav.tsx" },
					])}
					<div className="flex min-w-0 flex-1 flex-col">
						<div className="flex items-start gap-3 border-b border-border/70 px-5 py-4">
							<div className="flex size-10 items-center justify-center rounded-lg bg-sky-500/10">
								<FileIcon className="size-5" name="x.tsx" />
							</div>
							<div className="min-w-0 flex-1">
								<div className="text-sm font-medium">invoice-table.tsx</div>
								<div className="mt-0.5 text-xs text-muted-foreground">
									TypeScript React · 58 lines · 2.3 KB · modified just now
								</div>
								<div className="mt-2 flex items-center gap-1.5">
									<Pill tone="primary">
										<ClineMark className="size-2.5" />
										Edited by Cline
									</Pill>
									<Pill tone="warning">Uncommitted</Pill>
									<DiffCount
										additions={31}
										deletions={4}
										className="ml-1 text-[11px]"
									/>
								</div>
							</div>
							<FileActions compact />
						</div>
						<div className="min-h-0 flex-1 overflow-hidden pt-2">
							<CodeView path={INVOICE} selected={INVOICE_TABLE_CHANGED} />
						</div>
					</div>
				</div>
				<div className="border-t border-border/70 pt-4">
					<Composer />
				</div>
			</div>
		</AppFrame>
	);
}

/* 8. Inline peek: file paths in the conversation open a floating preview. */
export function ConceptInlinePeek() {
	const tool = (icon: ReactNode, label: ReactNode, extra?: ReactNode) => (
		<div className="flex h-7 items-center gap-2 text-[13px] text-muted-foreground">
			{icon}
			{label}
			{extra}
		</div>
	);
	const link = (path: string, active?: boolean) => (
		<span
			className={cn(
				"inline-flex items-center gap-1 rounded px-1 font-mono text-xs text-foreground underline decoration-muted-foreground/40 decoration-dotted underline-offset-4",
				active && "bg-primary/12 text-primary decoration-primary",
			)}
		>
			<FileIcon className="size-3" name={path} />
			{path.split("/").pop()}
		</span>
	);
	return (
		<AppFrame>
			<SessionHeader />
			<div className="relative flex min-h-0 flex-1 flex-col">
				<ChatConversation
					activeLink={INVOICE}
					linkFiles
					work={
						<div className="cline-chat-work">
							<button
								aria-expanded="true"
								className="cline-chat-work-trigger"
								type="button"
							>
								<span className="cline-chat-tool-label">
									Worked for 1m 12s and made 11 tool calls
								</span>
								<ChevronDown className="cline-chat-disclosure-icon" />
							</button>
							<div className="mt-1 ml-0.5 flex flex-col border-l border-border pl-3">
								{tool(
									<BookOpen className="size-3.5" />,
									<>Read 5 files</>,
									<span className="flex gap-1">
										{link("src/app/invoices/page.tsx")}
										{link("src/lib/format.ts")}
										<span className="text-xs">+3</span>
									</span>,
								)}
								{tool(
									<FilePlus2 className="size-3.5" />,
									<>Created</>,
									<span className="flex items-center gap-1.5">
										{link("src/lib/csv.ts")}
										<DiffCount additions={18} />
									</span>,
								)}
								{tool(
									<Pencil className="size-3.5" />,
									<>Edited</>,
									<span className="flex items-center gap-1.5">
										{link(INVOICE, true)}
										<DiffCount additions={31} deletions={4} />
									</span>,
								)}
							</div>
						</div>
					}
				/>
				<Composer />
				<div className="absolute top-[218px] left-[200px] z-40 w-[600px] overflow-hidden rounded-xl border border-border bg-popover shadow-2xl">
					<div className="flex h-10 items-center justify-between gap-2 border-b border-border/70 px-3">
						<div className="flex min-w-0 items-center gap-2">
							<Breadcrumb path={INVOICE} />
							<DiffCount additions={31} deletions={4} className="text-[11px]" />
						</div>
						<div className="flex items-center gap-1">
							<PanelTabs
								active="Changes"
								tabs={[{ label: "File" }, { label: "Changes" }]}
							/>
							<IconBtn className="size-6">
								<ArrowUpRight className="size-3.5" />
							</IconBtn>
						</div>
					</div>
					<div className="max-h-[330px] overflow-hidden py-1">
						<ChangesView
							newText={CONTENTS[INVOICE] ?? ""}
							oldText={INVOICE_OLD}
							path={INVOICE}
						/>
					</div>
					<div className="flex h-9 items-center justify-between border-t border-border/70 px-3 text-[11px] text-muted-foreground">
						<span>Lines 19–28 · step 7 of 11</span>
						<span className="flex items-center gap-3">
							<span className="flex items-center gap-1">
								<AtSign className="size-3" /> Reference
							</span>
							<span className="flex items-center gap-1">
								<EditorIcon className="size-3" editorId="vscode" /> Open in VS
								Code
							</span>
						</span>
					</div>
				</div>
			</div>
		</AppFrame>
	);
}

/* 9. Project overview: a home for the repo, reached from the workspace chip. */
export function ConceptProjectHome() {
	return (
		<AppFrame>
			<SessionHeader
				actions={
					<HeaderIconButton active label={PROJECT.name}>
						<GitBranch className="size-3.5" />
					</HeaderIconButton>
				}
			/>
			<div className="min-h-0 flex-1 overflow-hidden px-8 pt-6">
				<div className="mx-auto max-w-[1060px]">
					<div className="flex items-end justify-between">
						<div>
							<div className="flex items-center gap-2 text-xs text-muted-foreground">
								<span className="inline-flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5">
									<GitBranch className="size-3" />
									{PROJECT.branch}
								</span>
								{PROJECT.root}
							</div>
							<h1 className="mt-2 text-2xl font-semibold tracking-tight">
								{PROJECT.name}
							</h1>
						</div>
						<div className="flex items-center gap-2">
							<SearchField className="w-64" kbd="⌘P" placeholder="Go to file" />
							<FileActions />
						</div>
					</div>
					<div className="mt-4 flex h-2 overflow-hidden rounded-full">
						<span className="w-[78%] bg-blue-500" />
						<span className="w-[12%] bg-violet-500" />
						<span className="w-[6%] bg-amber-500" />
						<span className="w-[4%] bg-muted-foreground/30" />
					</div>
					<div className="mt-2 flex gap-4 text-[11px] text-muted-foreground">
						<span className="flex items-center gap-1.5">
							<span className="size-2 rounded-full bg-blue-500" />
							TypeScript 78%
						</span>
						<span className="flex items-center gap-1.5">
							<span className="size-2 rounded-full bg-violet-500" />
							CSS 12%
						</span>
						<span className="flex items-center gap-1.5">
							<span className="size-2 rounded-full bg-amber-500" />
							JSON 6%
						</span>
						<span className="flex items-center gap-1.5">
							<span className="size-2 rounded-full bg-muted-foreground/40" />
							Other 4%
						</span>
					</div>
					<div className="mt-5 grid grid-cols-[320px_minmax(0,1fr)] gap-5">
						<div className="flex flex-col gap-5">
							<div className="overflow-hidden rounded-xl border border-border">
								<div className="flex h-10 items-center justify-between border-b border-border/70 px-3 text-xs font-medium">
									Files
									<span className="font-normal text-muted-foreground">23</span>
								</div>
								<div className="h-[300px] overflow-hidden">
									<FileTree dense expanded={["src", "src/components"]} />
								</div>
							</div>
							<div className="rounded-xl border border-border">
								<div className="flex h-10 items-center border-b border-border/70 px-3 text-xs font-medium">
									Uncommitted changes
									<span className="ml-auto font-mono text-[11px]">
										<span className="text-chart-2">+99</span>{" "}
										<span className="text-destructive">-6</span>
									</span>
								</div>
								{FILES.filter((f) => f.git).map((file) => (
									<div
										className="flex h-8 items-center gap-2 px-3 text-[13px]"
										key={file.path}
									>
										<FileIcon name={file.path} />
										<span className="truncate">
											{file.path.split("/").pop()}
										</span>
										<span className="ml-auto">
											<DiffCount
												additions={file.additions}
												deletions={file.deletions}
											/>
										</span>
										<GitBadge status={file.git} />
									</div>
								))}
							</div>
						</div>
						<div className="flex flex-col gap-5">
							<div className="overflow-hidden rounded-xl border border-border">
								<div className="flex h-10 items-center gap-2 border-b border-border/70 px-4 text-xs font-medium">
									<BookOpen className="size-3.5 text-muted-foreground" />
									README.md
								</div>
								<div className="cline-markdown space-y-3 px-6 py-5 text-sm">
									{README.trim()
										.split("\n\n")
										.map((block) => {
											if (block.startsWith("# "))
												return (
													<h2 className="text-xl font-semibold" key={block}>
														{block.slice(2)}
													</h2>
												);
											if (block.startsWith("## "))
												return (
													<h3
														className="pt-1 text-base font-semibold"
														key={block}
													>
														{block.slice(3)}
													</h3>
												);
											if (block.startsWith("```"))
												return (
													<pre
														className="rounded-lg bg-muted px-4 py-3 font-mono text-xs leading-5"
														key={block}
													>
														{block.replace(/```(bash)?\n?/g, "")}
													</pre>
												);
											if (block.startsWith("- "))
												return (
													<ul className="list-disc space-y-1 pl-5" key={block}>
														{block.split("\n").map((line) => (
															<li key={line}>
																<code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
																	{line.match(/`(.+?)`/)?.[1]}
																</code>{" "}
																{line.split("– ")[1]}
															</li>
														))}
													</ul>
												);
											return (
												<p className="text-muted-foreground" key={block}>
													{block}
												</p>
											);
										})}
								</div>
							</div>
							<div className="rounded-xl border border-border">
								<div className="flex h-10 items-center border-b border-border/70 px-4 text-xs font-medium">
									Sessions in this project
								</div>
								{[
									{
										title: SESSION_TITLE,
										meta: "now · 4 files changed",
										live: true,
									},
									{
										title: "Fix flaky auth redirect test",
										meta: "2h · 2 files changed",
									},
									{
										title: "Investigate slow dashboard load",
										meta: "2d · read-only",
									},
								].map((session) => (
									<div
										className="flex h-10 items-center gap-2.5 px-4 text-[13px]"
										key={session.title}
									>
										<span
											className={cn(
												"size-1.5 rounded-full",
												session.live ? "bg-chart-2" : "bg-muted-foreground/40",
											)}
										/>
										<span className="truncate">{session.title}</span>
										<span className="ml-auto text-xs text-muted-foreground">
											{session.meta}
										</span>
									</div>
								))}
							</div>
						</div>
					</div>
				</div>
			</div>
		</AppFrame>
	);
}

/* 10. Header tabs: Chat, Files, and Changes as peers, with the composer kept. */
export function ConceptHeaderTabs() {
	return (
		<AppFrame>
			<SessionHeader
				center={
					<PanelTabs
						active="Files"
						tabs={[
							{
								label: "Chat",
								icon: <MessageSquarePlus className="size-3.5" />,
							},
							{ label: "Files", icon: <FolderTree className="size-3.5" /> },
							{
								label: "Changes",
								count: 4,
								icon: <FileDiffIcon className="size-3.5" />,
							},
						]}
					/>
				}
				diff={false}
			/>
			<div className="flex min-h-0 flex-1">
				<div className="flex w-[264px] shrink-0 flex-col border-r border-border/70">
					<div className="px-3 pt-3 pb-1">
						<SearchField kbd="⌘P" placeholder="Go to file" />
					</div>
					<FileTree selected={INVOICE} />
				</div>
				<div className="relative flex min-w-0 flex-1 flex-col">
					<div className="flex h-11 shrink-0 items-center justify-between border-b border-border/70 px-4">
						<div className="flex items-center gap-2.5">
							<Breadcrumb path={INVOICE} />
							<Pill tone="primary">
								<ClineMark className="size-2.5" />
								Edited
							</Pill>
						</div>
						<div className="flex items-center gap-1">
							<IconBtn>
								<Copy className="size-3.5" />
							</IconBtn>
							<IconBtn>
								<AppWindow className="size-3.5" />
							</IconBtn>
							<FileActions compact />
						</div>
					</div>
					<div className="min-h-0 flex-1 overflow-hidden pt-2">
						<CodeView path={INVOICE} selected={INVOICE_TABLE_CHANGED} />
					</div>
					<div className="absolute top-[366px] left-[548px] z-30 flex items-center gap-1 rounded-lg border border-border bg-popover p-1 text-xs shadow-lg">
						<span className="inline-flex h-6 items-center gap-1.5 rounded-md bg-primary px-2 font-medium text-primary-foreground">
							<Sparkles className="size-3" />
							Ask Cline
						</span>
						<span className="inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-muted-foreground">
							<AtSign className="size-3" />
							Reference
						</span>
						<Kbd>⌘L</Kbd>
					</div>
					<Composer
						chips={
							<ContextChip icon={<FileIcon className="size-3" name="x.tsx" />}>
								invoice-table.tsx:19-28
							</ContextChip>
						}
						text="Move this into a useCsvDownload hook so the API route can share it"
					/>
				</div>
			</div>
		</AppFrame>
	);
}

export const CONCEPTS = [
	{ id: 1, title: "Inspector panel", Component: ConceptInspector },
	{ id: 2, title: "Workbench", Component: ConceptWorkbench },
	{ id: 3, title: "Quick open", Component: ConceptQuickOpen },
	{ id: 4, title: "Composer file picker", Component: ConceptComposerPicker },
	{ id: 5, title: "Working set", Component: ConceptWorkingSet },
	{ id: 6, title: "Sidebar files mode", Component: ConceptSidebarMode },
	{ id: 7, title: "Column browser", Component: ConceptColumns },
	{ id: 8, title: "Inline peek", Component: ConceptInlinePeek },
	{ id: 9, title: "Project home", Component: ConceptProjectHome },
	{ id: 10, title: "Header tabs", Component: ConceptHeaderTabs },
];
