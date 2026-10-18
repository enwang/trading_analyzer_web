import AppKit
import UserNotifications

let arguments = CommandLine.arguments
let enable = !arguments.contains("--notify")
let outputIndex = arguments.firstIndex(of: "--output")
let outputPath = outputIndex.flatMap { $0 + 1 < arguments.count ? arguments[$0 + 1] : nil }
    ?? (enable ? Bundle.main.bundleURL.deletingLastPathComponent().appendingPathComponent("gateway-notification-permission.json").path : nil)
let application = NSApplication.shared
application.setActivationPolicy(.accessory)
let center = UNUserNotificationCenter.current()

func finish(_ allowed: Bool, _ message: String) {
    let result: [String: Any] = ["ok": allowed, "message": message]
    if let path = outputPath, let data = try? JSONSerialization.data(withJSONObject: result) {
        try? data.write(to: URL(fileURLWithPath: path), options: .atomic)
    }
    DispatchQueue.main.asyncAfter(deadline: .now() + 1) { exit(allowed ? 0 : 1) }
}

func deliver() {
    let content = UNMutableNotificationContent()
    content.title = enable ? "Gateway 通知测试" : "IBKR Gateway 连接已断开"
    content.body = enable
        ? "这是 Trading Analyzer 的本机提醒测试，不是 IBKR 登录请求。"
        : "请在电脑打开 https://localhost:5050 手动登录。本程序未发起登录或手机授权请求。"
    content.sound = .default
    let request = UNNotificationRequest(identifier: "trading-analyzer-gateway-alert", content: content, trigger: nil)
    center.add(request) { error in
        finish(error == nil, error == nil ? "Notification scheduled" : "Notification could not be scheduled")
    }
}

center.getNotificationSettings { settings in
    if settings.authorizationStatus == .authorized {
        deliver()
    } else if enable && settings.authorizationStatus == .notDetermined {
        center.requestAuthorization(options: [.alert, .sound]) { granted, error in
            if granted && error == nil { deliver() }
            else { finish(false, "Notifications are not allowed; enable Gateway Alerts in macOS settings") }
        }
    } else {
        finish(false, "Notifications are not allowed; enable Gateway Alerts in macOS settings")
    }
}
DispatchQueue.main.asyncAfter(deadline: .now() + 45) { finish(false, "Notification permission request timed out") }
application.run()
