import SwiftUI

private enum PairingKind: String {
    case qr, token
}

struct ConnectView: View {
    @EnvironmentObject var client: GatewayClient
    @Environment(\.colorScheme) var scheme

    @AppStorage("gateway.address") private var address: String = ""
    @AppStorage("gateway.token") private var token: String = ""
    @State private var pairingKind: PairingKind = .qr
    @State private var botIcon = BotIcons.random()

    var body: some View {
        VStack(spacing: 24) {
            Spacer()

            VStack(spacing: 8) {
                Group {
                    if let botIcon {
                        Image(uiImage: botIcon)
                            .resizable()
                            .scaledToFit()
                    } else {
                        Circle()
                            .fill(Theme.accent)
                            .overlay(Image(systemName: "bolt.fill").foregroundStyle(.white))
                    }
                }
                .frame(width: 72, height: 72)
                Text("Cline Gateway")
                    .font(.title2.bold())
                    .foregroundStyle(Theme.text(scheme))
                Text("Connect to your Cline Bots")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }

            Picker("Pairing method", selection: $pairingKind) {
                Label("QR Code", systemImage: PairingMethodRegistry.qrCode.systemImage).tag(PairingKind.qr)
                Label("Token", systemImage: PairingMethodRegistry.token.systemImage).tag(PairingKind.token)
            }
            .pickerStyle(.segmented)

            Group {
                switch pairingKind {
                case .qr:
                    PairingMethodRegistry.qrCode.makeView(onPaired: pair)
                case .token:
                    PairingMethodRegistry.token.makeView(onPaired: pair)
                }
            }
            .frame(minHeight: 360, alignment: .top)

            if case .failed(let message) = client.state {
                Text(message)
                    .font(.footnote)
                    .foregroundStyle(.red)
                    .multilineTextAlignment(.center)
            }

            if client.state == .connecting {
                ProgressView("Connecting…")
            }

            Spacer()
        }
        .padding(24)
        .background(Theme.background(scheme))
    }

    private func pair(address: String, token: String) {
        self.address = address
        self.token = token
        client.connect(address: address, token: token)
    }
}
