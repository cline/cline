/**
 * DagPanel - Main panel for DAG visualization and impact analysis.
 *
 * Provides:
 * - Graph view with expandable nodes
 * - Impact analysis for selected files
 * - Service status and controls
 */

import { EmptyRequest } from "@shared/proto/beadsmith/common"
import {
	AnalyseProjectRequest,
	type DagServiceStatus,
	type GraphNode,
	type GraphSummary,
	type ProjectGraph,
} from "@shared/proto/beadsmith/dag"
import {
	AlertCircleIcon,
	ArrowLeftIcon,
	CheckCircleIcon,
	ChevronDownIcon,
	ChevronRightIcon,
	FileIcon,
	FolderIcon,
	FunctionSquareIcon,
	GitBranchIcon,
	LayoutGridIcon,
	ListIcon,
	Loader2Icon,
	NetworkIcon,
	RefreshCwIcon,
	XCircleIcon,
} from "lucide-react"
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { cn } from "@/lib/utils"
import { DagServiceClient } from "@/services/grpc-client"
import { ForceGraph } from "./ForceGraph"

type ViewMode = "list" | "graph"

interface DagPanelProps {
	className?: string
	onDone?: () => void
}

// Node type icons
const getNodeIcon = (type: number) => {
	switch (type) {
		case 1: // FILE
			return <FileIcon className="size-4 text-link" />
		case 2: // CLASS
			return <FolderIcon className="size-4 text-warning" />
		case 3: // FUNCTION
		case 4: // METHOD
			return <FunctionSquareIcon className="size-4 text-success" />
		default:
			return <NetworkIcon className="size-4 text-foreground/50" />
	}
}

// Group nodes by file
const groupNodesByFile = (nodes: GraphNode[]): Map<string, GraphNode[]> => {
	const grouped = new Map<string, GraphNode[]>()
	for (const node of nodes) {
		const existing = grouped.get(node.filePath) || []
		existing.push(node)
		grouped.set(node.filePath, existing)
	}
	return grouped
}

// Status indicator component
const StatusIndicator = memo<{ status: DagServiceStatus | null; isLoading: boolean }>(({ status, isLoading }) => {
	if (isLoading) {
		return (
			<div className="flex items-center gap-2 text-xs text-foreground/70">
				<Loader2Icon className="size-3 animate-spin" />
				<span>Analysing...</span>
			</div>
		)
	}

	if (!status) {
		return (
			<div className="flex items-center gap-2 text-xs text-foreground/50">
				<XCircleIcon className="size-3" />
				<span>Not connected</span>
			</div>
		)
	}

	if (status.error) {
		return (
			<div className="flex items-center gap-2 text-xs text-error">
				<AlertCircleIcon className="size-3" />
				<span>{status.error}</span>
			</div>
		)
	}

	if (status.running && status.hasCache) {
		return (
			<div className="flex items-center gap-2 text-xs text-success">
				<CheckCircleIcon className="size-3" />
				<span>{status.fileCount || 0} files indexed</span>
			</div>
		)
	}

	return (
		<div className="flex items-center gap-2 text-xs text-foreground/70">
			<AlertCircleIcon className="size-3" />
			<span>No graph available</span>
		</div>
	)
})

StatusIndicator.displayName = "StatusIndicator"

// Summary stats component
const SummaryStats = memo<{ summary: GraphSummary | undefined }>(({ summary }) => {
	if (!summary) return null

	return (
		<div className="grid grid-cols-4 gap-2 text-xs p-2 bg-foreground/5 rounded-sm">
			<div className="text-center">
				<div className="font-bold text-lg">{summary.files}</div>
				<div className="text-foreground/60">Files</div>
			</div>
			<div className="text-center">
				<div className="font-bold text-lg">{summary.functions}</div>
				<div className="text-foreground/60">Functions</div>
			</div>
			<div className="text-center">
				<div className="font-bold text-lg">{summary.classes}</div>
				<div className="text-foreground/60">Classes</div>
			</div>
			<div className="text-center">
				<div className="font-bold text-lg">{summary.edges}</div>
				<div className="text-foreground/60">Edges</div>
			</div>
		</div>
	)
})

SummaryStats.displayName = "SummaryStats"

// File node with expandable children
const FileNode = memo<{
	filePath: string
	nodes: GraphNode[]
	onNodeClick: (node: GraphNode) => void
}>(({ filePath, nodes, onNodeClick }) => {
	const [isExpanded, setIsExpanded] = useState(false)
	const fileName = filePath.split("/").pop() || filePath

	return (
		<div className="border-b border-foreground/10 last:border-b-0">
			<button
				className="w-full flex items-center gap-2 py-1.5 px-2 hover:bg-foreground/5 transition-colors"
				onClick={() => setIsExpanded(!isExpanded)}
				type="button">
				{isExpanded ? <ChevronDownIcon className="size-3" /> : <ChevronRightIcon className="size-3" />}
				<FileIcon className="size-3 text-link" />
				<span className="text-sm truncate flex-1 text-left">{fileName}</span>
				<span className="text-xs text-foreground/50">{nodes.length}</span>
			</button>

			{isExpanded && (
				<div className="ml-4 border-l border-foreground/10">
					{nodes.map((node) => (
						<button
							className="w-full flex items-center gap-2 py-1 px-2 hover:bg-foreground/5 transition-colors"
							key={node.id}
							onClick={() => onNodeClick(node)}
							type="button">
							{getNodeIcon(node.type)}
							<span className="text-xs truncate flex-1 text-left">{node.name}</span>
							<span className="text-[10px] text-foreground/40">:{node.lineNumber}</span>
						</button>
					))}
				</div>
			)}
		</div>
	)
})

FileNode.displayName = "FileNode"

export const DagPanel = memo<DagPanelProps>(({ className, onDone }) => {
	const { dagEnabled } = useExtensionState()
	const [status, setStatus] = useState<DagServiceStatus | null>(null)
	const [graph, setGraph] = useState<ProjectGraph | null>(null)
	const [isLoading, setIsLoading] = useState(false)
	const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null)
	const [error, setError] = useState<string | null>(null)
	const [viewMode, setViewMode] = useState<ViewMode>("list")
	const containerRef = useRef<HTMLDivElement>(null)
	const [graphDimensions, setGraphDimensions] = useState({ width: 800, height: 400 })

	// Track container dimensions for graph
	useEffect(() => {
		if (!containerRef.current) return

		const resizeObserver = new ResizeObserver((entries) => {
			for (const entry of entries) {
				setGraphDimensions({
					width: entry.contentRect.width,
					height: Math.max(400, entry.contentRect.height - 100),
				})
			}
		})

		resizeObserver.observe(containerRef.current)
		return () => resizeObserver.disconnect()
	}, [])

	// Fetch status on mount
	useEffect(() => {
		if (!dagEnabled) return

		const fetchStatus = async () => {
			try {
				const result = await DagServiceClient.getStatus(EmptyRequest.create({}))
				setStatus(result)
			} catch (err) {
				console.error("[DagPanel] Failed to get status:", err)
			}
		}

		fetchStatus()
	}, [dagEnabled])

	// Fetch graph
	const fetchGraph = useCallback(async () => {
		setIsLoading(true)
		setError(null)
		try {
			const result = await DagServiceClient.getProjectGraph(EmptyRequest.create({}))
			setGraph(result)
		} catch (err) {
			console.error("[DagPanel] Failed to get graph:", err)
			setError("Failed to load graph")
		} finally {
			setIsLoading(false)
		}
	}, [])

	// Analyse project
	const handleAnalyse = useCallback(async () => {
		setIsLoading(true)
		setError(null)
		try {
			const result = await DagServiceClient.analyseProject(
				AnalyseProjectRequest.create({
					root: "",
					useCache: false,
				}),
			)
			setGraph(result)
			// Refresh status
			const newStatus = await DagServiceClient.getStatus(EmptyRequest.create({}))
			setStatus(newStatus)
		} catch (err) {
			console.error("[DagPanel] Failed to analyse:", err)
			setError("Analysis failed")
		} finally {
			setIsLoading(false)
		}
	}, [])

	// Handle node click - could show details or impact
	const handleNodeClick = useCallback((node: GraphNode) => {
		setSelectedNode(node)
	}, [])

	// Compute impact path nodes for the selected node
	// This finds all nodes that depend on the selected node (callers/dependents)
	const impactNodeIds = useMemo(() => {
		if (!selectedNode || !graph) {
			return new Set<string>()
		}

		const impactSet = new Set<string>()
		const visited = new Set<string>()
		const queue: string[] = [selectedNode.id]

		// BFS to find all nodes that depend on the selected node (callers)
		while (queue.length > 0) {
			const currentId = queue.shift()!
			if (visited.has(currentId)) {
				continue
			}
			visited.add(currentId)

			// Find all edges where currentId is the target (i.e., something calls/depends on it)
			for (const edge of graph.edges) {
				if (edge.toNode === currentId && !visited.has(edge.fromNode)) {
					impactSet.add(edge.fromNode)
					queue.push(edge.fromNode)
				}
			}
		}

		return impactSet
	}, [selectedNode, graph])

	// Group nodes by file
	const groupedNodes = graph ? groupNodesByFile(graph.nodes) : new Map()

	if (!dagEnabled) {
		return (
			<div className={cn("p-4 text-center text-foreground/60", className)}>
				<NetworkIcon className="size-8 mx-auto mb-2 opacity-50" />
				<p className="text-sm">DAG analysis is disabled</p>
				<p className="text-xs mt-1">Enable it in settings to see dependency graphs</p>
			</div>
		)
	}

	return (
		<div className={cn("flex flex-col h-full", className)}>
			{/* Header */}
			<div className="flex items-center justify-between p-2 border-b border-foreground/10">
				<div className="flex items-center gap-2">
					{onDone && (
						<button
							className="p-1 hover:bg-foreground/10 rounded-sm transition-colors"
							onClick={onDone}
							title="Back"
							type="button">
							<ArrowLeftIcon className="size-4" />
						</button>
					)}
					<GitBranchIcon className="size-4" />
					<span className="font-medium text-sm">Dependency Graph</span>
				</div>
				<div className="flex items-center gap-2">
					<StatusIndicator isLoading={isLoading} status={status} />
					{/* View mode toggle */}
					<div className="flex border border-foreground/20 rounded-sm overflow-hidden">
						<button
							className={cn(
								"p-1 transition-colors",
								viewMode === "list" ? "bg-foreground/10" : "hover:bg-foreground/5",
							)}
							onClick={() => setViewMode("list")}
							title="List view"
							type="button">
							<ListIcon className="size-4" />
						</button>
						<button
							className={cn(
								"p-1 transition-colors",
								viewMode === "graph" ? "bg-foreground/10" : "hover:bg-foreground/5",
							)}
							onClick={() => setViewMode("graph")}
							title="Graph view"
							type="button">
							<LayoutGridIcon className="size-4" />
						</button>
					</div>
					<button
						className="p-1 hover:bg-foreground/10 rounded-sm transition-colors disabled:opacity-50"
						disabled={isLoading}
						onClick={handleAnalyse}
						title="Refresh analysis"
						type="button">
						<RefreshCwIcon className={cn("size-4", isLoading && "animate-spin")} />
					</button>
				</div>
			</div>

			{/* Error display */}
			{error && (
				<div className="p-2 bg-error/10 text-error text-xs flex items-center gap-2">
					<AlertCircleIcon className="size-3" />
					{error}
				</div>
			)}

			{/* Summary stats */}
			{graph?.summary && <SummaryStats summary={graph.summary} />}

			{/* Content area */}
			<div ref={containerRef} className="flex-1 overflow-y-auto">
				{graph && groupedNodes.size > 0 ? (
					viewMode === "graph" ? (
						<ForceGraph
							edges={graph.edges}
							height={graphDimensions.height}
							impactNodeIds={impactNodeIds}
							nodes={graph.nodes}
							onNodeClick={handleNodeClick}
							width={graphDimensions.width}
							selectedNodeId={selectedNode?.id}
						/>
					) : (
						<div>
							{Array.from(groupedNodes.entries()).map(([filePath, nodes]) => (
								<FileNode filePath={filePath} key={filePath} nodes={nodes} onNodeClick={handleNodeClick} />
							))}
						</div>
					)
				) : !isLoading ? (
					<div className="p-4 text-center text-foreground/50 text-sm">
						<NetworkIcon className="size-6 mx-auto mb-2 opacity-30" />
						<p>No graph available</p>
						<button
							className="mt-2 px-3 py-1 bg-link/20 text-link rounded-sm text-xs hover:bg-link/30 transition-colors"
							onClick={handleAnalyse}
							type="button">
							Analyse Project
						</button>
					</div>
				) : null}
			</div>

			{/* Selected node details */}
			{selectedNode && (
				<div className="border-t border-foreground/10 p-2 bg-foreground/5">
					<div className="flex items-center justify-between mb-1">
						<div className="flex items-center gap-2">
							{getNodeIcon(selectedNode.type)}
							<span className="font-medium text-sm">{selectedNode.name}</span>
						</div>
						<button
							className="p-0.5 hover:bg-foreground/10 rounded-sm"
							onClick={() => setSelectedNode(null)}
							type="button">
							<XCircleIcon className="size-3" />
						</button>
					</div>
					<div className="text-xs text-foreground/60 space-y-0.5">
						<div>
							File: <span className="text-foreground/80">{selectedNode.filePath}</span>
						</div>
						<div>
							Line: <span className="text-foreground/80">{selectedNode.lineNumber}</span>
						</div>
						{selectedNode.parameters && selectedNode.parameters.length > 0 && (
							<div>
								Params: <span className="text-foreground/80">{selectedNode.parameters.join(", ")}</span>
							</div>
						)}
						{selectedNode.returnType && (
							<div>
								Returns: <span className="text-foreground/80">{selectedNode.returnType}</span>
							</div>
						)}
					</div>
				</div>
			)}
		</div>
	)
})

DagPanel.displayName = "DagPanel"

export default DagPanel
