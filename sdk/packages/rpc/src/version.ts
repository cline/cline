import { version } from "../package.json";

// Bump only when the wire contract becomes incompatible.
export const RPC_PROTOCOL_VERSION = "1";

// Package/build version remains useful for diagnostics, but it is not a
// transport compatibility signal.
export const RPC_BUILD_VERSION = version;
