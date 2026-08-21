import SwiftUI

struct ChatView: View {
    let sessionId: String
    @EnvironmentObject var client: GatewayClient
    @Environment(\.colorScheme) var scheme
    @State private var draft: String = ""

    private var messages: [ChatMessage] {
        client.messagesBySession[sessionId] ?? []
    }

    private var botName: String {
        let name = client.sessions.first(where: { $0.sessionId == sessionId })?.botName
        return name?.isEmpty == false ? name! : "Untitled"
    }

    var body: some View {
        VStack(spacing: 0) {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 10) {
                        ForEach(messages) { message in
                            MessageBubble(message: message)
                                .id(message.id)
                        }
                        if let streaming = client.streamingText[sessionId] {
                            MessageBubble(message: ChatMessage(sessionId: sessionId, role: "assistant", content: streaming))
                                .id("streaming")
                        }
                    }
                    .padding(16)
                }
                .onChange(of: messages.count) { _, _ in
                    if let last = messages.last {
                        withAnimation { proxy.scrollTo(last.id, anchor: .bottom) }
                    }
                }
                .onChange(of: client.streamingText[sessionId]) { _, _ in
                    withAnimation { proxy.scrollTo("streaming", anchor: .bottom) }
                }
            }

            Divider().background(Theme.border(scheme))

            HStack(spacing: 10) {
                TextField("Message your agent…", text: $draft, axis: .vertical)
                    .padding(10)
                    .background(Theme.surface(scheme))
                    .clipShape(RoundedRectangle(cornerRadius: 10))
                    .overlay(RoundedRectangle(cornerRadius: 10).stroke(Theme.border(scheme)))

                Button {
                    let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
                    guard !text.isEmpty else { return }
                    draft = ""
                    Task { await client.sendChatMessage(sessionId: sessionId, text: text) }
                } label: {
                    Image(systemName: "arrow.up.circle.fill")
                        .font(.title)
                        .foregroundStyle(Theme.accent)
                }
                .disabled(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
            .padding(12)
        }
        .background(Theme.background(scheme))
        .toolbar {
            ToolbarItem(placement: .principal) {
                VStack(spacing: 2) {
                    Text(botName)
                        .font(.headline)
                        .foregroundStyle(Theme.text(scheme))
                    Text(client.statusLabel(for: sessionId))
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .navigationBarTitleDisplayMode(.inline)
        .task {
            client.markRead(sessionId)
            await client.loadMessages(sessionId: sessionId)
        }
    }
}

private struct MessageBubble: View {
    let message: ChatMessage
    @Environment(\.colorScheme) var scheme

    private var isUser: Bool { message.role == "user" }

    private var renderedContent: AttributedString {
        (try? AttributedString(markdown: message.content, options: .init(interpretedSyntax: .full)))
            ?? AttributedString(message.content)
    }

    private var timestampText: String? {
        guard let createdAt = message.createdAt else { return nil }
        let date = Date(timeIntervalSince1970: createdAt / 1000)
        return date.formatted(date: .omitted, time: .shortened)
    }

    private var metaText: String? {
        guard !isUser else { return nil }
        let parts = [message.meta?.providerId, message.meta?.modelId].compactMap { $0 }.filter { !$0.isEmpty }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    var body: some View {
        VStack(alignment: isUser ? .trailing : .leading, spacing: 4) {
            HStack {
                if isUser { Spacer(minLength: 40) }
                Text(renderedContent)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .background(isUser ? Theme.accent : Theme.surface(scheme))
                    .foregroundStyle(isUser ? .white : Theme.text(scheme))
                    .clipShape(RoundedRectangle(cornerRadius: 16))
                if !isUser { Spacer(minLength: 40) }
            }

            if let metaText, let timestampText {
                Text("\(metaText) · \(timestampText)")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 4)
            } else if let timestampText {
                Text(timestampText)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 4)
            }
        }
    }
}
