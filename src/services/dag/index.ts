/**
 * DAG (Dependency Analysis Graph) Service
 *
 * Provides dependency graph analysis for the Beadsmith extension,
 * enabling the agent to understand code dependencies before making changes.
 */

export {
	createDagBridge,
	DagBridge,
	validatePythonSetup,
	type DagBridgeEvents,
	type DagBridgeOptions,
	type PythonValidationResult,
} from "./DagBridge"
export {
	DagFileWatcher,
	createDagFileWatcher,
	type DagFileWatcherEvents,
	type DagFileWatcherOptions,
} from "./DagFileWatcher"
export type {
	EdgeConfidence,
	NodeType,
	EdgeType,
	GraphNode,
	GraphEdge,
	AnalysisWarning,
	GraphSummary,
	ProjectGraph,
	ImpactReport,
	DagServiceStatus,
	DagServiceConfig,
	DagUpdateEvent,
	JsonRpcRequest,
	JsonRpcResponse,
	AnalyseProjectRequest,
	GetImpactRequest,
} from "./types"
