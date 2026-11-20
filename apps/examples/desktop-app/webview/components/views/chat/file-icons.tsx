"use client";

import {
	Atom,
	BookOpen,
	Braces,
	Code,
	Coffee,
	Cog,
	Container,
	Database,
	FileArchive,
	FileAudio,
	FileCode2,
	FileCog,
	FileImage,
	FileKey2,
	FileLock2,
	FileSpreadsheet,
	FileTerminal,
	FileText,
	FileType2,
	FileVideo,
	Folder,
	FolderCode,
	FolderCog,
	FolderGit2,
	FolderOpen,
	Gem,
	GitBranch,
	Hash,
	type LucideIcon,
	Package,
	Palette,
	Scale,
	Workflow,
} from "lucide-react";
import { cn } from "@/lib/utils";

type IconSpec = { icon: LucideIcon; className: string };

const CODE = FileCode2;

// Language colors follow the usual editor conventions so files read at a
// glance; anything unknown stays a neutral document.
const BY_EXTENSION: Record<string, IconSpec> = {
	ts: { icon: CODE, className: "text-sky-600 dark:text-sky-400" },
	cts: { icon: CODE, className: "text-sky-600 dark:text-sky-400" },
	mts: { icon: CODE, className: "text-sky-600 dark:text-sky-400" },
	tsx: { icon: Atom, className: "text-sky-600 dark:text-sky-400" },
	jsx: { icon: Atom, className: "text-cyan-600 dark:text-cyan-400" },
	js: { icon: CODE, className: "text-yellow-600 dark:text-yellow-400" },
	cjs: { icon: CODE, className: "text-yellow-600 dark:text-yellow-400" },
	mjs: { icon: CODE, className: "text-yellow-600 dark:text-yellow-400" },
	json: { icon: Braces, className: "text-amber-600 dark:text-amber-400" },
	jsonc: { icon: Braces, className: "text-amber-600 dark:text-amber-400" },
	json5: { icon: Braces, className: "text-amber-600 dark:text-amber-400" },
	md: { icon: FileText, className: "text-sky-500 dark:text-sky-300" },
	mdx: { icon: FileText, className: "text-amber-600 dark:text-amber-400" },
	txt: { icon: FileText, className: "text-muted-foreground" },
	css: { icon: Hash, className: "text-violet-600 dark:text-violet-400" },
	scss: { icon: Hash, className: "text-pink-600 dark:text-pink-400" },
	sass: { icon: Hash, className: "text-pink-600 dark:text-pink-400" },
	less: { icon: Hash, className: "text-indigo-600 dark:text-indigo-400" },
	html: { icon: Code, className: "text-orange-600 dark:text-orange-400" },
	htm: { icon: Code, className: "text-orange-600 dark:text-orange-400" },
	xml: { icon: Code, className: "text-orange-500 dark:text-orange-300" },
	svg: { icon: FileImage, className: "text-amber-600 dark:text-amber-400" },
	vue: { icon: CODE, className: "text-emerald-600 dark:text-emerald-400" },
	svelte: { icon: CODE, className: "text-orange-600 dark:text-orange-400" },
	py: { icon: CODE, className: "text-blue-600 dark:text-blue-400" },
	rb: { icon: Gem, className: "text-red-600 dark:text-red-400" },
	go: { icon: CODE, className: "text-cyan-600 dark:text-cyan-400" },
	rs: { icon: Cog, className: "text-orange-700 dark:text-orange-400" },
	java: { icon: Coffee, className: "text-red-600 dark:text-red-400" },
	kt: { icon: CODE, className: "text-violet-600 dark:text-violet-400" },
	swift: { icon: CODE, className: "text-orange-600 dark:text-orange-400" },
	c: { icon: CODE, className: "text-blue-600 dark:text-blue-400" },
	h: { icon: CODE, className: "text-violet-600 dark:text-violet-400" },
	cpp: { icon: CODE, className: "text-blue-600 dark:text-blue-400" },
	hpp: { icon: CODE, className: "text-violet-600 dark:text-violet-400" },
	cs: { icon: CODE, className: "text-green-600 dark:text-green-400" },
	php: { icon: CODE, className: "text-indigo-600 dark:text-indigo-400" },
	lua: { icon: CODE, className: "text-blue-700 dark:text-blue-400" },
	sql: { icon: Database, className: "text-pink-600 dark:text-pink-400" },
	sh: { icon: FileTerminal, className: "text-green-600 dark:text-green-400" },
	bash: { icon: FileTerminal, className: "text-green-600 dark:text-green-400" },
	zsh: { icon: FileTerminal, className: "text-green-600 dark:text-green-400" },
	ps1: { icon: FileTerminal, className: "text-blue-600 dark:text-blue-400" },
	yml: { icon: FileCog, className: "text-rose-600 dark:text-rose-400" },
	yaml: { icon: FileCog, className: "text-rose-600 dark:text-rose-400" },
	toml: { icon: FileCog, className: "text-orange-600 dark:text-orange-400" },
	ini: { icon: FileCog, className: "text-muted-foreground" },
	conf: { icon: FileCog, className: "text-muted-foreground" },
	lock: { icon: FileLock2, className: "text-muted-foreground" },
	lockb: { icon: FileLock2, className: "text-muted-foreground" },
	png: { icon: FileImage, className: "text-emerald-600 dark:text-emerald-400" },
	jpg: { icon: FileImage, className: "text-emerald-600 dark:text-emerald-400" },
	jpeg: {
		icon: FileImage,
		className: "text-emerald-600 dark:text-emerald-400",
	},
	gif: { icon: FileImage, className: "text-emerald-600 dark:text-emerald-400" },
	webp: {
		icon: FileImage,
		className: "text-emerald-600 dark:text-emerald-400",
	},
	ico: { icon: FileImage, className: "text-emerald-600 dark:text-emerald-400" },
	icns: {
		icon: FileImage,
		className: "text-emerald-600 dark:text-emerald-400",
	},
	mp4: { icon: FileVideo, className: "text-fuchsia-600 dark:text-fuchsia-400" },
	mov: { icon: FileVideo, className: "text-fuchsia-600 dark:text-fuchsia-400" },
	mp3: { icon: FileAudio, className: "text-fuchsia-600 dark:text-fuchsia-400" },
	wav: { icon: FileAudio, className: "text-fuchsia-600 dark:text-fuchsia-400" },
	zip: { icon: FileArchive, className: "text-amber-700 dark:text-amber-400" },
	gz: { icon: FileArchive, className: "text-amber-700 dark:text-amber-400" },
	tgz: { icon: FileArchive, className: "text-amber-700 dark:text-amber-400" },
	csv: {
		icon: FileSpreadsheet,
		className: "text-green-600 dark:text-green-400",
	},
	woff: { icon: FileType2, className: "text-muted-foreground" },
	woff2: { icon: FileType2, className: "text-muted-foreground" },
	ttf: { icon: FileType2, className: "text-muted-foreground" },
	pem: { icon: FileKey2, className: "text-yellow-600 dark:text-yellow-400" },
	key: { icon: FileKey2, className: "text-yellow-600 dark:text-yellow-400" },
};

const BY_NAME: Record<string, IconSpec> = {
	"package.json": {
		icon: Package,
		className: "text-red-600 dark:text-red-400",
	},
	"bun.lock": { icon: FileLock2, className: "text-muted-foreground" },
	"package-lock.json": { icon: FileLock2, className: "text-muted-foreground" },
	"pnpm-lock.yaml": { icon: FileLock2, className: "text-muted-foreground" },
	"yarn.lock": { icon: FileLock2, className: "text-muted-foreground" },
	"cargo.lock": { icon: FileLock2, className: "text-muted-foreground" },
	"tsconfig.json": {
		icon: FileCog,
		className: "text-sky-600 dark:text-sky-400",
	},
	dockerfile: { icon: Container, className: "text-sky-600 dark:text-sky-400" },
	".dockerignore": { icon: Container, className: "text-muted-foreground" },
	".gitignore": {
		icon: GitBranch,
		className: "text-orange-600 dark:text-orange-400",
	},
	".gitattributes": {
		icon: GitBranch,
		className: "text-orange-600 dark:text-orange-400",
	},
	".gitmodules": {
		icon: GitBranch,
		className: "text-orange-600 dark:text-orange-400",
	},
	".gitleaks.toml": {
		icon: GitBranch,
		className: "text-orange-600 dark:text-orange-400",
	},
	license: { icon: Scale, className: "text-amber-600 dark:text-amber-400" },
	"license.md": {
		icon: Scale,
		className: "text-amber-600 dark:text-amber-400",
	},
	"readme.md": { icon: BookOpen, className: "text-sky-500 dark:text-sky-300" },
	"changelog.md": {
		icon: BookOpen,
		className: "text-sky-500 dark:text-sky-300",
	},
	makefile: {
		icon: FileTerminal,
		className: "text-orange-600 dark:text-orange-400",
	},
	".nvmrc": { icon: FileCog, className: "text-green-600 dark:text-green-400" },
	".editorconfig": { icon: FileCog, className: "text-muted-foreground" },
	"biome.json": { icon: FileCog, className: "text-sky-600 dark:text-sky-400" },
};

const BY_FOLDER: Record<string, IconSpec> = {
	".git": {
		icon: FolderGit2,
		className: "text-orange-600 dark:text-orange-400",
	},
	".github": { icon: FolderGit2, className: "text-muted-foreground" },
	".vscode": { icon: FolderCog, className: "text-sky-600 dark:text-sky-400" },
	".husky": { icon: FolderCog, className: "text-muted-foreground" },
	src: { icon: FolderCode, className: "text-sky-600 dark:text-sky-400" },
	scripts: { icon: FolderCode, className: "text-muted-foreground" },
	node_modules: { icon: Folder, className: "text-muted-foreground/60" },
	workflows: { icon: Workflow, className: "text-muted-foreground" },
	assets: { icon: Palette, className: "text-muted-foreground" },
};

// Filenames are arbitrary text: `constructor` or `__proto__` must not
// resolve to an inherited Object property.
function lookup(
	table: Record<string, IconSpec>,
	key: string,
): IconSpec | undefined {
	return Object.hasOwn(table, key) ? table[key] : undefined;
}

function baseName(path: string): string {
	return path.split(/[\\/]/).pop() ?? path;
}

export function fileIconSpec(path: string): IconSpec {
	const name = baseName(path).toLowerCase();
	const byName = lookup(BY_NAME, name);
	if (byName) return byName;
	if (name.startsWith(".env")) {
		return {
			icon: FileKey2,
			className: "text-yellow-600 dark:text-yellow-400",
		};
	}
	if (name.startsWith("dockerfile") || name.endsWith(".dockerfile")) {
		return BY_NAME.dockerfile as IconSpec;
	}
	const extension = name.includes(".") ? (name.split(".").pop() ?? "") : "";
	return (
		lookup(BY_EXTENSION, extension) ?? {
			icon: FileText,
			className: "text-muted-foreground",
		}
	);
}

export function FileIcon({
	path,
	className,
}: {
	path: string;
	className?: string;
}) {
	const { icon: Icon, className: tint } = fileIconSpec(path);
	return (
		<Icon aria-hidden className={cn("size-3.5 shrink-0", tint, className)} />
	);
}

export function FolderIcon({
	path,
	open,
	className,
}: {
	path: string;
	open: boolean;
	className?: string;
}) {
	const special = lookup(BY_FOLDER, baseName(path).toLowerCase());
	const Icon = special?.icon ?? (open ? FolderOpen : Folder);
	const tint =
		special?.className ??
		(baseName(path).startsWith(".")
			? "text-muted-foreground/80"
			: "text-muted-foreground");
	return (
		<Icon aria-hidden className={cn("size-3.5 shrink-0", tint, className)} />
	);
}
