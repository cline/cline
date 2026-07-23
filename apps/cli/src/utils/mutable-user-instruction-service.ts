import type { UserInstructionConfigService } from "@cline/core";

export interface MutableUserInstructionConfigService
	extends UserInstructionConfigService {
	assertCompatible(next: UserInstructionConfigService): void;
	replace(next: UserInstructionConfigService): UserInstructionConfigService;
}

export function createMutableUserInstructionConfigService(
	initial: UserInstructionConfigService,
): MutableUserInstructionConfigService {
	let current = initial;
	const hasSkillsExecutor = typeof initial.createSkillsExecutor === "function";
	const assertCompatible = (next: UserInstructionConfigService): void => {
		if (
			(typeof next.createSkillsExecutor === "function") !==
			hasSkillsExecutor
		) {
			throw new Error(
				"Replacement instruction service has incompatible skills capability",
			);
		}
	};
	const service: UserInstructionConfigService = {
		start: () => current.start(),
		stop: () => current.stop(),
		refreshType: (type) => current.refreshType(type),
		listRecords: (type) => current.listRecords(type),
		listRuntimeCommands: () => current.listRuntimeCommands(),
		resolveRuntimeSlashCommand: (input) =>
			current.resolveRuntimeSlashCommand(input),
		hasConfiguredSkills: (allowedSkillNames) =>
			current.hasConfiguredSkills(allowedSkillNames),
		createExtension: (options) => current.createExtension(options),
	};
	if (hasSkillsExecutor) {
		service.createSkillsExecutor = (allowedSkillNames) => {
			if (!current.createSkillsExecutor) {
				throw new Error(
					"Replacement instruction service has no skills executor",
				);
			}
			return current.createSkillsExecutor(allowedSkillNames);
		};
	}
	return {
		...service,
		assertCompatible,
		replace: (next) => {
			assertCompatible(next);
			const previous = current;
			current = next;
			return previous;
		},
	};
}
