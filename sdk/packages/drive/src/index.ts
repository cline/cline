export {
	DEFAULT_DRIVE_MODE,
	IllegalDriveModeTransitionError,
	transitionDriveMode,
	type DriveModeAction,
	type DriveModeState,
} from "./driveMode";
export {
	assertFakeHostFailClosed,
	fakeHost,
	FakeHostCapabilityError,
	runHostConformance,
	type ConformanceIssue,
	type ConformanceReport,
} from "./conformance/fakeHost";
export {
	CLINE_HOST_CAPABILITIES,
	CLINE_HUB_WRITER_ENDPOINT,
	type DriveHostPort,
	type HostCapabilities,
	type PromptRewriteDecision,
	type RoomOp,
} from "./hostPort";
export {
	classifyInterrupt,
	decideReviseOrRestart,
	type InterruptAction,
	type InterruptClassification,
	type InterruptInput,
	type InterruptIntent,
	type ReviseDecision,
} from "./interruptPolicy";
export {
	narrate,
	type NarrationCandidate,
	type NarrationDensity,
} from "./narrationPolicy";
export {
	createEmptyRoomSnapshot,
	projectRoster,
	projectStage,
	reduceRoom,
} from "./reduceRoom";
export {
	DEFAULT_AGENT_APPEARANCE,
	DEFAULT_BODY_INK,
	DEFAULT_NAME_INK,
	DRIVE_FACET_CATALOG,
	listFacetDefs,
	type DriveFacetCatalog,
	type DriveFacetKey,
	type DriveFacetValue,
} from "./facets/catalog";
export {
	createFacetStore,
	type FacetStore,
	type FacetStoreSnapshot,
} from "./facets/store";
