import Foundation

struct BridgeConfig: Codable {
    let version: Int
    let plan: String
    let maxMultiplier: Int?
    let previousCommand: String?
    let snapshotPath: String
    let snapshotDirectory: String?
}

struct UsageSnapshot: Codable {
    let sourceVersion: Int
    let sessionId: String?
    let plan: String
    let maxMultiplier: Int?
    let fiveHourUsedPct: Double?
    let resetsAt: String?
    let capturedAt: String
    let stale: Bool
}

func safeFileComponent(_ value: String?) -> String {
    guard let value, !value.isEmpty else { return "unknown-session" }
    let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-_."))
    let cleaned = value.unicodeScalars.map { allowed.contains($0) ? Character(String($0)) : "_" }
    return String(cleaned.prefix(96))
}

func iso8601Now() -> String {
    ISO8601DateFormatter().string(from: Date())
}

func doubleValue(_ value: Any?) -> Double? {
    if let number = value as? NSNumber { return number.doubleValue }
    if let string = value as? String { return Double(string) }
    return nil
}

func stringValue(_ value: Any?) -> String? {
    if let string = value as? String { return string }
    if let number = value as? NSNumber { return number.stringValue }
    return nil
}

func writeAtomically<T: Encodable>(_ value: T, to path: String) {
    do {
        let destination = URL(fileURLWithPath: path)
        let directory = destination.deletingLastPathComponent()
        try FileManager.default.createDirectory(
            at: directory,
            withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700]
        )
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        let data = try encoder.encode(value)
        let temporary = directory.appendingPathComponent(".\(destination.lastPathComponent).\(UUID().uuidString).tmp")
        try data.write(to: temporary, options: .atomic)
        try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: temporary.path)
        if FileManager.default.fileExists(atPath: destination.path) {
            _ = try FileManager.default.replaceItemAt(destination, withItemAt: temporary)
        } else {
            try FileManager.default.moveItem(at: temporary, to: destination)
        }
    } catch {
        // A status-line command must never disrupt Claude Code for a telemetry write.
    }
}

func runPreviousCommand(_ command: String, input: Data) -> String? {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/bin/zsh")
    process.arguments = ["-lc", command]
    let inputPipe = Pipe()
    let outputPipe = Pipe()
    process.standardInput = inputPipe
    process.standardOutput = outputPipe
    process.standardError = FileHandle.nullDevice
    do {
        try process.run()
        inputPipe.fileHandleForWriting.write(input)
        try inputPipe.fileHandleForWriting.close()
        process.waitUntilExit()
        guard process.terminationStatus == 0 else { return nil }
        let output = outputPipe.fileHandleForReading.readDataToEndOfFile()
        let text = String(data: output, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines)
        return (text?.isEmpty == false) ? text : nil
    } catch {
        return nil
    }
}

let input = FileHandle.standardInput.readDataToEndOfFile()
let environment = ProcessInfo.processInfo.environment
let configPath = environment["CLAUDE_BURNER_CONFIG"]
    ?? NSString(string: "~/Library/Application Support/Claude Burner/bridge-config.json").expandingTildeInPath

guard
    let configData = FileManager.default.contents(atPath: configPath),
    let config = try? JSONDecoder().decode(BridgeConfig.self, from: configData)
else {
    print("🔥 Claude Burner: bridge not configured")
    exit(0)
}

var usedPercentage: Double?
var resetsAt: String?
var sessionId: String?
if
    let root = try? JSONSerialization.jsonObject(with: input) as? [String: Any]
{
    sessionId = stringValue(root["session_id"])
    if
        let rateLimits = root["rate_limits"] as? [String: Any],
        let fiveHour = rateLimits["five_hour"] as? [String: Any]
    {
        usedPercentage = doubleValue(fiveHour["used_percentage"])
        resetsAt = stringValue(fiveHour["resets_at"])
    }
}

let snapshot = UsageSnapshot(
    sourceVersion: 2,
    sessionId: sessionId,
    plan: config.plan,
    maxMultiplier: config.maxMultiplier,
    fiveHourUsedPct: usedPercentage,
    resetsAt: resetsAt,
    capturedAt: iso8601Now(),
    stale: usedPercentage == nil || resetsAt == nil
)
writeAtomically(snapshot, to: config.snapshotPath)
if let snapshotDirectory = config.snapshotDirectory {
    let sessionPath = URL(fileURLWithPath: snapshotDirectory)
        .appendingPathComponent("\(safeFileComponent(sessionId)).json")
        .path
    writeAtomically(snapshot, to: sessionPath)
}

if let previous = config.previousCommand, let output = runPreviousCommand(previous, input: input) {
    print(output)
} else if let used = usedPercentage {
    print(String(format: "🔥 Claude Burner  5h %.0f%% used", used))
} else {
    print("🔥 Claude Burner  waiting for Claude usage")
}
