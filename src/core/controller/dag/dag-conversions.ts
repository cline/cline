/**
 * Conversion utilities for DAG types between DagBridge (TypeScript) and Proto messages.
 */

import {
	EdgeConfidence,
	EdgeType,
	GraphEdge,
	GraphNode,
	GraphSummary,
	ImpactReport,
	NodeType,
	ProjectGraph,
	WarningSeverity,
	WarningType,
} from "@shared/proto/beadsmith/dag"
import type {
	AnalysisWarning as DagAnalysisWarning,
	EdgeConfidence as DagEdgeConfidence,
	EdgeType as DagEdgeType,
	GraphEdge as DagGraphEdge,
	GraphNode as DagGraphNode,
	GraphSummary as DagGraphSummary,
	ImpactReport as DagImpactReport,
	NodeType as DagNodeType,
	ProjectGraph as DagProjectGraph,
} from "@services/dag/types"

/**
 * Convert DagBridge NodeType to proto NodeType
 */
export function convertNodeType(type: DagNodeType): NodeType {
	switch (type) {
		case "file":
			return NodeType.NODE_TYPE_FILE
		case "class":
			return NodeType.NODE_TYPE_CLASS
		case "function":
			return NodeType.NODE_TYPE_FUNCTION
		case "method":
			return NodeType.NODE_TYPE_METHOD
		case "variable":
			return NodeType.NODE_TYPE_VARIABLE
		default:
			return NodeType.NODE_TYPE_UNSPECIFIED
	}
}

/**
 * Convert proto NodeType to DagBridge NodeType string (for Python server queries)
 */
export function convertProtoNodeType(type: NodeType): DagNodeType | undefined {
	switch (type) {
		case NodeType.NODE_TYPE_FILE:
			return "file"
		case NodeType.NODE_TYPE_CLASS:
			return "class"
		case NodeType.NODE_TYPE_FUNCTION:
			return "function"
		case NodeType.NODE_TYPE_METHOD:
			return "method"
		case NodeType.NODE_TYPE_VARIABLE:
			return "variable"
		default:
			return undefined
	}
}

/**
 * Convert DagBridge EdgeType to proto EdgeType
 */
export function convertEdgeType(type: DagEdgeType): EdgeType {
	switch (type) {
		case "import":
			return EdgeType.EDGE_TYPE_IMPORT
		case "call":
			return EdgeType.EDGE_TYPE_CALL
		case "inherit":
			return EdgeType.EDGE_TYPE_INHERIT
		case "reference":
			return EdgeType.EDGE_TYPE_REFERENCE
		default:
			return EdgeType.EDGE_TYPE_UNSPECIFIED
	}
}

/**
 * Convert DagBridge EdgeConfidence to proto EdgeConfidence
 */
export function convertEdgeConfidence(confidence: DagEdgeConfidence): EdgeConfidence {
	switch (confidence) {
		case "high":
			return EdgeConfidence.EDGE_CONFIDENCE_HIGH
		case "medium":
			return EdgeConfidence.EDGE_CONFIDENCE_MEDIUM
		case "low":
			return EdgeConfidence.EDGE_CONFIDENCE_LOW
		case "unsafe":
			return EdgeConfidence.EDGE_CONFIDENCE_UNSAFE
		default:
			return EdgeConfidence.EDGE_CONFIDENCE_UNSPECIFIED
	}
}

/**
 * Convert proto EdgeConfidence to DagBridge EdgeConfidence string
 */
export function convertProtoEdgeConfidence(confidence: EdgeConfidence): DagEdgeConfidence {
	switch (confidence) {
		case EdgeConfidence.EDGE_CONFIDENCE_HIGH:
			return "high"
		case EdgeConfidence.EDGE_CONFIDENCE_MEDIUM:
			return "medium"
		case EdgeConfidence.EDGE_CONFIDENCE_LOW:
			return "low"
		case EdgeConfidence.EDGE_CONFIDENCE_UNSAFE:
			return "unsafe"
		default:
			return "medium"
	}
}

/**
 * Convert DagBridge warning type to proto WarningType
 */
export function convertWarningType(type: string): WarningType {
	switch (type) {
		case "dynamic_import":
			return WarningType.WARNING_TYPE_DYNAMIC_IMPORT
		case "late_binding":
			return WarningType.WARNING_TYPE_LATE_BINDING
		case "circular_dependency":
			return WarningType.WARNING_TYPE_CIRCULAR_DEPENDENCY
		case "reflection":
			return WarningType.WARNING_TYPE_REFLECTION
		case "parse_error":
			return WarningType.WARNING_TYPE_PARSE_ERROR
		default:
			return WarningType.WARNING_TYPE_UNSPECIFIED
	}
}

/**
 * Convert DagBridge warning severity to proto WarningSeverity
 */
export function convertWarningSeverity(severity: string): WarningSeverity {
	switch (severity) {
		case "high":
			return WarningSeverity.WARNING_SEVERITY_HIGH
		case "medium":
			return WarningSeverity.WARNING_SEVERITY_MEDIUM
		case "low":
			return WarningSeverity.WARNING_SEVERITY_LOW
		default:
			return WarningSeverity.WARNING_SEVERITY_UNSPECIFIED
	}
}

/**
 * Convert DagBridge GraphNode to proto GraphNode
 */
export function convertNode(node: DagGraphNode): GraphNode {
	return GraphNode.create({
		id: node.id,
		type: convertNodeType(node.type),
		filePath: node.filePath,
		lineNumber: node.lineNumber,
		name: node.name,
		docstring: node.docstring,
		parameters: node.parameters || [],
		returnType: node.returnType,
		columnNumber: node.columnNumber,
		endLineNumber: node.endLineNumber,
	})
}

/**
 * Convert DagBridge GraphEdge to proto GraphEdge
 */
export function convertEdge(edge: DagGraphEdge): GraphEdge {
	return GraphEdge.create({
		fromNode: edge.fromNode,
		toNode: edge.toNode,
		edgeType: convertEdgeType(edge.edgeType),
		confidence: convertEdgeConfidence(edge.confidence),
		lineNumber: edge.lineNumber,
		label: edge.label,
		context: edge.context,
	})
}

/**
 * Convert DagBridge GraphSummary to proto GraphSummary
 */
export function convertSummary(summary: DagGraphSummary): GraphSummary {
	return GraphSummary.create({
		files: summary.files,
		functions: summary.functions,
		classes: summary.classes,
		edges: summary.edges,
		highConfidenceEdges: summary.highConfidenceEdges,
		mediumConfidenceEdges: summary.mediumConfidenceEdges,
		lowConfidenceEdges: summary.lowConfidenceEdges,
		unsafeEdges: summary.unsafeEdges,
		analysisTimeMs: summary.analysisTimeMs,
	})
}

/**
 * Convert DagBridge ProjectGraph to proto ProjectGraph
 */
export function convertProjectGraph(graph: DagProjectGraph): ProjectGraph {
	return ProjectGraph.create({
		version: graph.version,
		projectRoot: graph.projectRoot,
		analysisTimestamp: graph.analysisTimestamp,
		nodes: graph.nodes.map(convertNode),
		edges: graph.edges.map(convertEdge),
		warnings: graph.warnings.map((w: DagAnalysisWarning) => ({
			type: convertWarningType(w.type),
			file: w.file,
			line: w.line,
			description: w.description,
			severity: convertWarningSeverity(w.severity),
		})),
		summary: graph.summary ? convertSummary(graph.summary) : undefined,
	})
}

/**
 * Convert DagBridge ImpactReport to proto ImpactReport
 */
export function convertImpactReport(report: DagImpactReport): ImpactReport {
	// Convert confidence breakdown from Record<string, number> to Record<number, number>
	const confidenceBreakdown: Record<number, number> = {}
	if (report.confidenceBreakdown) {
		for (const [key, value] of Object.entries(report.confidenceBreakdown)) {
			const protoConfidence = convertEdgeConfidence(key as DagEdgeConfidence)
			confidenceBreakdown[protoConfidence] = value
		}
	}

	return ImpactReport.create({
		changedFile: report.changedFile,
		changedFunction: report.changedFunction,
		affectedFiles: report.affectedFiles,
		affectedFunctions: report.affectedFunctions,
		suggestedTests: report.suggestedTests,
		confidenceBreakdown,
		impactDepth: report.impactDepth,
		hasCircularDependencies: report.hasCircularDependencies,
	})
}

/**
 * Create an empty ProjectGraph for error cases
 */
export function createEmptyProjectGraph(projectRoot: string): ProjectGraph {
	return ProjectGraph.create({
		version: "1.0.0",
		projectRoot,
		analysisTimestamp: new Date().toISOString(),
		nodes: [],
		edges: [],
		warnings: [],
		summary: {
			files: 0,
			functions: 0,
			classes: 0,
			edges: 0,
			highConfidenceEdges: 0,
			mediumConfidenceEdges: 0,
			lowConfidenceEdges: 0,
			unsafeEdges: 0,
		},
	})
}
