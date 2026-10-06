import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const label = 'com.welsnake.trading-analyzer.ibkr-stop-bridge'
const projectDir = resolve(process.cwd())
const agentsDir = join(homedir(), 'Library', 'LaunchAgents')
const plistPath = join(agentsDir, `${label}.plist`)
const helperApp = join(homedir(), 'Applications', 'Trading Analyzer IBKR Reader.app')
const helperContents = join(helperApp, 'Contents')
const helperDir = join(helperContents, 'MacOS')
const helperPath = join(helperDir, 'ibkr-desktop-orders')
const uid = process.getuid?.()

function compatibleMacOsSdk() {
  for (const sdk of ['macosx15.5', 'macosx15.4', 'macosx']) {
    try {
      return execFileSync('/usr/bin/xcrun', ['--sdk', sdk, '--show-sdk-path'], { encoding: 'utf8' }).trim()
    } catch {}
  }
  throw new Error('Could not locate a compatible macOS SDK')
}

function xml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(process.execPath)}</string>
    <string>--env-file=.env.local</string>
    <string>--experimental-strip-types</string>
    <string>scripts/ibkr-stop-bridge.mjs</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${xml(projectDir)}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/tmp/trading-analyzer-ibkr-stop-bridge.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/trading-analyzer-ibkr-stop-bridge.error.log</string>
</dict>
</plist>
`

if (uid == null) throw new Error('Could not determine the current macOS user')
mkdirSync(agentsDir, { recursive: true })
mkdirSync(helperDir, { recursive: true })
writeFileSync(join(helperContents, 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key>
  <string>ibkr-desktop-orders</string>
  <key>CFBundleIdentifier</key>
  <string>com.welsnake.trading-analyzer.ibkr-reader</string>
  <key>CFBundleName</key>
  <string>Trading Analyzer IBKR Reader</string>
  <key>CFBundleDisplayName</key>
  <string>Trading Analyzer IBKR Reader</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>1.0</string>
  <key>CFBundleVersion</key>
  <string>1</string>
  <key>LSUIElement</key>
  <true/>
</dict>
</plist>
`)
const moduleCache = join(tmpdir(), 'trading-analyzer-swift-module-cache')
mkdirSync(moduleCache, { recursive: true })
execFileSync('/usr/bin/xcrun', [
  'swiftc',
  '-sdk',
  compatibleMacOsSdk(),
  '-O',
  join(projectDir, 'scripts', 'ibkr-desktop-orders.swift'),
  '-o',
  helperPath,
], {
  env: {
    ...process.env,
    CLANG_MODULE_CACHE_PATH: moduleCache,
    SWIFT_MODULE_CACHE_PATH: moduleCache,
  },
})
try {
  execFileSync('launchctl', ['bootout', `gui/${uid}`, plistPath], { stdio: 'ignore' })
} catch {}
writeFileSync(plistPath, plist)
execFileSync('launchctl', ['bootstrap', `gui/${uid}`, plistPath])
console.log(`Installed and started ${label}`)
