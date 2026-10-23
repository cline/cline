/**
 * Node entry point: relay server + host client + the RN-safe client surface.
 *
 * React Native and browsers resolve `@cline/hub-relay` to `./client` instead
 * (see the `exports` map), which excludes everything that touches `node:*`/`ws`.
 */

export * from "./client/index";
export * from "./host/index";
export * from "./server/index";
