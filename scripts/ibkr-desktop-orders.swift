import CoreGraphics
import Foundation
import ImageIO
import Vision

struct TextToken {
    let text: String
    let box: CGRect

    var normalized: String {
        text.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
    }
}

struct DesktopStopOrder: Codable {
    let orderId: Int
    let symbol: String
    let action: String
    let quantity: Double
    let orderType: String
    let stopPrice: Double
}

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(1)
}

func number(from value: String) -> Double? {
    Double(value.replacingOccurrences(of: ",", with: ""))
}

// A window can be fully capturable by ID even when macOS marks it off-screen
// because another app is full-screen or the window is on a different Space.
let windowOptions: CGWindowListOption = [.excludeDesktopElements]
let windows = CGWindowListCopyWindowInfo(windowOptions, kCGNullWindowID) as? [[String: Any]] ?? []
let desktopWindow = windows
    .filter { window in
        guard let owner = window[kCGWindowOwnerName as String] as? String,
              owner == "IBKR Desktop",
              let layer = window[kCGWindowLayer as String] as? Int,
              layer == 0,
              let bounds = window[kCGWindowBounds as String] as? [String: Any],
              let width = bounds["Width"] as? Double,
              let height = bounds["Height"] as? Double else { return false }
        return width >= 600 && height >= 400
    }
    .max { left, right in
        let leftBounds = left[kCGWindowBounds as String] as? [String: Any] ?? [:]
        let rightBounds = right[kCGWindowBounds as String] as? [String: Any] ?? [:]
        let leftArea = (leftBounds["Width"] as? Double ?? 0) * (leftBounds["Height"] as? Double ?? 0)
        let rightArea = (rightBounds["Width"] as? Double ?? 0) * (rightBounds["Height"] as? Double ?? 0)
        return leftArea < rightArea
    }

guard let desktopWindow,
      let windowNumber = desktopWindow[kCGWindowNumber as String] as? Int else {
    fail("IBKR Desktop is not open or has no readable main window")
}

let captureURL = FileManager.default.temporaryDirectory
    .appendingPathComponent("trading-analyzer-ibkr-orders-\(UUID().uuidString).png")
defer { try? FileManager.default.removeItem(at: captureURL) }

let capture = Process()
capture.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
capture.arguments = ["-x", "-l", String(windowNumber), captureURL.path]
do {
    try capture.run()
    capture.waitUntilExit()
} catch {
    fail("Could not capture the IBKR Desktop window: \(error.localizedDescription)")
}
guard capture.terminationStatus == 0,
      let source = CGImageSourceCreateWithURL(captureURL as CFURL, nil),
      let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
    fail("Could not capture the IBKR Desktop window; allow Screen Recording access and try again")
}

let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.usesLanguageCorrection = false
request.minimumTextHeight = 0.006
do {
    try VNImageRequestHandler(cgImage: image).perform([request])
} catch {
    fail("Could not read the IBKR Desktop Orders Table: \(error.localizedDescription)")
}

let tokens = (request.results ?? []).compactMap { observation -> TextToken? in
    guard let candidate = observation.topCandidates(1).first else { return nil }
    return TextToken(text: candidate.string, box: observation.boundingBox)
}

guard tokens.contains(where: { $0.normalized == "ORDERS TABLE" }) else {
    fail("Open the Orders Table in IBKR Desktop before using Sync Now")
}

let countPattern = try! NSRegularExpression(pattern: #"OPEN\s+ORDERS\s*\((\d+)\)"#)
let openOrderCount = tokens.compactMap { token -> Int? in
    let value = token.normalized
    let range = NSRange(value.startIndex..<value.endIndex, in: value)
    guard let match = countPattern.firstMatch(in: value, range: range),
          let countRange = Range(match.range(at: 1), in: value) else { return nil }
    return Int(value[countRange])
}.first

guard let openOrderCount else {
    fail("Select Open Orders in the IBKR Desktop Orders Table before using Sync Now")
}

let quantityPattern = try! NSRegularExpression(pattern: #"^\d[\d,]*\s*/\s*\d[\d,]*$"#)
let symbolPattern = try! NSRegularExpression(pattern: #"^[A-Z][A-Z0-9.\-]{0,9}$"#)
let actionTokens = tokens.filter { ["SELL", "BUY"].contains($0.normalized) }
var stopOrders: [DesktopStopOrder] = []
var recognizedRows = 0

for actionToken in actionTokens {
    let row = tokens.filter { abs($0.box.midY - actionToken.box.midY) <= 0.009 }
    let action = actionToken.normalized
    let hasStopType = row.contains { ["STOP", "STP", "STOP LIMIT", "STP LMT"].contains($0.normalized) }
    let quantityToken = row.first { token in
        let value = token.normalized
        let range = NSRange(value.startIndex..<value.endIndex, in: value)
        return quantityPattern.firstMatch(in: value, range: range) != nil
    }
    let symbolToken = row
        .filter { token in
            guard token.box.midX < actionToken.box.midX else { return false }
            let value = token.normalized.replacingOccurrences(of: "•", with: "")
                .trimmingCharacters(in: .whitespaces)
            let range = NSRange(value.startIndex..<value.endIndex, in: value)
            return symbolPattern.firstMatch(in: value, range: range) != nil
        }
        .max { $0.box.midX < $1.box.midX }

    guard let quantityToken, symbolToken != nil else { continue }
    recognizedRows += 1
    guard hasStopType else { continue }

    let quantityParts = quantityToken.normalized.split(separator: "/", maxSplits: 1)
    guard quantityParts.count == 2,
          let quantity = number(from: String(quantityParts[1])),
          quantity > 0 else { continue }

    let timeInForceToken = row
        .filter { ["GTC", "DAY"].contains($0.normalized) && $0.box.minX > quantityToken.box.maxX }
        .min { $0.box.minX < $1.box.minX }
    let priceTokens = row.filter { token in
        guard token.box.minX > quantityToken.box.maxX,
              timeInForceToken == nil || token.box.maxX < timeInForceToken!.box.minX else { return false }
        return number(from: token.normalized) != nil
    }
    guard let priceToken = priceTokens.max(by: { $0.box.midX < $1.box.midX }),
          let stopPrice = number(from: priceToken.normalized),
          stopPrice > 0 else { continue }

    let symbol = symbolToken!.normalized.replacingOccurrences(of: "•", with: "")
        .trimmingCharacters(in: .whitespaces)
    stopOrders.append(DesktopStopOrder(
        orderId: stopOrders.count + 1,
        symbol: symbol,
        action: action,
        quantity: quantity,
        orderType: "STP",
        stopPrice: stopPrice
    ))
}

guard recognizedRows == openOrderCount else {
    fail("IBKR Desktop shows \(openOrderCount) open orders, but only \(recognizedRows) visible rows were recognized; expand the Orders Table and try again")
}

let encoder = JSONEncoder()
encoder.outputFormatting = [.sortedKeys]
guard let output = try? encoder.encode(stopOrders) else {
    fail("Could not encode IBKR Desktop stop orders")
}
FileHandle.standardOutput.write(output)
FileHandle.standardOutput.write(Data("\n".utf8))
