/**
 * Type definitions for the DAG (Directed Acyclic Graph) analysis engine.
 *
 * The DAG engine analyses code dependencies to help the agent understand
 * the architectural implications of changes before making them.
 */

/**
 * Confidence level for dependency edges.
 * Indicates how certain we are about the dependency relationship.
 */
export type EdgeConfidence = "high" | "medium" | "low" | "unsafe"

/**
 * Type of node in the dependency graph.
 */
export type NodeType = "file" | "class" | "function" | "method" | "variable"

/**
 * Type of relationship between nodes.
 */
export type EdgeType = "import" | "call" | "inherit" | "reference"

/**
 * A node in the dependency graph representing a code symbol.
 */
export interface GraphNode {
	/** Unique identifier (format: file_path:symbol_name) */
	id: string
	/** Type of the node */
	type: NodeType
	/** Absolute file path */
	filePath: string
	/** Line number where the symbol is defined */
	lineNumber: number
	/** Name of the symbol */
	name: string
	/** Docstring or JSDoc comment if available */
	docstring?: string
	/** Parameter names and types for functions/methods */
	parameters?: string[]
	/** Return type annotation if available */
	returnType?: string
	/** Column number (optional, for precise navigation) */
	columnNumber?: number
	/** End line number (for multi-line definitions) */
	endLineNumber?: number
}

/**
 * An edge in the dependency graph representing a relationship between symbols.
 */
export interface GraphEdge {
	/** ID of the source node (the one that depends on/uses the target) */
	fromNode: string
	/** ID of the target node (the one being depended on/used) */
	toNode: string
	/** Type of the relationship */
	edgeType: EdgeType
	/** Confidence level of this edge */
	confidence: EdgeConfidence
	/** Line number where the reference occurs */
	lineNumber: number
	/** Human-readable description of the relationship */
	label: string
	/** Additional context (e.g., import alias, call arguments) */
	context?: string
}

/**
 * Warning generated during analysis.
 */
export interface AnalysisWarning {
	/** Category of warning */
	type: "dynamic_import" | "late_binding" | "circular_dependency" | "reflection" | "parse_error" | "unknown"
	/** File where the warning occurred */
	file: string
	/** Line number */
	line: number
	/** Description of the issue */
	description: string
	/** Severity level */
	severity: "low" | "medium" | "high"
}

/**
 * Summary statistics for the graph.
 */
export interface GraphSummary {
	/** Total number of files analysed */
	files: number
	/** Total number of functions/methods */
	functions: number
	/** Total number of classes */
	classes: number
	/** Total number of edges */
	edges: number
	/** Count of high-confidence edges */
	highConfidenceEdges: number
	/** Count of medium-confidence edges */
	mediumConfidenceEdges: number
	/** Count of low-confidence edges */
	lowConfidenceEdges: number
	/** Count of unsafe (dynamic) edges */
	unsafeEdges: number
	/** Analysis duration in milliseconds */
	analysisTimeMs?: number
}

/**
 * Complete project dependency graph.
 */
export interface ProjectGraph {
	/** Schema version */
	version: string
	/** Root path of the analysed project */
	projectRoot: string
	/** ISO timestamp of when analysis was performed */
	analysisTimestamp: string
	/** All nodes in the graph */
	nodes: GraphNode[]
	/** All edges in the graph */
	edges: GraphEdge[]
	/** Warnings generated during analysis */
	warnings: AnalysisWarning[]
	/** Summary statistics */
	summary: GraphSummary
}

/**
 * Report of change impact analysis.
 */
export interface ImpactReport {
	/** File that was changed */
	changedFile: string
	/** Optional: specific function that was changed */
	changedFunction?: string
	/** Files that may be affected by the change */
	affectedFiles: string[]
	/** Functions that may be affected */
	affectedFunctions: string[]
	/** Suggested test files to run */
	suggestedTests: string[]
	/** Breakdown of edge confidence levels in the impact path */
	confidenceBreakdown: Record<EdgeConfidence, number>
	/** Total depth of impact (how many levels of callers) */
	impactDepth: number
	/** Whether any circular dependencies were encountered */
	hasCircularDependencies: boolean
}

/**
 * Status of the DAG analysis service.
 */
export interface DagServiceStatus {
	/** Whether the service is running */
	running: boolean
	/** Version of the DAG engine */
	version: string
	/** Whether a graph is currently cached */
	hasCache: boolean
	/** Timestamp of the last analysis */
	lastAnalysis?: string
	/** Number of files in the current graph */
	fileCount?: number
	/** Any error message if the service is unhealthy */
	error?: string
}

/**
 * Request to analyse a project.
 */
export interface AnalyseProjectRequest {
	/** Root path of the project to analyse */
	root: string
	/** Optional: specific files to include (if not provided, analyse all) */
	includeFiles?: string[]
	/** Optional: patterns to exclude */
	excludePatterns?: string[]
	/** Whether to use cached results if available */
	useCache?: boolean
}

/**
 * Request to get impact analysis.
 */
export interface GetImpactRequest {
	/** File path to analyse impact for */
	file: string
	/** Optional: specific function name */
	function?: string
	/** Maximum depth to traverse (default: unlimited) */
	maxDepth?: number
	/** Minimum confidence level to include */
	minConfidence?: EdgeConfidence
}

/**
 * JSON-RPC request format for DAG engine communication.
 */
export interface JsonRpcRequest {
	jsonrpc: "2.0"
	id: number
	method: string
	params: Record<string, unknown>
}

/**
 * JSON-RPC response format from DAG engine.
 */
export interface JsonRpcResponse<T = unknown> {
	jsonrpc: "2.0"
	id: number
	result?: T
	error?: {
		code: number
		message: string
		data?: unknown
	}
}

/**
 * Event emitted when the DAG is updated.
 */
export interface DagUpdateEvent {
	/** Type of update */
	type: "full_analysis" | "incremental" | "invalidation"
	/** Files affected by the update */
	affectedFiles: string[]
	/** New summary statistics */
	summary: GraphSummary
}

/**
 * Configuration for the DAG service.
 */
export interface DagServiceConfig {
	/** Path to Python executable */
	pythonPath: string
	/** Whether DAG analysis is enabled */
	enabled: boolean
	/** Whether to auto-refresh on file changes */
	autoRefresh: boolean
	/** Debounce delay for auto-refresh (ms) */
	autoRefreshDelayMs: number
	/** Maximum file count before disabling auto-analysis */
	maxFilesForAutoAnalysis: number
}
