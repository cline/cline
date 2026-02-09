/**
 * ForceGraph - D3.js force-directed graph visualization for DAG.
 *
 * Displays nodes and edges with interactive zoom, pan, and click handlers.
 */

import {
	type GraphEdge,
	type GraphNode,
	edgeTypeToJSON,
	edgeConfidenceToJSON,
} from "@shared/proto/beadsmith/dag"
import * as d3 from "d3"
import { memo, useCallback, useEffect, useRef, useState } from "react"
import { cn } from "@/lib/utils"

interface ForceGraphProps {
	nodes: GraphNode[]
	edges: GraphEdge[]
	width?: number
	height?: number
	onNodeClick?: (node: GraphNode) => void
	selectedNodeId?: string
	/** IDs of nodes that are in the impact path of the selected node */
	impactNodeIds?: Set<string>
	className?: string
}

// Node type colors
const NODE_COLORS: Record<number, string> = {
	1: "#3b82f6", // FILE - blue
	2: "#f59e0b", // CLASS - amber
	3: "#10b981", // FUNCTION - emerald
	4: "#8b5cf6", // METHOD - violet
}

// Edge type colors
const EDGE_COLORS: Record<string, string> = {
	import: "#6366f1", // indigo
	call: "#22c55e", // green
	inherit: "#f97316", // orange
}

// Confidence to opacity mapping
const CONFIDENCE_OPACITY: Record<string, number> = {
	high: 1.0,
	medium: 0.7,
	low: 0.4,
	unsafe: 0.2,
}

interface D3Node extends d3.SimulationNodeDatum {
	id: string
	name: string
	type: number
	filePath: string
	lineNumber: number
}

interface D3Edge extends d3.SimulationLinkDatum<D3Node> {
	source: string | D3Node
	target: string | D3Node
	edgeType: string
	confidence: string
	label?: string
}

export const ForceGraph = memo<ForceGraphProps>(
	({ nodes, edges, width = 800, height = 600, onNodeClick, selectedNodeId, impactNodeIds, className }) => {
		const svgRef = useRef<SVGSVGElement>(null)
		const [tooltip, setTooltip] = useState<{ x: number; y: number; content: string } | null>(null)

		// Convert to D3 format
		const d3Nodes: D3Node[] = nodes.map((n) => ({
			id: n.id,
			name: n.name,
			type: n.type,
			filePath: n.filePath,
			lineNumber: n.lineNumber,
		}))

		const nodeIds = new Set(d3Nodes.map((n) => n.id))

		const d3Edges: D3Edge[] = edges
			.filter((e) => nodeIds.has(e.fromNode) && nodeIds.has(e.toNode))
			.map((e) => ({
				source: e.fromNode,
				target: e.toNode,
				edgeType: edgeTypeToJSON(e.edgeType),
				confidence: edgeConfidenceToJSON(e.confidence),
				label: e.label,
			}))

		const handleNodeClick = useCallback(
			(node: D3Node) => {
				if (onNodeClick) {
					const original = nodes.find((n) => n.id === node.id)
					if (original) {
						onNodeClick(original)
					}
				}
			},
			[nodes, onNodeClick],
		)

		useEffect(() => {
			if (!svgRef.current || d3Nodes.length === 0) return

			const svg = d3.select(svgRef.current)
			svg.selectAll("*").remove()

			// Create container for zoom
			const container = svg.append("g")

			// Add zoom behavior
			const zoom = d3
				.zoom<SVGSVGElement, unknown>()
				.scaleExtent([0.1, 4])
				.on("zoom", (event) => {
					container.attr("transform", event.transform)
				})

			svg.call(zoom)

			// Create arrow marker for edges
			svg.append("defs")
				.append("marker")
				.attr("id", "arrowhead")
				.attr("viewBox", "0 -5 10 10")
				.attr("refX", 20)
				.attr("refY", 0)
				.attr("markerWidth", 6)
				.attr("markerHeight", 6)
				.attr("orient", "auto")
				.append("path")
				.attr("d", "M0,-5L10,0L0,5")
				.attr("fill", "#666")

			// Create simulation
			const simulation = d3
				.forceSimulation<D3Node>(d3Nodes)
				.force(
					"link",
					d3
						.forceLink<D3Node, D3Edge>(d3Edges)
						.id((d) => d.id)
						.distance(100),
				)
				.force("charge", d3.forceManyBody().strength(-300))
				.force("center", d3.forceCenter(width / 2, height / 2))
				.force("collision", d3.forceCollide().radius(30))

			// Helper to check if an edge is in the impact path
			const isImpactEdge = (d: D3Edge): boolean => {
				if (!impactNodeIds || impactNodeIds.size === 0) {
					return false
				}
				const sourceId = typeof d.source === "string" ? d.source : d.source.id
				const targetId = typeof d.target === "string" ? d.target : d.target.id
				return (
					(impactNodeIds.has(sourceId) || sourceId === selectedNodeId) &&
					(impactNodeIds.has(targetId) || targetId === selectedNodeId)
				)
			}

			// Draw edges - highlight impact path edges
			const link = container
				.append("g")
				.attr("class", "links")
				.selectAll("line")
				.data(d3Edges)
				.enter()
				.append("line")
				.attr("stroke", (d) => {
					if (isImpactEdge(d)) {
						return "#f97316" // Orange for impact path edges
					}
					return EDGE_COLORS[d.edgeType] || "#999"
				})
				.attr("stroke-opacity", (d) => {
					if (impactNodeIds && impactNodeIds.size > 0) {
						return isImpactEdge(d) ? 1 : 0.15 // Dim non-impact edges
					}
					return CONFIDENCE_OPACITY[d.confidence] || 0.5
				})
				.attr("stroke-width", (d) => (isImpactEdge(d) ? 2.5 : 1.5))
				.attr("marker-end", "url(#arrowhead)")

			// Draw nodes
			const node = container
				.append("g")
				.attr("class", "nodes")
				.selectAll("g")
				.data(d3Nodes)
				.enter()
				.append("g")
				.attr("cursor", "pointer")
				.call(
					d3
						.drag<SVGGElement, D3Node>()
						.on("start", (event, d) => {
							if (!event.active) simulation.alphaTarget(0.3).restart()
							d.fx = d.x
							d.fy = d.y
						})
						.on("drag", (event, d) => {
							d.fx = event.x
							d.fy = event.y
						})
						.on("end", (event, d) => {
							if (!event.active) simulation.alphaTarget(0)
							d.fx = null
							d.fy = null
						}),
				)

			// Node circles - highlight impact path nodes
			node.append("circle")
				.attr("r", (d) => (d.type === 1 ? 12 : 8)) // Files are larger
				.attr("fill", (d) => {
					if (d.id === selectedNodeId) return "#ef4444" // Selected node in red
					if (impactNodeIds?.has(d.id)) return "#f97316" // Impact path nodes in orange
					return NODE_COLORS[d.type] || "#6b7280"
				})
				.attr("stroke", (d) => {
					if (d.id === selectedNodeId) return "#fff"
					if (impactNodeIds?.has(d.id)) return "#fbbf24" // Gold stroke for impact nodes
					return "none"
				})
				.attr("stroke-width", (d) => (d.id === selectedNodeId || impactNodeIds?.has(d.id) ? 2 : 0))
				.attr("opacity", (d) => {
					// Dim non-impact nodes when impact path is shown
					if (impactNodeIds && impactNodeIds.size > 0 && !impactNodeIds.has(d.id) && d.id !== selectedNodeId) {
						return 0.3
					}
					return 1
				})

			// Node labels
			node.append("text")
				.text((d) => d.name)
				.attr("x", 12)
				.attr("y", 4)
				.attr("font-size", "10px")
				.attr("fill", "var(--vscode-foreground)")

			// Event handlers
			node.on("click", (event, d) => {
				event.stopPropagation()
				handleNodeClick(d)
			})

			node.on("mouseenter", (event, d) => {
				const nodeType = ["Unknown", "File", "Class", "Function", "Method"][d.type] || "Unknown"
				setTooltip({
					x: event.pageX,
					y: event.pageY,
					content: `${nodeType}: ${d.name}\n${d.filePath}:${d.lineNumber}`,
				})
			})

			node.on("mouseleave", () => {
				setTooltip(null)
			})

			// Update positions on tick
			simulation.on("tick", () => {
				link.attr("x1", (d) => (d.source as D3Node).x || 0)
					.attr("y1", (d) => (d.source as D3Node).y || 0)
					.attr("x2", (d) => (d.target as D3Node).x || 0)
					.attr("y2", (d) => (d.target as D3Node).y || 0)

				node.attr("transform", (d) => `translate(${d.x || 0},${d.y || 0})`)
			})

			// Cleanup
			return () => {
				simulation.stop()
			}
		}, [d3Nodes, d3Edges, width, height, selectedNodeId, handleNodeClick])

		return (
			<div className={cn("relative", className)}>
				<svg ref={svgRef} width={width} height={height} className="bg-background border border-foreground/10 rounded">
					{/* D3 will populate this */}
				</svg>

				{/* Tooltip */}
				{tooltip && (
					<div
						className="absolute z-50 px-2 py-1 text-xs bg-popover text-popover-foreground rounded shadow-lg whitespace-pre-line"
						style={{
							left: tooltip.x + 10,
							top: tooltip.y + 10,
						}}>
						{tooltip.content}
					</div>
				)}

				{/* Legend */}
				<div className="absolute bottom-2 left-2 text-xs bg-background/80 p-2 rounded border border-foreground/10">
					<div className="font-medium mb-1">Node Types</div>
					<div className="flex flex-wrap gap-2">
						<span className="flex items-center gap-1">
							<span className="w-2 h-2 rounded-full" style={{ backgroundColor: NODE_COLORS[1] }} />
							File
						</span>
						<span className="flex items-center gap-1">
							<span className="w-2 h-2 rounded-full" style={{ backgroundColor: NODE_COLORS[2] }} />
							Class
						</span>
						<span className="flex items-center gap-1">
							<span className="w-2 h-2 rounded-full" style={{ backgroundColor: NODE_COLORS[3] }} />
							Function
						</span>
						<span className="flex items-center gap-1">
							<span className="w-2 h-2 rounded-full" style={{ backgroundColor: NODE_COLORS[4] }} />
							Method
						</span>
					</div>
				</div>
			</div>
		)
	},
)

ForceGraph.displayName = "ForceGraph"

export default ForceGraph
