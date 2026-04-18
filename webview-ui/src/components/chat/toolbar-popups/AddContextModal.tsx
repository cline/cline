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
	background: var(--popup-bg, #1c1c1c);
	border: var(--popup-border, 0.5px solid #333);
	border-radius: var(--popup-radius, 10px);
	overflow: hidden;
	z-index: 200;
	animation: ${popupAppear} var(--popup-appear-duration, 0.18s) ease forwards;
	box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
`

const Row = styled.div<{ $active?: boolean }>`
	display: flex;
	align-items: center;
	gap: 9px;
	padding: var(--popup-item-padding, 7px 11px);
	cursor: pointer;
	border-bottom: var(--popup-item-separator, 0.5px solid #222);
	transition: background 0.12s;
	background: ${(p) => (p.$active ? "var(--popup-item-hover-bg, #242424)" : "transparent")};

	&:last-child {
		border-bottom: none;
	}

	&:hover {
		background: var(--popup-item-hover-bg, #242424);
	}
`

const RowIcon = styled.div`
	width: 14px;
	height: 14px;
	display: flex;
	align-items: center;
	justify-content: center;
	flex-shrink: 0;
	opacity: 0.55;
	color: var(--popup-icon-stroke, #aaa);
`

const RowLabel = styled.span`
	color: var(--popup-text-primary, #ccc);
	font-size: var(--popup-font-size, 10.5px);
	flex: 1;
`

const RowAction = styled.span`
	color: var(--popup-text-meta, #444);
	font-size: 14px;
	font-weight: 300;
`

const ChevronIcon = styled.svg<{ $open: boolean }>`
	width: 12px;
	height: 12px;
	flex-shrink: 0;
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
	background: #161616;

	&::-webkit-scrollbar {
		width: var(--scrollbar-width, 4px);
	}
	&::-webkit-scrollbar-track {
		background: var(--scrollbar-track-bg, #1a1a1a);
	}
	&::-webkit-scrollbar-thumb {
		background: var(--scrollbar-thumb-bg, #3a3a3a);
		border-radius: var(--scrollbar-radius, 2px);
	}
	&::-webkit-scrollbar-thumb:hover {
		background: var(--scrollbar-thumb-hover-bg, #4a4a4a);
	}
`

const SubItem = styled.div`
	display: flex;
	align-items: flex-start;
	gap: 8px;
	padding: 8px 11px 8px 22px;
	border-bottom: 0.5px solid #1e1e1e;
	cursor: pointer;
	transition: background 0.12s;

	&:last-child {
		border-bottom: none;
	}

	&:hover {
		background: #1e1e1e;
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
	color: var(--popup-icon-stroke, #aaa);
`

const SubItemInfo = styled.div`
	flex: 1;
	min-width: 0;
`

const SubItemName = styled.div`
	color: var(--popup-text-primary, #bbb);
	font-size: var(--popup-font-size, 10.5px);
	line-height: 1.4;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
`

const SubItemMeta = styled.div`
	color: var(--popup-text-meta, #444);
	font-size: 8.5px;
	margin-top: 1px;
`

const SubItemAdd = styled.span`
	color: var(--popup-text-meta, #444);
	font-size: 14px;
	font-weight: 300;
	flex-shrink: 0;
	transition: color 0.12s;

	&:hover {
		color: #aaa;
	}
`

// ─── SVG Icons ────────────────────────────────────────────────────────────────
const UrlIcon = () => (
	<svg fill="none" height="13" viewBox="0 0 14 14" width="13">
		<circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.2" />
		<path d="M7 5v2l1.5 1.5" stroke="currentColor" strokeLinecap="round" strokeWidth="1" />
	</svg>
)

const ProblemsIcon = () => (
	<svg fill="none" height="13" viewBox="0 0 14 14" width="13">
		<path d="M2 11L5 3l2 5 2-3 2 6" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.2" />
	</svg>
)

const TerminalIcon = () => (
	<svg fill="none" height="13" viewBox="0 0 14 14" width="13">
		<rect height="8" rx="1.5" stroke="currentColor" strokeWidth="1.2" width="10" x="2" y="3" />
		<path d="M4.5 6.5l2 2-2 2" stroke="currentColor" strokeLinecap="round" strokeWidth="1" />
	</svg>
)

const GitIcon = () => (
	<svg fill="none" height="13" viewBox="0 0 14 14" width="13">
		<circle cx="4" cy="10" r="1.5" stroke="currentColor" strokeWidth="1.1" />
		<circle cx="10" cy="10" r="1.5" stroke="currentColor" strokeWidth="1.1" />
		<circle cx="7" cy="4" r="1.5" stroke="currentColor" strokeWidth="1.1" />
		<path d="M4 8.5V6l3-2 3 2v2.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.1" />
	</svg>
)

const CommitDotIcon = () => (
	<svg fill="none" height="11" viewBox="0 0 12 12" width="11">
		<circle cx="6" cy="6" r="2" stroke="currentColor" strokeWidth="1.1" />
		<path d="M6 1v3M6 8v3" stroke="currentColor" strokeLinecap="round" strokeWidth="1" />
	</svg>
)

const FolderIcon = () => (
	<svg fill="none" height="13" viewBox="0 0 14 14" width="13">
		<path d="M2 4h3l1 1.5h6v6H2z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.2" />
	</svg>
)

const SmallFolderIcon = () => (
	<svg fill="none" height="11" viewBox="0 0 12 12" width="11">
		<path d="M2 3h2.5l1 1.5h4.5v5H2z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.1" />
	</svg>
)

const FileIcon = () => (
	<svg fill="none" height="13" viewBox="0 0 14 14" width="13">
		<rect height="11" rx="1.5" stroke="currentColor" strokeWidth="1.2" width="10" x="2" y="1.5" />
		<path d="M4.5 5h5M4.5 7.5h3.5" stroke="currentColor" strokeLinecap="round" strokeWidth="1" />
	</svg>
)

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
					<UrlIcon />
				</RowIcon>
				<RowLabel>Paste URL to fetch contents</RowLabel>
			</Row>

			{/* Problems */}
			<Row onClick={() => insert("problems")}>
				<RowIcon>
					<ProblemsIcon />
				</RowIcon>
				<RowLabel>Problems</RowLabel>
				<RowAction>+</RowAction>
			</Row>

			{/* Terminal */}
			<Row onClick={() => insert("terminal")}>
				<RowIcon>
					<TerminalIcon />
				</RowIcon>
				<RowLabel>Terminal</RowLabel>
				<RowAction>+</RowAction>
			</Row>

			{/* Git Commits */}
			<Row $active={openAccordion === "git"} onClick={() => toggleAccordion("git")}>
				<RowIcon>
					<GitIcon />
				</RowIcon>
				<RowLabel>Git Commits</RowLabel>
				<ChevronIcon $open={openAccordion === "git"} fill="none" viewBox="0 0 12 12">
					<path d="M4.5 2.5l4 4-4 4" stroke="#444" strokeLinecap="round" strokeWidth="1.3" />
				</ChevronIcon>
			</Row>
			<AccordionContent $open={openAccordion === "git"}>
				<SubScroll>
					{/* Working changes */}
					<SubItem onClick={() => insert("git:HEAD")}>
						<SubItemIcon>
							<CommitDotIcon />
						</SubItemIcon>
						<SubItemInfo>
							<SubItemName>Working changes</SubItemName>
							<SubItemMeta>Current uncommitted changes</SubItemMeta>
						</SubItemInfo>
						<SubItemAdd>+</SubItemAdd>
					</SubItem>
					{gitCommits.map((c) => (
						<SubItem key={c.hash} onClick={() => insert(c.hash)}>
							<SubItemIcon>
								<CommitDotIcon />
							</SubItemIcon>
							<SubItemInfo>
								<SubItemName>{c.subject}</SubItemName>
								<SubItemMeta>
									{c.shortHash} · {c.author} · {c.date}
								</SubItemMeta>
							</SubItemInfo>
							<SubItemAdd>+</SubItemAdd>
						</SubItem>
					))}
				</SubScroll>
			</AccordionContent>

			{/* Add Folder */}
			<Row $active={openAccordion === "folder"} onClick={() => toggleAccordion("folder")}>
				<RowIcon>
					<FolderIcon />
				</RowIcon>
				<RowLabel>Add Folder</RowLabel>
				<ChevronIcon $open={openAccordion === "folder"} fill="none" viewBox="0 0 12 12">
					<path d="M4.5 2.5l4 4-4 4" stroke="#444" strokeLinecap="round" strokeWidth="1.3" />
				</ChevronIcon>
			</Row>
			<AccordionContent $open={openAccordion === "folder"}>
				<SubScroll>
					{folders.map((f) => (
						<SubItem key={f.path} onClick={() => insert(f.path)}>
							<SubItemIcon>
								<SmallFolderIcon />
							</SubItemIcon>
							<SubItemInfo>
								<SubItemName>{f.label} /</SubItemName>
							</SubItemInfo>
							<SubItemAdd>+</SubItemAdd>
						</SubItem>
					))}
				</SubScroll>
			</AccordionContent>

			{/* Add File */}
			<Row onClick={() => insert("file")}>
				<RowIcon>
					<FileIcon />
				</RowIcon>
				<RowLabel>Add File</RowLabel>
				<ChevronIcon $open={false} fill="none" viewBox="0 0 12 12">
					<path d="M4.5 2.5l4 4-4 4" stroke="#444" strokeLinecap="round" strokeWidth="1.3" />
				</ChevronIcon>
			</Row>
		</PopupWrapper>
	)
}

export default AddContextModal
