import AVFoundation
import SwiftUI

/// Pairing payload encoded in the QR code printed by `apps/cline/docker/quickstart.sh`:
/// clinegateway://connect?address=<wss url>&token=<token>
struct QRCodePairing: PairingMethod {
    let id = "qr"
    let title = "Scan QR Code"
    let systemImage = "qrcode.viewfinder"

    func makeView(onPaired: @escaping (String, String) -> Void) -> some View {
        QRScannerView(onPaired: onPaired)
    }

    static func parse(_ payload: String) -> (address: String, token: String)? {
        guard let components = URLComponents(string: payload),
              components.scheme == "clinegateway",
              components.host == "connect",
              let items = components.queryItems,
              let address = items.first(where: { $0.name == "address" })?.value,
              let token = items.first(where: { $0.name == "token" })?.value,
              !address.isEmpty, !token.isEmpty
        else {
            return nil
        }
        return (address, token)
    }
}

private struct QRScannerView: View {
    let onPaired: (String, String) -> Void
    @State private var errorMessage: String?

    var body: some View {
        ZStack {
            QRCaptureView { payload in
                guard let pair = QRCodePairing.parse(payload) else {
                    errorMessage = "That QR code isn't a gateway pairing code."
                    return
                }
                onPaired(pair.address, pair.token)
            }
            .clipShape(RoundedRectangle(cornerRadius: 14))

            if let errorMessage {
                VStack {
                    Spacer()
                    Text(errorMessage)
                        .font(.footnote)
                        .foregroundStyle(.white)
                        .padding(10)
                        .background(.black.opacity(0.7))
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                        .padding(.bottom, 16)
                }
            }
        }
        .frame(height: 320)
    }
}

/// Thin UIKit/AVFoundation bridge for scanning a single QR code.
private struct QRCaptureView: UIViewControllerRepresentable {
    let onCode: (String) -> Void

    func makeUIViewController(context: Context) -> QRCaptureViewController {
        let controller = QRCaptureViewController()
        controller.onCode = onCode
        return controller
    }

    func updateUIViewController(_ uiViewController: QRCaptureViewController, context: Context) {}
}

private final class QRCaptureViewController: UIViewController, AVCaptureMetadataOutputObjectsDelegate {
    var onCode: ((String) -> Void)?
    private let session = AVCaptureSession()
    private var hasDelivered = false

    override func viewDidLoad() {
        super.viewDidLoad()
        configureSession()
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        if !session.isRunning {
            DispatchQueue.global(qos: .userInitiated).async { [session] in
                session.startRunning()
            }
        }
    }

    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        if session.isRunning {
            session.stopRunning()
        }
    }

    private func configureSession() {
        guard let device = AVCaptureDevice.default(for: .video),
              let input = try? AVCaptureDeviceInput(device: device),
              session.canAddInput(input)
        else {
            return
        }
        session.addInput(input)

        let output = AVCaptureMetadataOutput()
        guard session.canAddOutput(output) else { return }
        session.addOutput(output)
        output.setMetadataObjectsDelegate(self, queue: .main)
        output.metadataObjectTypes = [.qr]

        let preview = AVCaptureVideoPreviewLayer(session: session)
        preview.videoGravity = .resizeAspectFill
        preview.frame = view.bounds
        view.layer.addSublayer(preview)
        self.previewLayer = preview
    }

    private var previewLayer: AVCaptureVideoPreviewLayer?

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        previewLayer?.frame = view.bounds
    }

    func metadataOutput(_ output: AVCaptureMetadataOutput, didOutput metadataObjects: [AVMetadataObject], from connection: AVCaptureConnection) {
        guard !hasDelivered,
              let object = metadataObjects.first as? AVMetadataMachineReadableCodeObject,
              object.type == .qr,
              let payload = object.stringValue
        else {
            return
        }
        hasDelivered = true
        onCode?(payload)
    }
}
