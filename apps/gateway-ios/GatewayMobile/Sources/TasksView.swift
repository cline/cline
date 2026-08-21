import SwiftUI

struct TasksView: View {
    @EnvironmentObject var client: GatewayClient
    @Environment(\.colorScheme) var scheme
    @State private var tasks: [ScheduledTask] = []
    @State private var isLoading = false

    var body: some View {
        NavigationStack {
            List {
                if tasks.isEmpty && !isLoading {
                    ContentUnavailableView("No scheduled tasks", systemImage: "checklist")
                        .listRowBackground(Theme.background(scheme))
                }
                ForEach(tasks) { task in
                    TaskRow(task: task)
                        .listRowBackground(Theme.surface(scheme))
                }
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .background(Theme.background(scheme))
            .toolbar(.hidden, for: .navigationBar)
            .refreshable { await load() }
            .task { await load() }
        }
    }

    private func load() async {
        isLoading = true
        tasks = await client.listScheduledTasks()
        isLoading = false
    }
}

private struct TaskRow: View {
    let task: ScheduledTask
    @Environment(\.colorScheme) var scheme

    private var scheduleText: String {
        if let intervalMs = task.intervalMs {
            let minutes = Int(intervalMs / 60000)
            return "Every \(minutes) min"
        }
        if let at = task.at {
            return "At " + Date(timeIntervalSince1970: at / 1000).formatted(date: .abbreviated, time: .shortened)
        }
        return "One-time"
    }

    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(task.name)
                    .font(.body.weight(.medium))
                    .foregroundStyle(Theme.text(scheme))
                Text(task.prompt.split(separator: "\n").first.map(String.init) ?? task.prompt)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                Text(scheduleText)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }

            Spacer()

            Text(task.enabled ? "Active" : "Paused")
                .font(.caption.weight(.medium))
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
                .background((task.enabled ? Color.green : Color.gray).opacity(0.15))
                .foregroundStyle(task.enabled ? .green : .gray)
                .clipShape(Capsule())
        }
        .padding(.vertical, 4)
    }
}
