import {
	createMediaBudgetState,
	validateAndReserveImageMedia,
} from "@cline/shared";
import type { CloudSessionController } from "../../cloud/controller";
import {
	applyHandoffGit,
	type HandoffGitPublication,
	verifyPublishedHandoffGit,
} from "./git-preparation";

type CloudCreateInput = Parameters<CloudSessionController["create"]>[0];
export type PublishedHandoffInput = Omit<
	CloudCreateInput,
	"handoff" | "requestId" | "organizationId" | "initialMessage"
> & {
	localGit: HandoffGitPublication;
	requestId: string;
	organizationId: string | null;
	initialMessage: NonNullable<CloudCreateInput["initialMessage"]>;
};

/** Publishes a confirmed snapshot; callers own account fencing and single-flight admission. */
export async function publishCloudHandoff({
	controller,
	input,
	assertCurrent,
}: {
	controller: Pick<
		CloudSessionController,
		"prepareHandoffRepository" | "listModels" | "create"
	>;
	input: PublishedHandoffInput;
	assertCurrent: () => void;
}): ReturnType<CloudSessionController["create"]> {
	assertCurrent();
	const { localGit, ...creation } = input;
	if (
		creation.repoUrl !== localGit.repoUrl ||
		creation.branch !== localGit.branch ||
		(creation.workspaceRelativePath ?? "") !== localGit.workspaceRelativePath
	)
		throw new Error("Cloud workspace must match the approved Git preparation");
	const budget = createMediaBudgetState();
	for (const image of creation.initialMessage.images ?? []) {
		const validation = validateAndReserveImageMedia(
			undefined,
			image,
			{},
			budget,
		);
		if (!validation.ok) throw new Error(validation.message);
	}
	const { organizationId } = await controller.prepareHandoffRepository(
		localGit.repoUrl,
	);
	assertCurrent();
	if ((organizationId ?? null) !== creation.organizationId)
		throw new Error("The cloud organization changed before publication");
	const models = await controller.listModels();
	assertCurrent();
	if (!models.some((model) => model.id === creation.modelId))
		throw new Error(
			"The selected model is not available in Cline Cloud for this account",
		);
	const headSha = await applyHandoffGit(localGit);
	assertCurrent();
	await verifyPublishedHandoffGit(localGit, headSha);
	assertCurrent();
	return controller.create({
		...creation,
		sandboxType: creation.sandboxType ?? "resumable",
	});
}
