import SwiftUI

/// Mirrors sdk/packages/ui/theme palette + accent tokens used by the desktop/gateway-ui apps.
enum Theme {
    static let accent = Color(hex: 0x6e56cf)

    static func background(_ scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(hex: 0x121216) : Color(hex: 0xfcfcfd)
    }

    static func surface(_ scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(hex: 0x1a1a1f) : Color(hex: 0xf9f9fb)
    }

    static func text(_ scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(hex: 0xfcfcfd) : Color(hex: 0x1c2024)
    }

    static func border(_ scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(hex: 0x2f2f37) : Color(hex: 0xe8e8ec)
    }

    static func statusColor(_ status: SessionStatus) -> Color {
        switch status {
        case .running, .starting: return .green
        case .failed, .error: return .red
        case .cancelled, .stopping: return .orange
        case .completed: return .blue
        case .idle: return .gray
        }
    }
}

extension Color {
    init(hex: UInt32) {
        let r = Double((hex >> 16) & 0xff) / 255
        let g = Double((hex >> 8) & 0xff) / 255
        let b = Double(hex & 0xff) / 255
        self.init(red: r, green: g, blue: b)
    }
}
