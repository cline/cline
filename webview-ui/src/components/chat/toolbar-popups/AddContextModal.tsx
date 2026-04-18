import { StringRequest } from "@shared/proto/cline/common"
import { FileSearchRequest, FileSearchType } from "@shared/proto/cline/file"
import type React from "react"
import { useCallback, useEffect, useRef, useState } from "react"
import styled, { keyframes } from "styled-components"
import { FileServiceClient } from "@/services/grpc-client"

// ─── Animation ────────────────────────────────────────────────────────────────
const popupAppear = keyframes`
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: translateY(0); }
`

// ─── Styled Components ────────────────────────────────────────────────────────
const PopupWrapper = styled.div`
	position: absolute;
	bottom: calc(100% + 8px);
	left: 0;
	width: 240px;
	background: var(--popup-bg);
	border: var(--popup-border);
	border-radius: var(--popup-radius, 10px);
	overflow: hidden;
	z-index: 200;
	animation: ${popupAppear} var(--popup-appear-duration, 0.18s) ease forwards;
	box-shadow: 0 8px 24px var(--vscode-widget-shadow, rgba(0, 0, 0, 0.4));
`

const Row = styled.div<{ $active?: boolean }>`
	display: flex;
	align-items: center;
	gap: 9px;
	padding: var(--popup-item-padding, 7px 11px);
	cursor: pointer;
	border-bottom: var(--popup-item-separator);
	transition: background 0.12s;
	background: ${(p) => (p.$active ? "var(--popup-item-hover-bg)" : "transparent")};

	&:last-child {
		border-bottom: none;
	}

	&:hover {
		background: var(--popup-item-hover-bg);
	}
`

const RowIcon = styled.div`
	width: 14px;
	height: 14px;
	display: flex;
	align-items: center;
	justify-content: center;
	flex-shrink: 0;
	opacity: var(--popup-icon-opacity, 0.6);
	color: var(--popup-icon-stroke);
	font-size: 13px;
`

const RowLabel = styled.span`
	color: var(--popup-text-primary);
	font-size: var(--popup-font-size, var(--vscode-font-size, 11px));
	flex: 1;
`

const RowAction = styled.i`
	color: var(--popup-text-meta);
	font-size: 12px;
	opacity: 0.7;
`

const ChevronIcon = styled.i<{ $open: boolean }>`
	flex-shrink: 0;
	font-size: 12px;
	opacity: 0.5;
	color: var(--popup-text-muted);
	transition: transform 0.2s;
	transform: rotate(${(p) => (p.$open ? "90deg" : "0deg")});
`

const AccordionContent = styled.div<{ $open: boolean }>`
	overflow: hidden;
	max-height: ${(p) => (p.$open ? "220px" : "0")};
	transition: max-height 0.28s cubic-bezier(0.4, 0, 0.2, 1);
`

const SubScroll = styled.div`
	overflow-y: auto;
	max-height: 220px;
	background: var(--popup-sub-bg);

	&::-webkit-scrollbar {
		width: var(--scrollbar-width, 4px);
	}
	&::-webkit-scrollbar-track {
		background: var(--scrollbar-track-bg, transparent);
	}
	&::-webkit-scrollbar-thumb {
		background: var(--scrollbar-thumb-bg);
		border-radius: var(--scrollbar-radius, 2px);
	}
	&::-webkit-scrollbar-thumb:hover {
		background: var(--scrollbar-thumb-hover-bg);
	}
`

const SubItem = styled.div`
	display: flex;
	align-items: flex-start;
	gap: 8px;
	padding: 8px 11px 8px 22px;
	border-bottom: var(--popup-sub-separator);
	cursor: pointer;
	transition: background 0.12s;

	&:last-child {
		border-bottom: none;
	}

	&:hover {
		background: var(--popup-sub-hover);
	}
`

const SubItemIcon = styled.div`
	width: 12px;
	height: 12px;
	display: flex;
	align-items: center;
	justify-content: center;
	flex-shrink: 0;
	margin-top: 2px;
	opacity: 0.4;
	color: var(--popup-icon-stroke);
	font-size: 11px;
`

const SubItemInfo = styled.div`
	flex: 1;
	min-width: 0;
`

const SubItemName = styled.div`
	color: var(--popup-text-primary);
	font-size: var(--popup-font-size, var(--vscode-font-size, 11px));
	line-height: 1.4;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
`

const SubItemMeta = styled.div`
	color: var(--popup-text-meta);
	font-size: 8.5px;
	margin-top: 1px;
`

const SubItemAdd = styled.i`
	color: var(--popup-text-meta);
	font-size: 12px;
	flex-shrink: 0;
	opacity: 0.7;
	transition: opacity 0.12s;

	&:hover {
		opacity: 1;
		color: var(--popup-text-primary);
	}
`

// ─── Types ────────────────────────────────────────────────────────────────────
interface GitCommitEntry {
	hash: string
	shortHash: string
	subject: string
	author: string
	date: string
}

interface FolderEntry {
	path: string
	label: string
}

interface AddContextModalProps {
	isOpen: boolean
	onClose: () => void
	onInsertMention: (value: string) => void
	anchorRef: React.RefObject<HTMLElement | null>
}

// ─── Main Component ────────────────────────────────────────────────────────────
type AccordionKey = "git" | "folder" | null

const AddContextModal: React.FC<AddContextModalProps> = ({ isOpen, onClose, onInsertMention }) => {
	const popupRef = useRef<HTMLDivElement>(null)
	const [openAccordion, setOpenAccordion] = useState<AccordionKey>("git") // git open by default
	const [gitCommits, setGitCommits] = useState<GitCommitEntry[]>([])
	const [folders, setFolders] = useState<FolderEntry[]>([])

	// Close on outside click
	useEffect(() => {
		if (!isOpen) return
		const handleClick = (e: MouseEvent) => {
			if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
				onClose()
			}
		}
		document.addEventListener("mousedown", handleClick)
		return () => document.removeEventListener("mousedown", handleClick)
	}, [isOpen, onClose])

	// Fetch git commits when opened
	useEffect(() => {
		if (!isOpen) return
		FileServiceClient.searchCommits(StringRequest.create({ value: "" }))
			.then((resp) => {
				if (resp.commits) {
					setGitCommits(
						resp.commits.map(
							(c: { hash: string; shortHash: string; subject: string; author: string; date: string }) => ({
								hash: c.hash,
								shortHash: c.shortHash,
								subject: c.subject,
								author: c.author,
								date: c.date,
							}),
						),
					)
				}
			})
			.catch((e) => console.error("Error fetching commits:", e))
	}, [isOpen])

	// Fetch folders when folder accordion opens
	useEffect(() => {
		if (openAccordion !== "folder") return
		FileServiceClient.searchFiles(
			FileSearchRequest.create({ query: "", mentionsRequestId: "", selectedType: FileSearchType.FOLDER }),
		)
			.then((resp) => {
				if (resp.results) {
					setFolders(
						(resp.results as { path: string; label?: string; workspaceName?: string }[]).map((r) => ({
							path: r.path,
							label: r.label || r.path,
						})),
					)
				}
			})
			.catch((e) => console.error("Error fetching folders:", e))
	}, [openAccordion])

	const toggleAccordion = useCallback((key: AccordionKey) => {
		setOpenAccordion((prev) => (prev === key ? null : key))
	}, [])

	const insert = useCallback(
		(value: string) => {
			onInsertMention(value)
			onClose()
		},
		[onInsertMention, onClose],
	)

	if (!isOpen) return null

	return (
		<PopupWrapper ref={popupRef}>
			{/* URL */}
			<Row onClick={() => insert("url")}>
				<RowIcon>
					<i aria-hidden="true" className="codicon codicon-link" />
				</RowIcon>
				<RowLabel>Paste URL to fetch contents</RowLabel>
			</Row>

			{/* Problems */}
			<Row onClick={() => insert("problems")}>
				<RowIcon>
					<i aria-hidden="true" className="codicon codicon-warning" />
				</RowIcon>
				<RowLabel>Problems</RowLabel>
				<RowAction aria-hidden="true" className="codicon codicon-add" />
			</Row>

			{/* Terminal */}
			<Row onClick={() => insert("terminal")}>
				<RowIcon>
					<i aria-hidden="true" className="codicon codicon-terminal" />
				</RowIcon>
				<RowLabel>Terminal</RowLabel>
				<RowAction aria-hidden="true" className="codicon codicon-add" />
			</Row>

			{/* Git Commits */}
			<Row $active={openAccordion === "git"} onClick={() => toggleAccordion("git")}>
				<RowIcon>
					<i aria-hidden="true" className="codicon codicon-git-commit" />
				</RowIcon>
				<RowLabel>Git Commits</RowLabel>
				<ChevronIcon $open={openAccordion === "git"} aria-hidden="true" className="codicon codicon-chevron-right" />
			</Row>
			<AccordionContent $open={openAccordion === "git"}>
				<SubScroll>
					{/* Working changes */}
					<SubItem onClick={() => insert("git:HEAD")}>
						<SubItemIcon>
							<i aria-hidden="true" className="codicon codicon-circle-small-filled" />
						</SubItemIcon>
						<SubItemInfo>
							<SubItemName>Working changes</SubItemName>
							<SubItemMeta>Current uncommitted changes</SubItemMeta>
						</SubItemInfo>
						<SubItemAdd aria-hidden="true" className="codicon codicon-add" />
					</SubItem>
					{gitCommits.map((c) => (
						<SubItem key={c.hash} onClick={() => insert(c.hash)}>
							<SubItemIcon>
								<i aria-hidden="true" className="codicon codicon-circle-small-filled" />
							</SubItemIcon>
							<SubItemInfo>
								<SubItemName>{c.subject}</SubItemName>
								<SubItemMeta>
									{c.shortHash} · {c.author} · {c.date}
								</SubItemMeta>
							</SubItemInfo>
							<SubItemAdd aria-hidden="true" className="codicon codicon-add" />
						</SubItem>
					))}
				</SubScroll>
			</AccordionContent>

			{/* Add Folder */}
			<Row $active={openAccordion === "folder"} onClick={() => toggleAccordion("folder")}>
				<RowIcon>
					<i aria-hidden="true" className="codicon codicon-folder" />
				</RowIcon>
				<RowLabel>Add Folder</RowLabel>
				<ChevronIcon $open={openAccordion === "folder"} aria-hidden="true" className="codicon codicon-chevron-right" />
			</Row>
			<AccordionContent $open={openAccordion === "folder"}>
				<SubScroll>
					{folders.map((f) => (
						<SubItem key={f.path} onClick={() => insert(f.path)}>
							<SubItemIcon>
								<i aria-hidden="true" className="codicon codicon-folder" />
							</SubItemIcon>
							<SubItemInfo>
								<SubItemName>{f.label} /</SubItemName>
							</SubItemInfo>
							<SubItemAdd aria-hidden="true" className="codicon codicon-add" />
						</SubItem>
					))}
				</SubScroll>
			</AccordionContent>

			{/* Add File */}
			<Row onClick={() => insert("file")}>
				<RowIcon>
					<i aria-hidden="true" className="codicon codicon-file" />
				</RowIcon>
				<RowLabel>Add File</RowLabel>
				<ChevronIcon $open={false} aria-hidden="true" className="codicon codicon-chevron-right" />
			</Row>
		</PopupWrapper>
	)
}

export default AddContextModal
