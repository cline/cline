import SwiftUI

/// Pairs by address + either a one-time PIN (exchanged for the real token via
/// POST /pair, see apps/cline/sidecar/server.ts `handlePairRequest`) or the long
/// remote token directly, toggled by a "Use Remote Token" checkbox.
struct TokenPairing: PairingMethod {
    let id = "token"
    let title = "Token"
    let systemImage = "key"

    func makeView(onPaired: @escaping (String, String) -> Void) -> some View {
        TokenPairingView(onPaired: onPaired)
    }
}

private struct TokenPairingView: View {
    @Environment(\.colorScheme) var scheme
    @State private var address: String = ""
    @State private var pin: String = ""
    @State private var token: String = ""
    @State private var useRemoteToken = false
    @State private var isSubmitting = false
    @State private var errorMessage: String?
    let onPaired: (String, String) -> Void

    private var canSubmit: Bool {
        !address.isEmpty && (useRemoteToken ? !token.isEmpty : !pin.isEmpty)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            field(label: "WebSocket address", text: $address, placeholder: "wss://gateway.example.com", keyboard: .URL)

            if useRemoteToken {
                field(label: "Remote token", text: $token, placeholder: "Paste your remote token", isSecure: true)
            } else {
                field(label: "One-time PIN", text: $pin, placeholder: "123456", keyboard: .numberPad)
            }

            Button {
                useRemoteToken.toggle()
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: useRemoteToken ? "checkmark.square.fill" : "square")
                        .foregroundStyle(useRemoteToken ? Theme.accent : .secondary)
                    Text("Use Remote Token")
                        .font(.footnote)
                        .foregroundStyle(Theme.text(scheme))
                }
            }
            .buttonStyle(.plain)

            if let errorMessage {
                Text(errorMessage)
                    .font(.footnote)
                    .foregroundStyle(.red)
            }

            Button {
                submit()
            } label: {
                HStack {
                    if isSubmitting {
                        ProgressView().tint(.white)
                    }
                    Text(isSubmitting ? "Verifying…" : "Continue")
                        .font(.headline)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 14)
            }
            .background(Theme.accent)
            .foregroundStyle(.white)
            .clipShape(RoundedRectangle(cornerRadius: 12))
            .disabled(!canSubmit || isSubmitting)
        }
        .padding(16)
        .background(Theme.surface(scheme))
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(Theme.border(scheme)))
    }

    private func submit() {
        if useRemoteToken {
            onPaired(address, token)
            return
        }
        guard let pairURL = PinExchange.pairURL(for: address) else {
            errorMessage = "Invalid address"
            return
        }
        errorMessage = nil
        isSubmitting = true
        Task {
            do {
                let exchangedToken = try await PinExchange.requestToken(at: pairURL, pin: pin)
                await MainActor.run {
                    isSubmitting = false
                    onPaired(address, exchangedToken)
                }
            } catch {
                await MainActor.run {
                    isSubmitting = false
                    errorMessage = PinExchange.message(for: error)
                }
            }
        }
    }

    @ViewBuilder
    private func field(label: String, text: Binding<String>, placeholder: String, keyboard: UIKeyboardType = .default, isSecure: Bool = false) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label)
                .font(.caption)
                .foregroundStyle(.secondary)
            Group {
                if isSecure {
                    SecureField(placeholder, text: text)
                } else {
                    TextField(placeholder, text: text)
                        .keyboardType(keyboard)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)
                }
            }
            .foregroundStyle(Theme.text(scheme))
        }
    }
}

/// PIN-for-token exchange against the sidecar's POST /pair endpoint.
enum PinExchange {
    enum PairingError: Error {
        case notFound
        case expired
        case invalidPin
        case server(Int)
    }

    static func pairURL(for address: String) -> URL? {
        var trimmed = address.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.contains("://") {
            trimmed = "wss://" + trimmed
        }
        guard var components = URLComponents(string: trimmed) else { return nil }
        switch components.scheme {
        case "wss": components.scheme = "https"
        case "ws": components.scheme = "http"
        default: break
        }
        components.path = "/pair"
        return components.url
    }

    static func requestToken(at url: URL, pin: String) async throws -> String {
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(["pin": pin])

        let (data, response) = try await URLSession.shared.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        switch status {
        case 200:
            let decoded = try JSONDecoder().decode([String: String].self, from: data)
            guard let token = decoded["token"] else { throw PairingError.server(status) }
            return token
        case 404: throw PairingError.notFound
        case 410: throw PairingError.expired
        case 401: throw PairingError.invalidPin
        default: throw PairingError.server(status)
        }
    }

    static func message(for error: Error) -> String {
        switch error {
        case PairingError.notFound: return "No pairing PIN is active on that server."
        case PairingError.expired: return "That PIN expired or ran out of attempts. Restart the server to get a new one."
        case PairingError.invalidPin: return "Incorrect PIN."
        default: return "Couldn't reach the server."
        }
    }
}
