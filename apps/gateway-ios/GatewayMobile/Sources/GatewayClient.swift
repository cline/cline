import Foundation
import Combine

/// Talks to the same "cline-desktop-v1" WebSocket bridge used by the Tauri desktop
/// app and apps/gateway-ui (apps/cline/webview/lib/desktop-client.ts,
/// apps/cline/webview/lib/desktop-transport.ts). Auth is passed via WS subprotocols:
/// ["cline-desktop-v1", "cline-auth.<token>"] — no query params, no headers.
@MainActor
final class GatewayClient: NSObject, ObservableObject {
    enum ConnectionState: Equatable {
        case disconnected
        case connecting
        case connected
        case failed(String)
    }

    @Published var state: ConnectionState = .disconnected
    @Published var sessions: [SessionSummary] = []
    @Published var messagesBySession: [String: [ChatMessage]] = [:]
    @Published var streamingText: [String: String] = [:]
    @Published var pendingActions: [String: String] = [:]
    @Published var unreadCounts: [String: Int] = [:]
    /// Populated only by live "chat_session_ended" events after connecting — never by the
    /// initial session fetch — so a session's alert badge starts at none on every launch.
    @Published var errorSessions: Set<String> = []
    @Published var serverInfo: ServerInfo?
    var activeSessionId: String?

    func markRead(_ sessionId: String) {
        activeSessionId = sessionId
        unreadCounts[sessionId] = 0
        pendingActions.removeValue(forKey: sessionId)
        errorSessions.remove(sessionId)
    }

    /// Priority order: pending ask-question > running > streaming reply > terminal state > idle.
    func statusLabel(for sessionId: String) -> String {
        if let question = pendingActions[sessionId] {
            return "Waiting for your answer: \(question)"
        }
        let status = sessions.first(where: { $0.sessionId == sessionId })?.status ?? .idle
        switch status {
        case .starting, .running:
            return "Thinking…"
        case .completed:
            return streamingText[sessionId] != nil ? "Responding…" : "Completed"
        case .failed, .error:
            return "Error"
        case .cancelled, .stopping:
            return "Stopped"
        case .idle:
            return streamingText[sessionId] != nil ? "Responding…" : "Idle"
        }
    }

    private var task: URLSessionWebSocketTask?
    private var session: URLSession!
    private struct CommandError: Error, LocalizedError {
        let message: String
        var errorDescription: String? { message }
    }

    private var pending: [String: (Result<AnyCodable?, CommandError>) -> Void] = [:]
    private var requestCounter = 0

    override init() {
        super.init()
        session = URLSession(configuration: .default, delegate: self, delegateQueue: nil)
    }

    func connect(address: String, token: String) {
        guard var components = URLComponents(string: normalizedAddress(address)) else {
            state = .failed("Invalid address")
            return
        }
        if components.scheme == nil {
            components.scheme = "wss"
        }
        guard let url = components.url else {
            state = .failed("Invalid address")
            return
        }

        state = .connecting
        var request = URLRequest(url: url)
        request.setValue("cline-desktop-v1, cline-auth.\(token)", forHTTPHeaderField: "Sec-WebSocket-Protocol")

        let newTask = session.webSocketTask(with: request)
        task = newTask
        newTask.resume()
        receiveLoop()

        Task {
            // Handshake, mirrors apps/gateway-ui/app/page.tsx get_process_context check.
            do {
                let result = try await sendCommand("get_process_context", args: [:])
                serverInfo = result?.decode(as: ServerInfo.self)
                state = .connected
                await refreshSessions()
            } catch {
                state = .failed("\(error.localizedDescription)")
            }
        }
    }

    func disconnect() {
        task?.cancel(with: .normalClosure, reason: nil)
        task = nil
        state = .disconnected
        sessions = []
        messagesBySession = [:]
        streamingText = [:]
        pendingActions = [:]
        unreadCounts = [:]
        errorSessions = []
        serverInfo = nil
    }

    func listScheduledTasks() async -> [ScheduledTask] {
        guard let result = try? await sendCommand("list_routine_schedules", args: [:]) else { return [] }
        return result.decode(as: [ScheduledTask].self) ?? []
    }

    func refreshSessions() async {
        guard let result = try? await sendCommand("list_discovered_sessions", args: [:]) else { return }
        if let list: [SessionSummary] = result.decode(as: [SessionSummary].self) {
            sessions = list
        }
    }

    func loadMessages(sessionId: String) async {
        guard let result = try? await sendCommand("read_session_messages", args: ["sessionId": sessionId]) else { return }
        if let list: [ChatMessage] = result.decode(as: [ChatMessage].self) {
            messagesBySession[sessionId] = list
        }
    }

    func sendChatMessage(sessionId: String, text: String) async {
        let local = ChatMessage(sessionId: sessionId, role: "user", content: text)
        messagesBySession[sessionId, default: []].append(local)
        _ = try? await sendCommand("claim_message_bot", args: ["sessionId": sessionId, "content": text])
    }

    // MARK: - Transport

    private func normalizedAddress(_ address: String) -> String {
        var trimmed = address.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.contains("://") {
            trimmed = "wss://" + trimmed
        }
        return trimmed
    }

    @discardableResult
    private func sendCommand(_ command: String, args: [String: Any]) async throws -> AnyCodable? {
        requestCounter += 1
        let id = "ios_\(Int(Date().timeIntervalSince1970 * 1000))_\(requestCounter)"
        let encodedArgs = args.mapValues { AnyCodable($0) }
        let req = CommandRequest(id: id, command: command, args: encodedArgs)
        let data = try JSONEncoder().encode(req)
        guard let text = String(data: data, encoding: .utf8) else {
            throw NSError(domain: "GatewayClient", code: 1)
        }

        return try await withCheckedThrowingContinuation { continuation in
            pending[id] = { result in
                switch result {
                case .success(let value): continuation.resume(returning: value)
                case .failure(let error): continuation.resume(throwing: error)
                }
            }
            self.task?.send(.string(text)) { error in
                if let error {
                    self.pending.removeValue(forKey: id)
                    continuation.resume(throwing: error)
                }
            }
        }
    }

    private func receiveLoop() {
        task?.receive { [weak self] result in
            guard let self else { return }
            Task { @MainActor in
                switch result {
                case .success(let message):
                    self.handle(message)
                    self.receiveLoop()
                case .failure(let error):
                    self.state = .failed(error.localizedDescription)
                }
            }
        }
    }

    private func handle(_ message: URLSessionWebSocketTask.Message) {
        guard case .string(let text) = message, let data = text.data(using: .utf8) else { return }
        guard let envelope = try? JSONDecoder().decode(TransportEnvelope.self, from: data) else { return }

        switch envelope.type {
        case "response":
            guard let id = envelope.id, let completion = pending.removeValue(forKey: id) else { return }
            if envelope.ok == true {
                completion(.success(envelope.result))
            } else {
                completion(.failure(CommandError(message: envelope.error ?? "Unknown error")))
            }
        case "event":
            handleEvent(envelope.event)
        default:
            break
        }
    }

    private struct ChatSessionStatusPayload: Decodable {
        let sessionId: String
        let status: SessionStatus
    }

    private struct ChatEventPayload: Decodable {
        let sessionId: String
        let stream: String
        let chunk: String?
    }

    private struct ChatSessionEndedPayload: Decodable {
        let sessionId: String
        let reason: String?
    }

    private struct ToolApprovalItem: Decodable {
        let sessionId: String?
        let question: String?
    }

    private struct ToolApprovalStatePayload: Decodable {
        let sessionId: String?
        let items: [ToolApprovalItem]
    }

    private func handleEvent(_ event: EventPayload?) {
        guard let event else { return }
        switch event.name {
        case "chat_session_status":
            guard let payload: ChatSessionStatusPayload = event.payload?.decode(as: ChatSessionStatusPayload.self) else { return }
            if let index = sessions.firstIndex(where: { $0.sessionId == payload.sessionId }) {
                sessions[index].status = payload.status
            } else {
                Task { await refreshSessions() }
            }
        case "chat_event":
            guard let payload: ChatEventPayload = event.payload?.decode(as: ChatEventPayload.self) else { return }
            switch payload.stream {
            case "chat_text":
                streamingText[payload.sessionId, default: ""] += payload.chunk ?? ""
            case "chat_done":
                streamingText.removeValue(forKey: payload.sessionId)
                let sessionId = payload.sessionId
                Task {
                    await loadMessages(sessionId: sessionId)
                    if sessionId != activeSessionId {
                        unreadCounts[sessionId, default: 0] += 1
                    }
                }
            default:
                break
            }
        case "chat_session_ended":
            guard let payload: ChatSessionEndedPayload = event.payload?.decode(as: ChatSessionEndedPayload.self) else { return }
            streamingText.removeValue(forKey: payload.sessionId)
            pendingActions.removeValue(forKey: payload.sessionId)
            if payload.reason == "error", payload.sessionId != activeSessionId {
                errorSessions.insert(payload.sessionId)
            }
            Task { await refreshSessions() }
        case "tool_approval_state":
            guard let payload: ToolApprovalStatePayload = event.payload?.decode(as: ToolApprovalStatePayload.self) else { return }
            guard let item = payload.items.first, let sessionId = item.sessionId ?? payload.sessionId else { return }
            if let question = item.question {
                pendingActions[sessionId] = question
            }
        case "gateway_updated":
            Task { await refreshSessions() }
        default:
            break
        }
    }
}

extension GatewayClient: URLSessionWebSocketDelegate {
    nonisolated func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didCloseWith closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?) {
        Task { @MainActor in
            self.state = .disconnected
        }
    }
}
