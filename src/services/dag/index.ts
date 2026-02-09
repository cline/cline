/**
 * DAG (Dependency Analysis Graph) Service
 *
 * Provides dependency graph analysis for the Beadsmith extension,
 * enabling the agent to understand code dependencies before making changes.
 */

export {
	createDagBridge,
	DagBridge,
	type DagBridgeEvents,
	type DagBridgeOptions,
	type PythonValidationResult,
	validatePythonSetup,
} from "./DagBridge"
export {
	createDagFileWatcher,
	DagFileWatcher,
	type DagFileWatcherEvents,
	type DagFileWatcherOptions,
} from "./DagFileWatcher"
export type {
	AnalyseProjectRequest,
	AnalysisWarning,
	DagServiceConfig,
	DagServiceStatus,
	DagUpdateEvent,
	EdgeConfidence,
	EdgeType,
	GetImpactRequest,
	GraphEdge,
	GraphNode,
	GraphSummary,
	ImpactReport,
	JsonRpcRequest,
	JsonRpcResponse,
	NodeType,
	ProjectGraph,
} from "./types"
