/**
 * Turns the saved-endpoints list into rows a person can tell apart.
 *
 * Two hubs saved from the same machine both arrive labelled "Local dev hub" and
 * differ only in port. Rendering the raw label twice made tapping the right one a
 * coin flip — and connecting to the wrong (dead) hub failed silently. So the
 * label is disambiguated here, deterministically, before it ever reaches a row.
 *
 * Presentation only: the stored {@link ConnectionDescriptor} is never rewritten,
 * so the user's own label survives and a later rename still wins.
 */

import { type ConnectionDescriptor, descriptorKey } from "@/connection";

export interface EndpointDisplay {
	endpoint: ConnectionDescriptor;
	/** {@link descriptorKey} — stable list key and the handle for removal. */
	key: string;
	/** Unambiguous primary line. Disambiguated when labels collide. */
	label: string;
	/** Secondary line: the url, always shown, never the only distinguisher. */
	url: string;
	/** True when this row's label needed a suffix to stay distinct. */
	disambiguated: boolean;
}

/**
 * The authority part of a `ws://host:port/path` url, without userinfo.
 *
 * Hand-parsed rather than `new URL()`: the saved url is user-typed and may not be
 * a valid absolute url at all, and a throw here would blank the whole list.
 */
export function endpointAuthority(url: string): string | undefined {
	const match = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)/i.exec(url.trim());
	const authority = match?.[1];
	if (!authority) {
		return undefined;
	}
	const afterUserInfo = authority.slice(authority.lastIndexOf("@") + 1);
	return afterUserInfo || undefined;
}

/** The `:port` of a hub url, when it carries one. */
export function endpointPort(url: string): string | undefined {
	const authority = endpointAuthority(url);
	if (!authority || authority.endsWith("]")) {
		// A bare IPv6 literal (`[::1]`) has no port.
		return undefined;
	}
	const colon = authority.lastIndexOf(":");
	if (colon === -1) {
		return undefined;
	}
	const port = authority.slice(colon + 1);
	return /^\d+$/.test(port) ? port : undefined;
}

/** Label to use before any collision handling: the user's, else the host:port. */
function baseLabel(endpoint: ConnectionDescriptor): string {
	const explicit = endpoint.label?.trim();
	return explicit || endpointAuthority(endpoint.url) || endpoint.url;
}

/**
 * Describes every endpoint with a label that is unique within the list.
 *
 * Collisions get the port appended (`Local dev hub (:4599)`); when even that
 * repeats — two urls differing only by path — the full url is appended instead.
 * Order is preserved and the result depends only on the input, so the same list
 * always renders the same way.
 */
export function describeEndpoints(
	endpoints: ConnectionDescriptor[],
): EndpointDisplay[] {
	const counts = new Map<string, number>();
	for (const endpoint of endpoints) {
		const base = baseLabel(endpoint);
		counts.set(base, (counts.get(base) ?? 0) + 1);
	}

	const rows = endpoints.map((endpoint) => {
		const base = baseLabel(endpoint);
		if ((counts.get(base) ?? 0) < 2) {
			return { endpoint, base, label: base, disambiguated: false };
		}
		const port = endpointPort(endpoint.url);
		return {
			endpoint,
			base,
			label: port ? `${base} (:${port})` : `${base} (${endpoint.url})`,
			disambiguated: true,
		};
	});

	// Same label *and* same port (paths differ): fall back to the whole url, which
	// is unique because `descriptorKey` is mode+url.
	const labelCounts = new Map<string, number>();
	for (const row of rows) {
		labelCounts.set(row.label, (labelCounts.get(row.label) ?? 0) + 1);
	}

	return rows.map((row) => {
		const collides = (labelCounts.get(row.label) ?? 0) > 1;
		return {
			endpoint: row.endpoint,
			key: descriptorKey(row.endpoint),
			label: collides ? `${row.base} (${row.endpoint.url})` : row.label,
			url: row.endpoint.url,
			disambiguated: row.disambiguated || collides,
		};
	});
}
