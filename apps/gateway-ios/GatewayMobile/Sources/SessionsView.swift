import SwiftUI

struct SessionsView: View {
    @EnvironmentObject var client: GatewayClient
    @Environment(\.colorScheme) var scheme
    @State private var selectedSessionId: String?

    var body: some View {
        NavigationStack {
            List {
                if client.sessions.isEmpty {
                    ContentUnavailableView("No sessions running", systemImage: "tray")
                        .listRowBackground(Theme.background(scheme))
                }
                ForEach(client.sessions) { session in
                    Button {
                        selectedSessionId = session.id
                    } label: {
                        SessionRow(
                            session: session,
                            unreadCount: client.unreadCounts[session.sessionId] ?? 0,
                            hasPendingAction: client.pendingActions[session.sessionId] != nil,
                            hasError: client.errorSessions.contains(session.sessionId)
                        )
                    }
                    .buttonStyle(.plain)
                    .listRowBackground(Theme.surface(scheme))
                }
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .background(Theme.background(scheme))
            .navigationDestination(item: $selectedSessionId) { sessionId in
                ChatView(sessionId: sessionId)
            }
            .toolbar(.hidden, for: .navigationBar)
            .refreshable {
                await client.refreshSessions()
            }
            .task {
                await client.refreshSessions()
            }
        }
    }
}

private struct SessionRow: View {
    let session: SessionSummary
    let unreadCount: Int
    let hasPendingAction: Bool
    let hasError: Bool
    @Environment(\.colorScheme) var scheme

    private var badgeColor: Color? {
        if hasError { return .red }
        if hasPendingAction { return .yellow }
        if unreadCount > 0 { return .blue }
        return nil
    }

    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(session.botName?.isEmpty == false ? session.botName! : "Untitled")
                    .font(.body.weight(.medium))
                    .foregroundStyle(Theme.text(scheme))
                Text((session.lastMessage?.isEmpty == false ? session.lastMessage! : "No messages yet")
                    .split(separator: "\n").first.map(String.init) ?? "")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }

            Spacer()

            if let badgeColor {
                Text(unreadCount > 0 ? "\(unreadCount)" : " ")
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(.white)
                    .frame(minWidth: 20, minHeight: 20)
                    .background(badgeColor)
                    .clipShape(Circle())
            }

            Circle()
                .fill(Theme.statusColor(session.status))
                .frame(width: 10, height: 10)
        }
        .padding(.vertical, 4)
        .contentShape(Rectangle())
    }
}
