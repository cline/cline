"use client";

import {
	ChevronRightIcon,
	FileIcon,
	FolderIcon,
	FolderOpenIcon,
} from "lucide-react";
import type { HTMLAttributes, ReactNode } from "react";
import {
	createContext,
	useCallback,
	useContext,
	useMemo,
	useState,
} from "react";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

interface FileTreeContextType {
	expandedPaths: Set<string>;
	togglePath: (path: string) => void;
	selectedPath?: string;
	onSelect?: (path: string) => void;
}

// Default noop for context default value
// oxlint-disable-next-line eslint(no-empty-function)
const noop = () => {};

const FileTreeContext = createContext<FileTreeContextType>({
	// oxlint-disable-next-line eslint-plugin-unicorn(no-new-builtin)
	expandedPaths: new Set(),
	togglePath: noop,
});

export type FileTreeProps = Omit<HTMLAttributes<HTMLDivElement>, "onSelect"> & {
	expanded?: Set<string>;
	defaultExpanded?: Set<string>;
	selectedPath?: string;
	onSelect?: (path: string) => void;
	onExpandedChange?: (expanded: Set<string>) => void;
};

export const FileTree = ({
	expanded: controlledExpanded,
	defaultExpanded = new Set(),
	selectedPath,
	onSelect,
	onExpandedChange,
	className,
	children,
	...props
}: FileTreeProps) => {
	const [internalExpanded, setInternalExpanded] = useState(defaultExpanded);
	const expandedPaths = controlledExpanded ?? internalExpanded;

	const togglePath = useCallback(
		(path: string) => {
			const newExpanded = new Set(expandedPaths);
			if (newExpanded.has(path)) {
				newExpanded.delete(path);
			} else {
				newExpanded.add(path);
			}
			setInternalExpanded(newExpanded);
			onExpandedChange?.(newExpanded);
		},
		[expandedPaths, onExpandedChange],
	);

	const contextValue = useMemo(
		() => ({ expandedPaths, onSelect, selectedPath, togglePath }),
		[expandedPaths, onSelect, selectedPath, togglePath],
	);

	return (
		<FileTreeContext.Provider value={contextValue}>
			<div
				className={cn(
					"rounded-lg border bg-background font-mono text-sm",
					className,
				)}
				role="tree"
				{...props}
			>
				<div className="p-2">{children}</div>
			</div>
		</FileTreeContext.Provider>
	);
};

export type FileTreeIconProps = HTMLAttributes<HTMLSpanElement>;

export const FileTreeIcon = ({
	className,
	children,
	...props
}: FileTreeIconProps) => (
	<span className={cn("shrink-0", className)} {...props}>
		{children}
	</span>
);

export type FileTreeNameProps = HTMLAttributes<HTMLSpanElement>;

export const FileTreeName = ({
	className,
	children,
	...props
}: FileTreeNameProps) => (
	<span className={cn("truncate", className)} {...props}>
		{children}
	</span>
);

interface FileTreeFolderContextType {
	path: string;
	name: string;
	isExpanded: boolean;
}

const FileTreeFolderContext = createContext<FileTreeFolderContextType>({
	isExpanded: false,
	name: "",
	path: "",
});

export type FileTreeFolderProps = HTMLAttributes<HTMLDivElement> & {
	path: string;
	name: string;
};

export const FileTreeFolder = ({
	path,
	name,
	className,
	children,
	...props
}: FileTreeFolderProps) => {
	const { expandedPaths, togglePath, selectedPath, onSelect } =
		useContext(FileTreeContext);
	const isExpanded = expandedPaths.has(path);
	const isSelected = selectedPath === path;

	const handleOpenChange = useCallback(() => {
		togglePath(path);
	}, [togglePath, path]);

	const handleSelect = useCallback(() => {
		onSelect?.(path);
	}, [onSelect, path]);

	const folderContextValue = useMemo(
		() => ({ isExpanded, name, path }),
		[isExpanded, name, path],
	);

	return (
		<FileTreeFolderContext.Provider value={folderContextValue}>
			<Collapsible onOpenChange={handleOpenChange} open={isExpanded}>
				<div
					className={cn("", className)}
					role="treeitem"
					tabIndex={0}
					{...props}
				>
					<div
						className={cn(
							"flex w-full items-center gap-1 rounded px-2 py-1 text-left transition-colors hover:bg-muted/50",
							isSelected && "bg-muted",
						)}
					>
						<CollapsibleTrigger
							render={
								<button
									className="flex shrink-0 cursor-pointer items-center border-none bg-transparent p-0"
									type="button"
								/>
							}
						>
							<ChevronRightIcon
								className={cn(
									"size-4 shrink-0 text-muted-foreground transition-transform",
									isExpanded && "rotate-90",
								)}
							/>
						</CollapsibleTrigger>
						<button
							className="flex min-w-0 flex-1 cursor-pointer items-center gap-1 border-none bg-transparent p-0 text-left"
							onClick={handleSelect}
							type="button"
						>
							<FileTreeIcon>
								{isExpanded ? (
									<FolderOpenIcon className="size-4 text-blue-500" />
								) : (
									<FolderIcon className="size-4 text-blue-500" />
								)}
							</FileTreeIcon>
							<FileTreeName>{name}</FileTreeName>
						</button>
					</div>
					<CollapsibleContent>
						<div className="ml-4 border-l pl-2">{children}</div>
					</CollapsibleContent>
				</div>
			</Collapsible>
		</FileTreeFolderContext.Provider>
	);
};

interface FileTreeFileContextType {
	path: string;
	name: string;
}

const FileTreeFileContext = createContext<FileTreeFileContextType>({
	name: "",
	path: "",
});

export type FileTreeFileProps = HTMLAttributes<HTMLDivElement> & {
	path: string;
	name: string;
	icon?: ReactNode;
};

export const FileTreeFile = ({
	path,
	name,
	icon,
	className,
	children,
	...props
}: FileTreeFileProps) => {
	const { selectedPath, onSelect } = useContext(FileTreeContext);
	const isSelected = selectedPath === path;

	const handleClick = useCallback(() => {
		onSelect?.(path);
	}, [onSelect, path]);

	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			if (e.key === "Enter" || e.key === " ") {
				onSelect?.(path);
			}
		},
		[onSelect, path],
	);

	const fileContextValue = useMemo(() => ({ name, path }), [name, path]);

	return (
		<FileTreeFileContext.Provider value={fileContextValue}>
			<div
				className={cn(
					"flex cursor-pointer items-center gap-1 rounded px-2 py-1 transition-colors hover:bg-muted/50",
					isSelected && "bg-muted",
					className,
				)}
				onClick={handleClick}
				onKeyDown={handleKeyDown}
				role="treeitem"
				tabIndex={0}
				{...props}
			>
				{children ?? (
					<>
						{/* Spacer for alignment */}
						<span className="size-4 shrink-0" />
						<FileTreeIcon>
							{icon ?? <FileIcon className="size-4 text-muted-foreground" />}
						</FileTreeIcon>
						<FileTreeName>{name}</FileTreeName>
					</>
				)}
			</div>
		</FileTreeFileContext.Provider>
	);
};

export type FileTreeActionsProps = HTMLAttributes<HTMLDivElement>;

const stopPropagation = (e: React.SyntheticEvent) => e.stopPropagation();

export const FileTreeActions = ({
	className,
	children,
	...props
}: FileTreeActionsProps) => (
	// biome-ignore lint/a11y/useSemanticElements: fieldset would break layout styling
	<div
		className={cn("ml-auto flex items-center gap-1", className)}
		onClick={stopPropagation}
		onKeyDown={stopPropagation}
		role="group"
		{...props}
	>
		{children}
	</div>
);
