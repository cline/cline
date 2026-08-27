export {
	createWorkspaceCapsuleArchiveStream,
	writeWorkspaceCapsuleArchive,
} from "./archive";
export {
	type BuildWorkspaceCapsulePlanOptions,
	buildWorkspaceCapsulePlan,
	DEFAULT_WORKSPACE_CAPSULE_LIMITS,
	type WorkspaceCapsuleApprovedRoot,
	type WorkspaceCapsuleLimits,
	type WorkspaceCapsulePayloadPlanEntry,
	type WorkspaceCapsulePlan,
	type WorkspaceCapsuleSkippedPath,
	WorkspaceCapsulePlanningError,
	type WorkspaceCapsulePlanningErrorCode,
	type WorkspaceCapsuleSelection,
} from "./builder";
