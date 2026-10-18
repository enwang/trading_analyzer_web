import assert from 'node:assert/strict'
import {createGatewaySessionMaintainer} from '../lib/ibkr/gateway-session.mjs'
import {requestWebJson} from '../lib/ibkr/web-stop-orders.mjs'
import {createGatewayDisconnectAlerts} from '../lib/ibkr/gateway-notifications.mjs'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
const env={IBKR_WEB_API_URL:'https://localhost:5050/v1/api'}
let calls=[]
const healthy=createGatewaySessionMaintainer(env,async (url,options)=>{
  assert.equal(options.timeoutMs,1500,'Authentication probe must have a short deadline')
  calls.push({path:url.pathname,method:options.method??'GET'})
  return {iserver:{authStatus:{authenticated:true,connected:true,competing:false}}}
})
await Promise.all([healthy(),healthy()])
assert.deepEqual(calls,[{path:'/v1/api/tickle',method:'GET'}])
assert.equal(healthy.state().autoReconnect,false)
for(const status of [{authenticated:false,connected:false},{authenticated:false,connected:true},{authenticated:true,connected:true,competing:true}]){
  calls=[]
  const offline=createGatewaySessionMaintainer(env,async url=>{calls.push(url.pathname);return {ssoExpires:500000,iserver:{authStatus:status}}})
  await assert.rejects(offline())
  await assert.rejects(offline())
  assert.deepEqual(calls,['/v1/api/tickle','/v1/api/tickle'],'Disconnected sessions must only send heartbeats, never recovery requests')
}
for(const endpoint of ['/iserver/account/U1/orders','/iserver/auth/ssodh/init','/iserver/reauthenticate']){
  assert.throws(()=>requestWebJson(new URL(env.IBKR_WEB_API_URL+endpoint),{method:'POST',body:{publish:true,compete:false}}),/prohibited/)
}
const temporary=await mkdtemp(join(tmpdir(),'gateway-alert-test-'))
try{
  let sent=0
  const path=join(temporary,'state.json')
  let alerts=createGatewayDisconnectAlerts(async()=>{sent++},path)
  await alerts(true)
  await Promise.all([alerts(false),alerts(false)])
  assert.equal(sent,1)
  alerts=createGatewayDisconnectAlerts(async()=>{sent++},path)
  await alerts(false)
  assert.equal(sent,1,'No duplicate alert after bridge restart')
  await alerts(true)
  await alerts(false)
  assert.equal(sent,2,'Notify again only after recovery and another outage')
  const failed=createGatewayDisconnectAlerts(async()=>{throw new Error('permission denied')},join(temporary,'denied.json'))
  await assert.rejects(failed(false),/permission denied/)
  assert.equal(failed.state().error,'permission denied')
}finally{await rm(temporary,{recursive:true,force:true})}
console.log('Gateway tests passed: heartbeats only, no automatic authentication, no broker writes, one notification per outage')
