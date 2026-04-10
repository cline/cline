import { randomUUID } from "node:crypto";
import { SchedulerService } from "@clinebot/scheduler";
import { CLINE_DEFAULT_RPC_ADDRESS } from "@clinebot/shared";
import * as grpc from "@grpc/grpc-js";
import type { RpcServerHandle, RpcServerOptions } from "../types";

import { loadGatewayService, parseAddress } from "./grpc-service";
import { formatRpcCallbackError, nowIso } from "./helpers";
import type {
	AbortRuntimeSessionRequest,
	AbortRuntimeSessionResponse,
	ClaimSpawnRequestRequest,
	ClaimSpawnRequestResponse,
	CompleteTaskRequest,
	CreateScheduleRequest,
	CreateScheduleResponse,
	DeleteScheduleRequest,
	DeleteScheduleResponse,
	DeleteSessionRequest,
	DeleteSessionResponse,
	EnqueueSpawnRequestRequest,
	EnqueueSpawnRequestResponse,
	EnsureSessionRequest,
	EnsureSessionResponse,
	EnterpriseAuthenticateRequest,
	EnterpriseAuthenticateResponse,
	EnterpriseStatusRequest,
	EnterpriseStatusResponse,
	EnterpriseSyncRequest,
	EnterpriseSyncResponse,
	GetActiveScheduledExecutionsRequest,
	GetActiveScheduledExecutionsResponse,
	GetScheduleRequest,
	GetScheduleResponse,
	GetScheduleStatsRequest,
	GetScheduleStatsResponse,
	GetSessionRequest,
	GetSessionResponse,
	GetUpcomingScheduledRunsRequest,
	GetUpcomingScheduledRunsResponse,
	HealthRequest,
	HealthResponse,
	ListPendingApprovalsRequest,
	ListPendingApprovalsResponse,
	ListScheduleExecutionsRequest,
	ListScheduleExecutionsResponse,
	ListSchedulesRequest,
	ListSchedulesResponse,
	ListSessionsRequest,
	ListSessionsResponse,
	PauseScheduleRequest,
	PauseScheduleResponse,
	PublishEventRequest,
	PublishEventResponse,
	RegisterClientRequest,
	RegisterClientResponse,
	RequestToolApprovalRequest,
	RequestToolApprovalResponse,
	RespondToolApprovalRequest,
	RespondToolApprovalResponse,
	ResumeScheduleRequest,
	ResumeScheduleResponse,
	RoutedEventMessage,
	RunProviderActionRequest,
	RunProviderActionResponse,
	RunProviderOAuthLoginRequest,
	RunProviderOAuthLoginResponse,
	SendRuntimeSessionRequest,
	SendRuntimeSessionResponse,
	ShutdownRequest,
	ShutdownResponse,
	StartRuntimeSessionRequest,
	StartRuntimeSessionResponse,
	StartTaskRequest,
	StopRuntimeSessionRequest,
	StopRuntimeSessionResponse,
	StreamEventsRequest,
	TaskResponse,
	TriggerScheduleNowRequest,
	TriggerScheduleNowResponse,
	UpdateScheduleRequest,
	UpdateScheduleResponse,
	UpdateSessionRequest,
	UpdateSessionResponse,
	UpsertSessionRequest,
	UpsertSessionResponse,
} from "./proto-types";
import { ClineGatewayRuntime } from "./runtime";

let singletonHandle: RpcServerHandle | undefined;
let singletonStartPromise: Promise<RpcServerHandle> | undefined;

const DEFAULT_RPC_ADDRESS =
	process.env.CLINE_RPC_ADDRESS?.trim() || CLINE_DEFAULT_RPC_ADDRESS;

export async function startRpcServer(
	options: RpcServerOptions,
): Promise<RpcServerHandle> {
	if (singletonHandle) {
		return singletonHandle;
	}
	if (singletonStartPromise) {
		return singletonStartPromise;
	}

	singletonStartPromise = new Promise<RpcServerHandle>((resolve, reject) => {
		const address = options.address?.trim() || DEFAULT_RPC_ADDRESS;
		try {
			parseAddress(address);
		} catch (error) {
			singletonStartPromise = undefined;
			reject(error instanceof Error ? error : new Error(String(error)));
			return;
		}
		if (!options.sessionBackend) {
			singletonStartPromise = undefined;
			reject(new Error("startRpcServer requires options.sessionBackend"));
			return;
		}
		const schedulerEnabled = options.scheduler?.enabled !== false;
		let runtime: ClineGatewayRuntime;
		const scheduler =
			schedulerEnabled &&
			options.runtimeHandlers?.startSession &&
			options.runtimeHandlers?.sendSession &&
			options.runtimeHandlers?.abortSession &&
			options.runtimeHandlers?.stopSession
				? new SchedulerService({
						runtimeHandlers: {
							startSession: options.runtimeHandlers.startSession,
							sendSession: async (sessionId, request) => {
								const result = await options.runtimeHandlers?.sendSession?.(
									sessionId,
									request,
								);
								if (!result?.result) {
									throw new Error(
										"scheduler runtime send unexpectedly queued a turn",
									);
								}
								return { result: result.result };
							},
							abortSession: options.runtimeHandlers.abortSession,
							stopSession: options.runtimeHandlers.stopSession,
						},
						sessionsDbPath: options.scheduler?.sessionsDbPath,
						pollIntervalMs: options.scheduler?.pollIntervalMs,
						globalMaxConcurrency: options.scheduler?.globalMaxConcurrency,
						logger: options.scheduler?.logger,
						eventPublisher: (eventType, payload) => {
							runtime.broadcastServerEvent(eventType, payload);
						},
					})
				: undefined;

		runtime = new ClineGatewayRuntime(
			address,
			options.sessionBackend,
			options.runtimeHandlers,
			scheduler,
		);
		const server = new grpc.Server();
		let stopRequested = false;
		const stopBoundServer = async (): Promise<void> => {
			if (stopRequested) {
				return;
			}
			stopRequested = true;
			try {
				runtime.broadcastServerEvent("rpc.server.shutting_down", {
					serverId: runtime.health().serverId,
					address,
					reason: "shutdown_requested",
				});
			} catch {
				// Best-effort control event broadcast.
			}
			try {
				await options.runtimeHandlers?.dispose?.();
			} catch {
				// Best-effort runtime cleanup before server shutdown.
			}
			try {
				await scheduler?.stop();
			} catch {
				// Best-effort scheduler cleanup before server shutdown.
			}
			await new Promise<void>((resolveShutdown) => {
				server.tryShutdown(() => {
					resolveShutdown();
				});
			});
			singletonHandle = undefined;
			singletonStartPromise = undefined;
		};
		server.addService(loadGatewayService(), {
			Health: (
				call: grpc.ServerUnaryCall<HealthRequest, HealthResponse>,
				callback: grpc.sendUnaryData<HealthResponse>,
			) => {
				void call;
				callback(null, runtime.health());
			},
			Shutdown: (
				call: grpc.ServerUnaryCall<ShutdownRequest, ShutdownResponse>,
				callback: grpc.sendUnaryData<ShutdownResponse>,
			) => {
				void call;
				callback(null, { accepted: true });
				setImmediate(() => {
					void stopBoundServer();
				});
			},
			RegisterClient: (
				call: grpc.ServerUnaryCall<
					RegisterClientRequest,
					RegisterClientResponse
				>,
				callback: grpc.sendUnaryData<RegisterClientResponse>,
			) => {
				try {
					callback(null, runtime.registerClient(call.request));
				} catch (error) {
					callback(
						{
							code: grpc.status.INVALID_ARGUMENT,
							message: formatRpcCallbackError(error),
						},
						null,
					);
				}
			},
			EnsureSession: (
				call: grpc.ServerUnaryCall<EnsureSessionRequest, EnsureSessionResponse>,
				callback: grpc.sendUnaryData<EnsureSessionResponse>,
			) => {
				try {
					callback(null, runtime.ensureSession(call.request));
				} catch (error) {
					callback(
						{
							code: grpc.status.INVALID_ARGUMENT,
							message: formatRpcCallbackError(error),
						},
						null,
					);
				}
			},
			UpsertSession: (
				call: grpc.ServerUnaryCall<UpsertSessionRequest, UpsertSessionResponse>,
				callback: grpc.sendUnaryData<UpsertSessionResponse>,
			) => {
				try {
					callback(null, runtime.upsertSession(call.request));
				} catch (error) {
					callback(
						{
							code: grpc.status.INVALID_ARGUMENT,
							message: formatRpcCallbackError(error),
						},
						null,
					);
				}
			},
			GetSession: (
				call: grpc.ServerUnaryCall<GetSessionRequest, GetSessionResponse>,
				callback: grpc.sendUnaryData<GetSessionResponse>,
			) => {
				try {
					callback(null, runtime.getSession(call.request));
				} catch (error) {
					callback(
						{
							code: grpc.status.INVALID_ARGUMENT,
							message: formatRpcCallbackError(error),
						},
						null,
					);
				}
			},
			ListSessions: (
				call: grpc.ServerUnaryCall<ListSessionsRequest, ListSessionsResponse>,
				callback: grpc.sendUnaryData<ListSessionsResponse>,
			) => {
				try {
					callback(null, runtime.listSessions(call.request));
				} catch (error) {
					callback(
						{
							code: grpc.status.INVALID_ARGUMENT,
							message: formatRpcCallbackError(error),
						},
						null,
					);
				}
			},
			UpdateSession: (
				call: grpc.ServerUnaryCall<UpdateSessionRequest, UpdateSessionResponse>,
				callback: grpc.sendUnaryData<UpdateSessionResponse>,
			) => {
				try {
					callback(null, runtime.updateSession(call.request));
				} catch (error) {
					callback(
						{
							code: grpc.status.INVALID_ARGUMENT,
							message: formatRpcCallbackError(error),
						},
						null,
					);
				}
			},
			DeleteSession: (
				call: grpc.ServerUnaryCall<DeleteSessionRequest, DeleteSessionResponse>,
				callback: grpc.sendUnaryData<DeleteSessionResponse>,
			) => {
				try {
					callback(null, runtime.deleteSession(call.request));
				} catch (error) {
					callback(
						{
							code: grpc.status.INVALID_ARGUMENT,
							message: formatRpcCallbackError(error),
						},
						null,
					);
				}
			},
			EnqueueSpawnRequest: (
				call: grpc.ServerUnaryCall<
					EnqueueSpawnRequestRequest,
					EnqueueSpawnRequestResponse
				>,
				callback: grpc.sendUnaryData<EnqueueSpawnRequestResponse>,
			) => {
				try {
					callback(null, runtime.enqueueSpawnRequest(call.request));
				} catch (error) {
					callback(
						{
							code: grpc.status.INVALID_ARGUMENT,
							message: formatRpcCallbackError(error),
						},
						null,
					);
				}
			},
			ClaimSpawnRequest: (
				call: grpc.ServerUnaryCall<
					ClaimSpawnRequestRequest,
					ClaimSpawnRequestResponse
				>,
				callback: grpc.sendUnaryData<ClaimSpawnRequestResponse>,
			) => {
				try {
					callback(null, runtime.claimSpawnRequest(call.request));
				} catch (error) {
					callback(
						{
							code: grpc.status.INVALID_ARGUMENT,
							message: formatRpcCallbackError(error),
						},
						null,
					);
				}
			},
			StartRuntimeSession: (
				call: grpc.ServerUnaryCall<
					StartRuntimeSessionRequest,
					StartRuntimeSessionResponse
				>,
				callback: grpc.sendUnaryData<StartRuntimeSessionResponse>,
			) => {
				void runtime
					.startRuntimeSession(call.request)
					.then((result) => {
						callback(null, result);
					})
					.catch((error) => {
						callback(
							{
								code: grpc.status.INVALID_ARGUMENT,
								message: formatRpcCallbackError(error),
							},
							null,
						);
					});
			},
			SendRuntimeSession: (
				call: grpc.ServerUnaryCall<
					SendRuntimeSessionRequest,
					SendRuntimeSessionResponse
				>,
				callback: grpc.sendUnaryData<SendRuntimeSessionResponse>,
			) => {
				void runtime
					.sendRuntimeSession(call.request)
					.then((result) => {
						callback(null, result);
					})
					.catch((error) => {
						callback(
							{
								code: grpc.status.INVALID_ARGUMENT,
								message: formatRpcCallbackError(error),
							},
							null,
						);
					});
			},
			StopRuntimeSession: (
				call: grpc.ServerUnaryCall<
					StopRuntimeSessionRequest,
					StopRuntimeSessionResponse
				>,
				callback: grpc.sendUnaryData<StopRuntimeSessionResponse>,
			) => {
				void runtime
					.stopRuntimeSession(call.request)
					.then((result) => {
						callback(null, result);
					})
					.catch((error) => {
						callback(
							{
								code: grpc.status.INVALID_ARGUMENT,
								message: formatRpcCallbackError(error),
							},
							null,
						);
					});
			},
			AbortRuntimeSession: (
				call: grpc.ServerUnaryCall<
					AbortRuntimeSessionRequest,
					AbortRuntimeSessionResponse
				>,
				callback: grpc.sendUnaryData<AbortRuntimeSessionResponse>,
			) => {
				void runtime
					.abortRuntimeSession(call.request)
					.then((result) => {
						callback(null, result);
					})
					.catch((error) => {
						callback(
							{
								code: grpc.status.INVALID_ARGUMENT,
								message: formatRpcCallbackError(error),
							},
							null,
						);
					});
			},
			RunProviderAction: (
				call: grpc.ServerUnaryCall<
					RunProviderActionRequest,
					RunProviderActionResponse
				>,
				callback: grpc.sendUnaryData<RunProviderActionResponse>,
			) => {
				void runtime
					.runProviderAction(call.request)
					.then((result) => {
						callback(null, result);
					})
					.catch((error) => {
						callback(
							{
								code: grpc.status.INVALID_ARGUMENT,
								message: formatRpcCallbackError(error),
							},
							null,
						);
					});
			},
			RunProviderOAuthLogin: (
				call: grpc.ServerUnaryCall<
					RunProviderOAuthLoginRequest,
					RunProviderOAuthLoginResponse
				>,
				callback: grpc.sendUnaryData<RunProviderOAuthLoginResponse>,
			) => {
				void runtime
					.runProviderOAuthLogin(call.request)
					.then((result) => {
						callback(null, result);
					})
					.catch((error) => {
						callback(
							{
								code: grpc.status.INVALID_ARGUMENT,
								message: formatRpcCallbackError(error),
							},
							null,
						);
					});
			},
			EnterpriseAuthenticate: (
				call: grpc.ServerUnaryCall<
					EnterpriseAuthenticateRequest,
					EnterpriseAuthenticateResponse
				>,
				callback: grpc.sendUnaryData<EnterpriseAuthenticateResponse>,
			) => {
				void runtime
					.enterpriseAuthenticate(call.request)
					.then((result) => {
						callback(null, result);
					})
					.catch((error) => {
						callback(
							{
								code: grpc.status.INVALID_ARGUMENT,
								message: formatRpcCallbackError(error),
							},
							null,
						);
					});
			},
			EnterpriseSync: (
				call: grpc.ServerUnaryCall<
					EnterpriseSyncRequest,
					EnterpriseSyncResponse
				>,
				callback: grpc.sendUnaryData<EnterpriseSyncResponse>,
			) => {
				void runtime
					.enterpriseSync(call.request)
					.then((result) => {
						callback(null, result);
					})
					.catch((error) => {
						callback(
							{
								code: grpc.status.INVALID_ARGUMENT,
								message: formatRpcCallbackError(error),
							},
							null,
						);
					});
			},
			EnterpriseGetStatus: (
				call: grpc.ServerUnaryCall<
					EnterpriseStatusRequest,
					EnterpriseStatusResponse
				>,
				callback: grpc.sendUnaryData<EnterpriseStatusResponse>,
			) => {
				void runtime
					.enterpriseGetStatus(call.request)
					.then((result) => {
						callback(null, result);
					})
					.catch((error) => {
						callback(
							{
								code: grpc.status.INVALID_ARGUMENT,
								message: formatRpcCallbackError(error),
							},
							null,
						);
					});
			},
			StartTask: (
				call: grpc.ServerUnaryCall<StartTaskRequest, TaskResponse>,
				callback: grpc.sendUnaryData<TaskResponse>,
			) => {
				try {
					callback(null, runtime.startTask(call.request));
				} catch (error) {
					callback(
						{
							code: grpc.status.INVALID_ARGUMENT,
							message: formatRpcCallbackError(error),
						},
						null,
					);
				}
			},
			CompleteTask: (
				call: grpc.ServerUnaryCall<CompleteTaskRequest, TaskResponse>,
				callback: grpc.sendUnaryData<TaskResponse>,
			) => {
				try {
					callback(null, runtime.completeTask(call.request));
				} catch (error) {
					callback(
						{
							code: grpc.status.INVALID_ARGUMENT,
							message: formatRpcCallbackError(error),
						},
						null,
					);
				}
			},
			PublishEvent: (
				call: grpc.ServerUnaryCall<PublishEventRequest, PublishEventResponse>,
				callback: grpc.sendUnaryData<PublishEventResponse>,
			) => {
				try {
					callback(null, runtime.publishEvent(call.request));
				} catch (error) {
					callback(
						{
							code: grpc.status.INVALID_ARGUMENT,
							message: formatRpcCallbackError(error),
						},
						null,
					);
				}
			},
			StreamEvents: (
				call: grpc.ServerWritableStream<
					StreamEventsRequest,
					RoutedEventMessage
				>,
			) => {
				runtime.addSubscriber(call);
			},
			RequestToolApproval: (
				call: grpc.ServerUnaryCall<
					RequestToolApprovalRequest,
					RequestToolApprovalResponse
				>,
				callback: grpc.sendUnaryData<RequestToolApprovalResponse>,
			) => {
				void runtime
					.requestToolApproval(call.request)
					.then((result) => {
						callback(null, result);
					})
					.catch((error) => {
						callback(
							{
								code: grpc.status.INVALID_ARGUMENT,
								message: formatRpcCallbackError(error),
							},
							null,
						);
					});
			},
			RespondToolApproval: (
				call: grpc.ServerUnaryCall<
					RespondToolApprovalRequest,
					RespondToolApprovalResponse
				>,
				callback: grpc.sendUnaryData<RespondToolApprovalResponse>,
			) => {
				try {
					callback(null, runtime.respondToolApproval(call.request));
				} catch (error) {
					callback(
						{
							code: grpc.status.INVALID_ARGUMENT,
							message: formatRpcCallbackError(error),
						},
						null,
					);
				}
			},
			ListPendingApprovals: (
				call: grpc.ServerUnaryCall<
					ListPendingApprovalsRequest,
					ListPendingApprovalsResponse
				>,
				callback: grpc.sendUnaryData<ListPendingApprovalsResponse>,
			) => {
				try {
					callback(null, runtime.listPendingApprovals(call.request));
				} catch (error) {
					callback(
						{
							code: grpc.status.INVALID_ARGUMENT,
							message: formatRpcCallbackError(error),
						},
						null,
					);
				}
			},
			CreateSchedule: (
				call: grpc.ServerUnaryCall<
					CreateScheduleRequest,
					CreateScheduleResponse
				>,
				callback: grpc.sendUnaryData<CreateScheduleResponse>,
			) => {
				try {
					callback(null, runtime.createSchedule(call.request));
				} catch (error) {
					callback(
						{
							code: grpc.status.INVALID_ARGUMENT,
							message: formatRpcCallbackError(error),
						},
						null,
					);
				}
			},
			GetSchedule: (
				call: grpc.ServerUnaryCall<GetScheduleRequest, GetScheduleResponse>,
				callback: grpc.sendUnaryData<GetScheduleResponse>,
			) => {
				try {
					callback(null, runtime.getSchedule(call.request));
				} catch (error) {
					callback(
						{
							code: grpc.status.INVALID_ARGUMENT,
							message: formatRpcCallbackError(error),
						},
						null,
					);
				}
			},
			ListSchedules: (
				call: grpc.ServerUnaryCall<ListSchedulesRequest, ListSchedulesResponse>,
				callback: grpc.sendUnaryData<ListSchedulesResponse>,
			) => {
				try {
					callback(null, runtime.listSchedules(call.request));
				} catch (error) {
					callback(
						{
							code: grpc.status.INVALID_ARGUMENT,
							message: formatRpcCallbackError(error),
						},
						null,
					);
				}
			},
			UpdateSchedule: (
				call: grpc.ServerUnaryCall<
					UpdateScheduleRequest,
					UpdateScheduleResponse
				>,
				callback: grpc.sendUnaryData<UpdateScheduleResponse>,
			) => {
				try {
					callback(null, runtime.updateSchedule(call.request));
				} catch (error) {
					callback(
						{
							code: grpc.status.INVALID_ARGUMENT,
							message: formatRpcCallbackError(error),
						},
						null,
					);
				}
			},
			DeleteSchedule: (
				call: grpc.ServerUnaryCall<
					DeleteScheduleRequest,
					DeleteScheduleResponse
				>,
				callback: grpc.sendUnaryData<DeleteScheduleResponse>,
			) => {
				try {
					callback(null, runtime.deleteSchedule(call.request));
				} catch (error) {
					callback(
						{
							code: grpc.status.INVALID_ARGUMENT,
							message: formatRpcCallbackError(error),
						},
						null,
					);
				}
			},
			PauseSchedule: (
				call: grpc.ServerUnaryCall<PauseScheduleRequest, PauseScheduleResponse>,
				callback: grpc.sendUnaryData<PauseScheduleResponse>,
			) => {
				try {
					callback(null, runtime.pauseSchedule(call.request));
				} catch (error) {
					callback(
						{
							code: grpc.status.INVALID_ARGUMENT,
							message: formatRpcCallbackError(error),
						},
						null,
					);
				}
			},
			ResumeSchedule: (
				call: grpc.ServerUnaryCall<
					ResumeScheduleRequest,
					ResumeScheduleResponse
				>,
				callback: grpc.sendUnaryData<ResumeScheduleResponse>,
			) => {
				try {
					callback(null, runtime.resumeSchedule(call.request));
				} catch (error) {
					callback(
						{
							code: grpc.status.INVALID_ARGUMENT,
							message: formatRpcCallbackError(error),
						},
						null,
					);
				}
			},
			TriggerScheduleNow: (
				call: grpc.ServerUnaryCall<
					TriggerScheduleNowRequest,
					TriggerScheduleNowResponse
				>,
				callback: grpc.sendUnaryData<TriggerScheduleNowResponse>,
			) => {
				void runtime
					.triggerScheduleNow(call.request)
					.then((response) => {
						callback(null, response);
					})
					.catch((error) => {
						callback(
							{
								code: grpc.status.INVALID_ARGUMENT,
								message: formatRpcCallbackError(error),
							},
							null,
						);
					});
			},
			ListScheduleExecutions: (
				call: grpc.ServerUnaryCall<
					ListScheduleExecutionsRequest,
					ListScheduleExecutionsResponse
				>,
				callback: grpc.sendUnaryData<ListScheduleExecutionsResponse>,
			) => {
				try {
					callback(null, runtime.listScheduleExecutions(call.request));
				} catch (error) {
					callback(
						{
							code: grpc.status.INVALID_ARGUMENT,
							message: formatRpcCallbackError(error),
						},
						null,
					);
				}
			},
			GetScheduleStats: (
				call: grpc.ServerUnaryCall<
					GetScheduleStatsRequest,
					GetScheduleStatsResponse
				>,
				callback: grpc.sendUnaryData<GetScheduleStatsResponse>,
			) => {
				try {
					callback(null, runtime.getScheduleStats(call.request));
				} catch (error) {
					callback(
						{
							code: grpc.status.INVALID_ARGUMENT,
							message: formatRpcCallbackError(error),
						},
						null,
					);
				}
			},
			GetActiveScheduledExecutions: (
				call: grpc.ServerUnaryCall<
					GetActiveScheduledExecutionsRequest,
					GetActiveScheduledExecutionsResponse
				>,
				callback: grpc.sendUnaryData<GetActiveScheduledExecutionsResponse>,
			) => {
				try {
					callback(null, runtime.getActiveScheduledExecutions(call.request));
				} catch (error) {
					callback(
						{
							code: grpc.status.INVALID_ARGUMENT,
							message: formatRpcCallbackError(error),
						},
						null,
					);
				}
			},
			GetUpcomingScheduledRuns: (
				call: grpc.ServerUnaryCall<
					GetUpcomingScheduledRunsRequest,
					GetUpcomingScheduledRunsResponse
				>,
				callback: grpc.sendUnaryData<GetUpcomingScheduledRunsResponse>,
			) => {
				try {
					callback(null, runtime.getUpcomingScheduledRuns(call.request));
				} catch (error) {
					callback(
						{
							code: grpc.status.INVALID_ARGUMENT,
							message: formatRpcCallbackError(error),
						},
						null,
					);
				}
			},
		});

		server.bindAsync(
			address,
			grpc.ServerCredentials.createInsecure(),
			(error, boundPort) => {
				if (error) {
					singletonStartPromise = undefined;
					reject(error);
					return;
				}

				void (async () => {
					if (scheduler) {
						try {
							await scheduler.start();
						} catch (schedErr) {
							singletonStartPromise = undefined;
							const err =
								schedErr instanceof Error
									? schedErr
									: new Error(String(schedErr));
							try {
								await new Promise<void>((r) => server.tryShutdown(() => r()));
							} catch {
								// Best-effort shutdown after failed scheduler start.
							}
							reject(err);
							return;
						}
					}

					const serverId = runtime.health().serverId ?? `srv_${randomUUID()}`;
					const startedAt = nowIso();
					const handle: RpcServerHandle = {
						serverId,
						address,
						port: boundPort,
						startedAt,
						stop: stopBoundServer,
					};
					singletonHandle = handle;
					resolve(handle);
				})();
			},
		);
	});

	return singletonStartPromise;
}

export function getRpcServerHandle(): RpcServerHandle | undefined {
	return singletonHandle;
}

export async function stopRpcServer(): Promise<void> {
	if (singletonHandle) {
		await singletonHandle.stop();
	}
}

export function getRpcServerDefaultAddress(): string {
	return DEFAULT_RPC_ADDRESS;
}
