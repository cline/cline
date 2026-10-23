/**
 * `catalog.list` — the read half of model selection.
 *
 * Model selection over Hub v1 was writable but unreadable: `modelSelection` is
 * accepted on three inputs and `session.update_connection` can retarget a live
 * session, yet `catalog.list` sat in the command union with no handler and
 * `HubModelCatalog` had no references. A terminal running on the machine never
 * noticed, because it reads the provider settings straight from disk; the first
 * genuinely remote client (the phone) has no disk to read, so its picker had
 * nothing to offer. This handler serves the same provider registry the local
 * `/model` picker uses, via the host's optional `ModelCatalogRuntimeService`.
 */

import type { HubCommandEnvelope, HubReplyEnvelope } from "@cline/shared";
import { errorReply, type HubTransportContext, okReply } from "./context";

export async function handleCatalogList(
	ctx: HubTransportContext,
	envelope: HubCommandEnvelope,
): Promise<HubReplyEnvelope> {
	const listModelCatalog = ctx.sessionHost.listModelCatalog;
	if (!listModelCatalog) {
		return errorReply(
			envelope,
			"catalog_unavailable",
			"This hub's runtime host does not serve a model catalog.",
		);
	}
	const catalog = await listModelCatalog.call(ctx.sessionHost);
	return okReply(envelope, catalog as unknown as Record<string, unknown>);
}
