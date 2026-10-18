import {execFileSync} from 'node:child_process'
import {mkdirSync,writeFileSync} from 'node:fs'
import {join,resolve} from 'node:path'
const project=resolve(import.meta.dirname,'..')
const app=join(project,'.local','Trading Analyzer Gateway Alerts.app')
const contents=join(app,'Contents')
mkdirSync(join(contents,'MacOS'),{recursive:true})
writeFileSync(join(contents,'Info.plist'),`<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>gateway-alert</string>
<key>CFBundleIdentifier</key><string>com.welsnake.trading-analyzer.gateway-alerts</string>
<key>CFBundleName</key><string>Trading Analyzer Gateway Alerts</string>
<key>CFBundleDisplayName</key><string>Trading Analyzer Gateway Alerts</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleVersion</key><string>1</string>
<key>LSUIElement</key><true/>
</dict></plist>`)
let sdk
try{sdk=execFileSync('/usr/bin/xcrun',['--sdk','macosx15.5','--show-sdk-path'],{encoding:'utf8'}).trim()}catch{sdk=execFileSync('/usr/bin/xcrun',['--sdk','macosx','--show-sdk-path'],{encoding:'utf8'}).trim()}
const cache=join(project,'.local','swift-module-cache')
mkdirSync(cache,{recursive:true})
execFileSync('/usr/bin/xcrun',['swiftc','-sdk',sdk,'-module-cache-path',cache,join(project,'scripts/gateway-alert.swift'),'-o',join(contents,'MacOS','gateway-alert')],{stdio:'inherit'})
execFileSync('/usr/bin/codesign',['--force','--sign','-',app],{stdio:'inherit'})
console.log('Local Gateway Alerts app installed. Run with --enable to grant permission and send a test notice.')
