import SwiftUI

@main
struct GatewayMobileApp: App {
    @StateObject private var client = GatewayClient()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(client)
        }
    }
}
