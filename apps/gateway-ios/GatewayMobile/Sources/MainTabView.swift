import SwiftUI

struct MainTabView: View {
    var body: some View {
        TabView {
            SessionsView()
                .tabItem { Label("Chat", systemImage: "bubble.left.and.bubble.right") }
            TasksView()
                .tabItem { Label("Tasks", systemImage: "checklist") }
            SettingsView()
                .tabItem { Label("Settings", systemImage: "gearshape") }
        }
    }
}
