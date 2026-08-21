import SwiftUI

/// A way to obtain (address, token) for `GatewayClient.connect(address:token:)`.
/// Add a new pairing method by creating a conformer and listing it in `PairingMethodRegistry`.
protocol PairingMethod: Identifiable {
    var id: String { get }
    var title: String { get }
    var systemImage: String { get }
    associatedtype Body: View
    @ViewBuilder func makeView(onPaired: @escaping (String, String) -> Void) -> Body
}

enum PairingMethodRegistry {
    static let qrCode = QRCodePairing()
    static let token = TokenPairing()
}
