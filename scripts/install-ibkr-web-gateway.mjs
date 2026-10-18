import {execFileSync} from 'node:child_process'
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs'
import {homedir} from 'node:os'
import {join,resolve} from 'node:path'
const project=resolve(import.meta.dirname,'..')
const label='com.welsnake.trading-analyzer.ibkr-web-gateway'
const directory=join(homedir(),'Library','LaunchAgents')
const path=join(directory,label+'.plist')
if(!existsSync(join(project,'.local/clientportal/root/conf.yaml')))throw new Error('Client Portal Gateway is not installed')
const xml=value=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;')
mkdirSync(directory,{recursive:true})
writeFileSync(path,`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array><string>${xml(process.execPath)}</string><string>${xml(join(project,'scripts/start-ibkr-web-gateway.mjs'))}</string></array>
<key>WorkingDirectory</key><string>${xml(project)}</string>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
<key>ThrottleInterval</key><integer>30</integer>
<key>StandardOutPath</key><string>/tmp/trading-analyzer-ibkr-web-gateway.log</string>
<key>StandardErrorPath</key><string>/tmp/trading-analyzer-ibkr-web-gateway.error.log</string>
</dict></plist>`,{mode:0o600})
const domain=`gui/${process.getuid()}`
try{execFileSync('/bin/launchctl',['bootout',domain+'/'+label],{stdio:'ignore'})}catch{}
// Replace only this project's manually started Gateway, never another listener.
const config=readFileSync(join(project,'.local/clientportal/root/conf.yaml'),'utf8')
const port=config.match(/listenPort:\s*(\d+)/)?.[1]
if(!port)throw new Error('Gateway listen port is missing')
let listener=''
try{listener=execFileSync('/usr/sbin/lsof',['-t','-iTCP:'+port,'-sTCP:LISTEN'],{encoding:'utf8'}).trim()}catch(error){if(error.status!==1)throw error}
for(const pid of [...new Set(listener.split(/\s+/).filter(Boolean))]){
  const command=execFileSync('/bin/ps',['-p',pid,'-o','command='],{encoding:'utf8'})
  const cwd=execFileSync('/usr/sbin/lsof',['-a','-p',pid,'-d','cwd','-Fn'],{encoding:'utf8'})
  if(!command.includes('ibgroup.web.core.clientportal.gw.GatewayStart')
    || !cwd.split('\n').includes('n'+join(project,'.local/clientportal'))){
    throw new Error('Gateway port is occupied by another process; leaving it untouched')
  }
  process.kill(Number(pid),'SIGTERM')
}
// Allow the old process to release its socket before launchd starts the replacement.
if(listener)Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,1000)
execFileSync('/bin/launchctl',['bootstrap',domain,path])
console.log('Gateway background service installed; starts at macOS user login and restarts after process exit. Manual IBKR authentication is still required when expired.')
