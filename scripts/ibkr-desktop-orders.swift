import AppKit
import ApplicationServices
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
    let status: String
    let fillPrice: Double?
}

struct DesktopOrderScan: Codable {
    let orders: [DesktopStopOrder]
    let view: String
    let expectedRows: Int
    let recognizedRows: Int
    let pageCount: Int
}

struct ParsedOrderPage {
    let orders: [DesktopStopOrder]
    let view: String
    let expectedRows: Int
    let recognizedRows: Int
}

func argumentValue(_ name: String) -> String? {
    guard let index = CommandLine.arguments.firstIndex(of: name),
          CommandLine.arguments.indices.contains(index + 1) else { return nil }
    return CommandLine.arguments[index + 1]
}

let outputPath = argumentValue("--output")

func fail(_ message: String) -> Never {
    if let outputPath {
        let payload = try? JSONSerialization.data(withJSONObject: ["error": message])
        if let payload {
            try? payload.write(to: URL(fileURLWithPath: outputPath), options: .atomic)
        }
    }
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(1)
}

func number(from value: String) -> Double? {
    Double(value
        .replacingOccurrences(of: ",", with: "")
        .replacingOccurrences(of: "...", with: "")
        .replacingOccurrences(of: "…", with: ""))
}

func action(from token: TextToken) -> String? {
    if token.normalized.hasPrefix("SELL") { return "SELL" }
    if token.normalized.hasPrefix("BUY") { return "BUY" }
    return nil
}

func normalizedSymbol(from token: TextToken) -> String {
    var value = token.normalized.replacingOccurrences(of: "•", with: "")
        .replacingOccurrences(of: "|", with: "")
        .trimmingCharacters(in: .whitespaces)
    let lookalikes = [
        "А": "A", "В": "B", "Е": "E", "К": "K", "М": "M", "Н": "H",
        "О": "O", "Р": "P", "С": "C", "Т": "T", "Х": "X", "У": "Y",
    ]
    for (source, replacement) in lookalikes {
        value = value.replacingOccurrences(of: source, with: replacement)
    }
    return value
}

func captureTokens(windowNumber: Int, knownSymbolWords: [String], knownSymbols: Set<String>) -> [TextToken] {
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
    request.recognitionLanguages = ["en-US"]
    request.customWords = knownSymbolWords
    do {
        try VNImageRequestHandler(cgImage: image).perform([request])
    } catch {
        fail("Could not read the IBKR Desktop Orders Table: \(error.localizedDescription)")
    }

    return (request.results ?? []).compactMap { observation -> TextToken? in
        let candidates = observation.topCandidates(5)
        guard let candidate = candidates.first(where: { candidate in
            knownSymbols.contains(normalizedSymbol(from: TextToken(text: candidate.string, box: observation.boundingBox)))
        }) ?? candidates.first else { return nil }
        return TextToken(text: candidate.string, box: observation.boundingBox)
    }
}

func parseOrderPage(tokens: [TextToken], debugLabel: String) -> ParsedOrderPage {
    // The Orders Table occupies the left side of the IBKR workspace. Excluding the
    // right-side order-entry panels prevents their controls from becoming order rows.
    let tableTokens = tokens.filter { $0.box.midX < 0.63 }
    if ProcessInfo.processInfo.environment["IBKR_OCR_DEBUG"] == "1" {
        FileHandle.standardError.write(Data("--- \(debugLabel) ---\n".utf8))
        for token in tableTokens.sorted(by: {
            if abs($0.box.midY - $1.box.midY) > 0.005 { return $0.box.midY > $1.box.midY }
            return $0.box.midX < $1.box.midX
        }) {
            FileHandle.standardError.write(Data(String(
                format: "y=%.4f x=%.4f %@\n",
                token.box.midY,
                token.box.midX,
                token.text
            ).utf8))
        }
    }

    guard tableTokens.contains(where: { $0.normalized == "ORDERS TABLE" }) else {
        fail("Open the Orders Table in IBKR Desktop before using Sync Now")
    }

    let countPattern = try! NSRegularExpression(pattern: #"(OPEN|ALL)\s+ORDERS\s*\((\d+)\)"#)
    let ordersView = tableTokens.compactMap { token -> (String, Int)? in
        let value = token.normalized
        let range = NSRange(value.startIndex..<value.endIndex, in: value)
        guard let match = countPattern.firstMatch(in: value, range: range),
              let viewRange = Range(match.range(at: 1), in: value),
              let countRange = Range(match.range(at: 2), in: value),
              let count = Int(value[countRange]) else { return nil }
        return (String(value[viewRange]), count)
    }.first
    guard let ordersView else {
        fail("Select Open Orders or All Orders in the IBKR Desktop Orders Table before using Sync Now")
    }

    let quantityPattern = try! NSRegularExpression(
        pattern: #"^\d[\d,]*(?:\.\d+)?\s*/\s*\d[\d,]*(?:\.\d+)?(?:\.{3}|…)?$"#
    )
    let filledQuantityPattern = try! NSRegularExpression(
        pattern: #"^\d[\d,]*(?:\.\d+)?(?:\.{3}|…)?$"#
    )
    let symbolPattern = try! NSRegularExpression(pattern: #"^[A-Z][A-Z0-9.\-]{0,9}$"#)
    let actionTokens = tableTokens.filter { action(from: $0) != nil }
    var stopOrders: [DesktopStopOrder] = []
    var recognizedRows = 0

    for actionToken in actionTokens {
        let row = tableTokens.filter { abs($0.box.midY - actionToken.box.midY) <= 0.009 }
        let orderAction = action(from: actionToken)!
        let hasStopType = row.contains { ["STOP", "STP", "STOP LIMIT", "STP LMT"].contains($0.normalized) }
        let quantityToken = row
            .filter { $0.box.minX > actionToken.box.maxX }
            .filter { token in
                let value = token.normalized
                let range = NSRange(value.startIndex..<value.endIndex, in: value)
                return quantityPattern.firstMatch(in: value, range: range) != nil
                    || filledQuantityPattern.firstMatch(in: value, range: range) != nil
            }
            .min { $0.box.minX < $1.box.minX }
        let symbolToken = row
            .filter { token in
                guard token.box.midX < actionToken.box.midX else { return false }
                let value = normalizedSymbol(from: token)
                let range = NSRange(value.startIndex..<value.endIndex, in: value)
                return symbolPattern.firstMatch(in: value, range: range) != nil
            }
            .max { $0.box.midX < $1.box.midX }

        guard let quantityToken, let symbolToken else { continue }
        recognizedRows += 1
        guard hasStopType else { continue }

        let quantityParts = quantityToken.normalized.split(separator: "/", maxSplits: 1)
        let quantityValue = quantityParts.count == 2 ? String(quantityParts[1]) : quantityToken.normalized
        guard let quantity = number(from: quantityValue), quantity > 0 else { continue }

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

        let statusToken = row.first { ["SUBMITTED", "PRESUBMITTED", "FILLED", "CANCELLED"].contains($0.normalized) }
        guard let statusToken else { continue }
        let fillPriceToken = row
            .filter { token in
                guard let timeInForceToken,
                      token.box.minX > timeInForceToken.box.maxX,
                      token.box.maxX < statusToken.box.minX else { return false }
                return number(from: token.normalized) != nil
            }
            .min { $0.box.minX < $1.box.minX }
        let fillPrice = fillPriceToken.flatMap { number(from: $0.normalized) }

        stopOrders.append(DesktopStopOrder(
            orderId: stopOrders.count + 1,
            symbol: normalizedSymbol(from: symbolToken),
            action: orderAction,
            quantity: quantity,
            orderType: "STP",
            stopPrice: stopPrice,
            status: statusToken.normalized,
            fillPrice: fillPrice
        ))
    }

    return ParsedOrderPage(
        orders: stopOrders,
        view: ordersView.0,
        expectedRows: ordersView.1,
        recognizedRows: recognizedRows
    )
}

func totalPageCount(tokens: [TextToken]) -> Int {
    let pattern = try! NSRegularExpression(pattern: #"OF\s+(\d+)"#)
    for token in tokens {
        let value = token.normalized
        let range = NSRange(value.startIndex..<value.endIndex, in: value)
        if let match = pattern.firstMatch(in: value, range: range),
           let countRange = Range(match.range(at: 1), in: value),
           let count = Int(value[countRange]) {
            return max(1, count)
        }
    }
    return 1
}

func attribute(_ name: CFString, of element: AXUIElement) -> CFTypeRef? {
    var value: CFTypeRef?
    return AXUIElementCopyAttributeValue(element, name, &value) == .success ? value : nil
}

func paginationField(in root: AXUIElement) -> AXUIElement? {
    var pending = [root]
    while let element = pending.popLast() {
        let role = attribute(kAXRoleAttribute as CFString, of: element) as? String
        let identifier = attribute(kAXIdentifierAttribute as CFString, of: element) as? String
        if role == kAXTextFieldRole && identifier == "QApplication.mainWindow.TextField_QMLTYPE_49" {
            return element
        }
        if let children = attribute(kAXChildrenAttribute as CFString, of: element) as? [AXUIElement] {
            pending.append(contentsOf: children)
        }
    }
    return nil
}

func pageNumber(from field: AXUIElement) -> Int? {
    guard let value = attribute(kAXValueAttribute as CFString, of: field) else { return nil }
    if let number = value as? NSNumber { return number.intValue }
    if let string = value as? String { return Int(string) }
    return nil
}

func setPage(_ page: Int, field: AXUIElement) -> Bool {
    guard AXUIElementSetAttributeValue(
        field,
        kAXFocusedAttribute as CFString,
        kCFBooleanTrue
    ) == .success,
    AXUIElementSetAttributeValue(
        field,
        kAXValueAttribute as CFString,
        String(page) as CFString
    ) == .success else {
        return false
    }
    Thread.sleep(forTimeInterval: 0.12)
    let source = CGEventSource(stateID: .combinedSessionState)
    guard let keyDown = CGEvent(keyboardEventSource: source, virtualKey: 36, keyDown: true),
          let keyUp = CGEvent(keyboardEventSource: source, virtualKey: 36, keyDown: false) else {
        return false
    }
    keyDown.post(tap: .cghidEventTap)
    Thread.sleep(forTimeInterval: 0.05)
    keyUp.post(tap: .cghidEventTap)
    return true
}

func pageFingerprint(_ tokens: [TextToken]) -> String {
    tokens
        .filter { $0.box.midX < 0.63 && $0.box.midY > 0.25 && $0.box.midY < 0.83 }
        .sorted {
            if abs($0.box.midY - $1.box.midY) > 0.005 { return $0.box.midY > $1.box.midY }
            return $0.box.midX < $1.box.midX
        }
        .map(\.normalized)
        .joined(separator: "|")
}

let workspace = NSWorkspace.shared
let previousApplication = workspace.frontmostApplication
let ibkrApplication = workspace.runningApplications.first { $0.localizedName == "IBKR Desktop" }
guard let ibkrApplication else {
    fail("IBKR Desktop is not open")
}
if !ibkrApplication.isActive {
    _ = ibkrApplication.activate(options: [.activateAllWindows])
    Thread.sleep(forTimeInterval: 0.6)
}
defer {
    if let previousApplication, previousApplication != ibkrApplication {
        _ = previousApplication.activate(options: [.activateAllWindows])
    }
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

let knownSymbolWords = (argumentValue("--known-symbols")
    ?? ProcessInfo.processInfo.environment["IBKR_KNOWN_SYMBOLS"])?
    .split(separator: ",")
    .map(String.init) ?? []
let knownSymbols = Set(knownSymbolWords)
let initialTokens = captureTokens(
    windowNumber: windowNumber,
    knownSymbolWords: knownSymbolWords,
    knownSymbols: knownSymbols
)
let applicationElement = AXUIElementCreateApplication(ibkrApplication.processIdentifier)
let totalPages = totalPageCount(tokens: initialTokens)
var currentTokens = initialTokens
var originalPage = 1
var pageField: AXUIElement?

if totalPages > 1 {
    guard AXIsProcessTrusted() else {
        fail("Multi-page IBKR order sync needs Accessibility access for Trading Analyzer IBKR Reader; no stop losses were changed")
    }
    guard let foundPageField = paginationField(in: applicationElement) else {
        fail("Could not find the IBKR Desktop page selector; no stop losses were changed")
    }
    pageField = foundPageField
    originalPage = pageNumber(from: foundPageField) ?? 1
    if originalPage != 1 {
        guard setPage(1, field: foundPageField) else {
            fail("Could not return IBKR Desktop to orders page 1; no stop losses were changed")
        }
        Thread.sleep(forTimeInterval: 0.55)
        currentTokens = captureTokens(
            windowNumber: windowNumber,
            knownSymbolWords: knownSymbolWords,
            knownSymbols: knownSymbols
        )
    }
}

let firstPage = parseOrderPage(tokens: currentTokens, debugLabel: "page 1")
var pages = [firstPage]
var previousFingerprint = pageFingerprint(currentTokens)

if totalPages > 1 {
    for pageNumber in 2...totalPages {
        guard let pageField,
              setPage(pageNumber, field: pageField) else {
            fail("Could not navigate to IBKR Desktop orders page \(pageNumber); no stop losses were changed")
        }
        Thread.sleep(forTimeInterval: 0.7)
        currentTokens = captureTokens(
            windowNumber: windowNumber,
            knownSymbolWords: knownSymbolWords,
            knownSymbols: knownSymbols
        )
        let page = parseOrderPage(tokens: currentTokens, debugLabel: "page \(pageNumber)")
        let fingerprint = pageFingerprint(currentTokens)
        guard fingerprint != previousFingerprint else {
            fail("IBKR Desktop did not advance to orders page \(pageNumber); no stop losses were changed")
        }
        pages.append(page)
        previousFingerprint = fingerprint
    }

    if let pageField, originalPage != totalPages {
        if setPage(originalPage, field: pageField) {
            Thread.sleep(forTimeInterval: 0.35)
        }
    }
}

let recognizedRows = pages.reduce(0) { $0 + $1.recognizedRows }
guard recognizedRows > 0 else {
    fail("No IBKR Desktop order rows were recognized; no stop losses were changed")
}
let stopOrders = pages.flatMap(\.orders).enumerated().map { index, order in
    DesktopStopOrder(
        orderId: index + 1,
        symbol: order.symbol,
        action: order.action,
        quantity: order.quantity,
        orderType: order.orderType,
        stopPrice: order.stopPrice,
        status: order.status,
        fillPrice: order.fillPrice
    )
}

let encoder = JSONEncoder()
encoder.outputFormatting = [.sortedKeys]
let scan = DesktopOrderScan(
    orders: stopOrders,
    view: firstPage.view,
    expectedRows: firstPage.expectedRows,
    recognizedRows: recognizedRows,
    pageCount: totalPages
)
guard let output = try? encoder.encode(scan) else {
    fail("Could not encode IBKR Desktop stop orders")
}
if let outputPath {
    do {
        try output.write(to: URL(fileURLWithPath: outputPath), options: .atomic)
    } catch {
        fail("Could not write IBKR Desktop stop-order output: \(error.localizedDescription)")
    }
} else {
    FileHandle.standardOutput.write(output)
    FileHandle.standardOutput.write(Data("\n".utf8))
}
