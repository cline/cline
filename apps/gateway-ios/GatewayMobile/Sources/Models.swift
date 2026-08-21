import Foundation

// Mirrors apps/cline/webview/lib/desktop-transport.ts

struct CommandRequest: Encodable {
    let type = "command"
    let id: String
    let command: String
    let args: [String: AnyCodable]?
}

struct TransportEnvelope: Decodable {
    let type: String
    let id: String?
    let ok: Bool?
    let result: AnyCodable?
    let error: String?
    let event: EventPayload?
}

struct EventPayload: Decodable {
    let name: String
    let payload: AnyCodable?
}

/// Mirrors apps/cline/webview/lib/chat-schema.ts ChatSessionStatusSchema
enum SessionStatus: String, Codable {
    case idle, starting, running, stopping, completed, cancelled, failed, error
}

struct SessionSummary: Identifiable, Decodable {
    let sessionId: String
    let botName: String?
    let workspaceRoot: String?
    var status: SessionStatus
    let provider: String?
    let model: String?
    let lastMessage: String?
    let updatedAt: Double?

    var id: String { sessionId }

    enum CodingKeys: String, CodingKey {
        case sessionId, botName, workspaceRoot, status, provider, model, lastMessage, updatedAt
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        sessionId = try c.decodeIfPresent(String.self, forKey: .sessionId) ?? UUID().uuidString
        botName = try c.decodeIfPresent(String.self, forKey: .botName)
        workspaceRoot = try c.decodeIfPresent(String.self, forKey: .workspaceRoot)
        status = try c.decodeIfPresent(SessionStatus.self, forKey: .status) ?? .idle
        provider = try c.decodeIfPresent(String.self, forKey: .provider)
        model = try c.decodeIfPresent(String.self, forKey: .model)
        lastMessage = try c.decodeIfPresent(String.self, forKey: .lastMessage)
        updatedAt = try c.decodeIfPresent(Double.self, forKey: .updatedAt)
    }
}

/// Mirrors apps/cline/webview/lib/chat-schema.ts ChatMessageSchema
struct MessageMeta: Decodable {
    let providerId: String?
    let modelId: String?
}

struct ChatMessage: Identifiable, Decodable {
    let id: String
    let sessionId: String?
    let role: String
    let content: String
    let createdAt: Double?
    let meta: MessageMeta?

    enum CodingKeys: String, CodingKey {
        case id, sessionId, role, content, createdAt, meta
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeIfPresent(String.self, forKey: .id) ?? UUID().uuidString
        sessionId = try c.decodeIfPresent(String.self, forKey: .sessionId)
        role = try c.decodeIfPresent(String.self, forKey: .role) ?? "assistant"
        content = try c.decodeIfPresent(String.self, forKey: .content) ?? ""
        createdAt = try c.decodeIfPresent(Double.self, forKey: .createdAt)
        meta = try c.decodeIfPresent(MessageMeta.self, forKey: .meta)
    }

    init(id: String = UUID().uuidString, sessionId: String?, role: String, content: String) {
        self.id = id
        self.sessionId = sessionId
        self.role = role
        self.content = content
        self.createdAt = Date().timeIntervalSince1970 * 1000
        self.meta = nil
    }
}

/// Mirrors the get_process_context result (apps/cline/sidecar/commands.ts).
struct ServerInfo: Decodable {
    let appVersion: String?
    let workspaceRoot: String?
}

/// Mirrors a ScheduleRecord (sdk/packages/gateway/src/schedules/store.ts).
struct ScheduledTask: Identifiable, Decodable {
    let scheduleId: String
    let name: String
    let prompt: String
    let enabled: Bool
    let intervalMs: Double?
    let at: Double?
    let nextDueAt: Double?

    var id: String { scheduleId }
}

/// Minimal JSON-any box for decoding/encoding arbitrary command args/results.
struct AnyCodable: Codable {
    let value: Any

    init(_ value: Any) { self.value = value }

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if let v = try? c.decode(Bool.self) { value = v; return }
        if let v = try? c.decode(Double.self) { value = v; return }
        if let v = try? c.decode(String.self) { value = v; return }
        if let v = try? c.decode([AnyCodable].self) { value = v.map { $0.value }; return }
        if let v = try? c.decode([String: AnyCodable].self) { value = v.mapValues { $0.value }; return }
        value = NSNull()
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch value {
        case let v as Bool: try c.encode(v)
        case let v as Double: try c.encode(v)
        case let v as Int: try c.encode(v)
        case let v as String: try c.encode(v)
        case let v as [Any]: try c.encode(v.map(AnyCodable.init))
        case let v as [String: Any]: try c.encode(v.mapValues(AnyCodable.init))
        default: try c.encodeNil()
        }
    }

    /// Convenience decode into a Decodable struct by re-encoding through JSONSerialization.
    func decode<T: Decodable>(as type: T.Type) -> T? {
        guard let data = try? JSONSerialization.data(withJSONObject: value, options: []) else { return nil }
        return try? JSONDecoder().decode(T.self, from: data)
    }
}
