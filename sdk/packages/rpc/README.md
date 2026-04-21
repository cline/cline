# @clinebot/rpc

Package-level docs are centralized:

- Overview: [`packages/README.md`](../README.md)
- Architecture and interactions: [`ARCHITECTURE.md`](./ARCHITECTURE.md)

`@clinebot/rpc` provides transport/control-plane APIs for sessions, tasks, events, spawn queues, tool approvals, and schedules.
It also exposes runtime session execution RPCs:

- `StartRuntimeSession(request_json)` - create/start a server-side runtime session
- `StartRuntimeSession` returns `session_id` and optional serialized session start metadata (`start_result_json`)
- `SendRuntimeSession(session_id, request_json)` - execute a prompt turn on that runtime session
- `AbortRuntimeSession(session_id)` - request cancellation for an active runtime session turn
- `PublishEvent(...)` / `StreamEvents(...)` - publish and subscribe to routed events
- `RunProviderAction(request_json)` - provider catalog/model/settings actions and typed Cline account actions (`action: "clineAccount"`)
- `RunProviderOAuthLogin(provider)` - provider OAuth login action
- Schedule RPCs: `CreateSchedule`, `ListSchedules`, `UpdateSchedule`, `TriggerScheduleNow`, `ListScheduleExecutions`, `GetScheduleStats`, `GetUpcomingScheduledRuns`, and related pause/resume/delete/get APIs

Runtime payload DTOs consumed by multiple hosts are defined in `@clinebot/shared`
(`packages/shared/src/rpc/runtime.ts`), while transport/service wiring remains in `@clinebot/rpc`.
Team progress DTOs/events are also shared from `@clinebot/shared`:

- `runtime.team.progress.v1` - typed team status-board projection snapshots
- `runtime.team.lifecycle.v1` - typed lifecycle deltas (task/run/outcome related)
- `RpcSessionClient.streamTeamProgress(...)` - typed stream helper over `StreamEvents(...)`

It also exposes server lifecycle helpers:

- `getRpcServerHealth(address)` for health checks
- `requestRpcServerShutdown(address)` for remote graceful shutdown
- `registerRpcClient(address, input)` for client registration (`clientId`, `clientType`, optional metadata)
- Each successful `registerRpcClient` call emits a routed server event: `eventType: "rpc.client.activated"` with client identity/metadata and activation counters, even when no runtime session is started.
- `RpcSessionClient.publishEvent(...)` / `RpcSessionClient.streamEvents(...)` for client-side event routing
- `RpcSessionClient.requestToolApproval(...)` / `respondToolApproval(...)` / `listPendingApprovals(...)` for approval request/decision flows
- On graceful shutdown, the server broadcasts `eventType: "rpc.server.shutting_down"` to current stream subscribers before transport teardown.

## RPC Server Module Layout

`startRpcServer(...)` has been split into focused modules under `packages/rpc/src/server/`:

- `server-start.ts` - server bootstrap, gRPC method wiring, singleton lifecycle (`start/get/stop`).
- `runtime.ts` - `ClineGatewayRuntime` coordinator for session/task/runtime flows.
- `runtime-events.ts` - event publish/dispatch + stream subscriber management.
- `runtime-approvals.ts` - tool approval request/decision/pending-list workflows.
- `runtime-schedules.ts` - schedule CRUD/trigger/stats/execution APIs.
- `grpc-service.ts` - proto discovery/loading + service/address constants.
- `client-helpers.ts` - outbound helpers (`getRpcServerHealth`, `requestRpcServerShutdown`, `registerRpcClient`).
- `helpers.ts` - shared normalization/parsing + proto message mapping helpers.
- `proto-types.ts` - generated proto request/response type aliases used by server internals.

Public package exports stay stable through `packages/rpc/src/server.ts`.

## Runtime Chat Client Helpers

`@clinebot/rpc` also exports reusable runtime chat client helpers used by app bridge scripts:

- `RpcRuntimeChatClient` (`packages/rpc/src/runtime-chat-client.ts`)
- `runRpcRuntimeEventBridge(...)` (`packages/rpc/src/runtime-chat-stream-bridge.ts`)
- `runRpcRuntimeCommandBridge(...)` (`packages/rpc/src/runtime-chat-command-bridge.ts`)

These allow host clients (for example code/code apps) to share one implementation for:

- runtime chat start/send/abort calls
- session-subscription control loop for streamed chat events
- request/response envelope handling for persistent stdio runtime bridges
- bounded send-call behavior: `runRpcRuntimeCommandBridge(...)` now enforces a default 120s timeout for `send` commands so one stuck turn cannot block subsequent bridge requests (override with `CLINE_RPC_RUNTIME_SEND_TIMEOUT_MS`)

## Session Backend Injection

`@clinebot/rpc` is transport-only for session persistence. It does not own a database-backed session store.

- `startRpcServer(...)` now requires a `sessionBackend` implementation via `RpcServerOptions`.
- Session persistence contracts live in `RpcSessionBackend` / `RpcSessionRow` / `RpcSessionUpdateInput`.
- `@clinebot/core` provides a ready-to-use SQLite backend (`createSqliteRpcSessionBackend`).
- Scheduled execution orchestration is provided via `@clinebot/scheduler` and is hosted inside the same RPC server process.
- Runtime shutdown can now include host cleanup via optional `RpcRuntimeHandlers.dispose()`, which `startRpcServer(...)/stopRpcServer()` invokes during server stop.

## Build note

`@clinebot/rpc` is consumed by Node-based tools (for example `@clinebot/cli` auth commands) from compiled `dist` exports.
Run `bun -F @clinebot/rpc build` (or root `bun run build`) before invoking those commands from source checkouts.
