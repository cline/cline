import SwiftUI

struct SettingsView: View {
    @EnvironmentObject var client: GatewayClient
    @Environment(\.colorScheme) var scheme
    @AppStorage("gateway.address") private var address: String = ""
    @AppStorage("gateway.token") private var token: String = ""

    var body: some View {
        NavigationStack {
            List {
                Section("Server") {
                    LabeledContent("Address", value: address)
                    LabeledContent("Version", value: client.serverInfo?.appVersion?.isEmpty == false ? client.serverInfo!.appVersion! : "Unknown")
                }
                .listRowBackground(Theme.surface(scheme))

                Section {
                    Button {
                        client.disconnect()
                    } label: {
                        Label("Switch Server", systemImage: "arrow.triangle.2.circlepath")
                    }

                    Button(role: .destructive) {
                        client.disconnect()
                        address = ""
                        token = ""
                    } label: {
                        Label("Log Out", systemImage: "rectangle.portrait.and.arrow.right")
                    }
                }
                .listRowBackground(Theme.surface(scheme))
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .background(Theme.background(scheme))
            .toolbar(.hidden, for: .navigationBar)
        }
    }
}
