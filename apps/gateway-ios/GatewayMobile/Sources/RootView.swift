import SwiftUI

struct RootView: View {
    @EnvironmentObject var client: GatewayClient
    @Environment(\.colorScheme) var scheme

    var body: some View {
        Group {
            if client.state == .connected {
                MainTabView()
            } else {
                ConnectView()
            }
        }
        .background(Theme.background(scheme))
        .tint(Theme.accent)
    }
}
