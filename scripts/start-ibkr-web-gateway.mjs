import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

const directory = resolve(import.meta.dirname, '../.local/clientportal')
const bundledJava = join(homedir(), 'Applications/IB Gateway 10.51/.install4j/jre.bundle/Contents/Home/bin/java')
const java = process.env.IBKR_GATEWAY_JAVA || (existsSync(bundledJava) ? bundledJava : 'java')
if (!existsSync(join(directory, 'root/conf.yaml'))) {
  throw new Error('Install Client Portal Gateway in .local/clientportal first; see docs/ibkr-api-stops.md')
}
const gateway = spawn(java, [
  '-server', '-Dvertx.disableDnsResolver=true', '-Djava.net.preferIPv4Stack=true',
  '-Dvertx.logger-delegate-factory-class-name=io.vertx.core.logging.SLF4JLogDelegateFactory',
  '-cp', 'root:dist/ibgroup.web.core.iblink.router.clientportal.gw.jar:build/lib/runtime/*',
  'ibgroup.web.core.clientportal.gw.GatewayStart', '--conf', '../root/conf.yaml',
], { cwd: directory, stdio: 'inherit' })
gateway.on('error', error => { console.error(error.message); process.exitCode = 1 })
gateway.on('exit', code => { process.exitCode = code ?? 1 })
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => gateway.kill(signal))
