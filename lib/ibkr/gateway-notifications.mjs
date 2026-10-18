import {execFile} from 'node:child_process'
import {mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {promisify} from 'node:util'
const execFileAsync=promisify(execFile)
const project=resolve(import.meta.dirname,'../..')
export async function sendGatewayDisconnectNotification() {
  if(process.platform!=='darwin')throw new Error('Native Gateway alerts currently require macOS')
  const temporary=await mkdtemp(join(tmpdir(),'trading-analyzer-gateway-alert-'))
  const output=join(temporary,'result.json')
  try{
    await execFileAsync('/usr/bin/open',['-W','-n',join(project,'.local','Trading Analyzer Gateway Alerts.app'),'--args','--notify','--output',output],{timeout:10000})
    const result=JSON.parse(await readFile(output,'utf8'))
    if(!result.ok)throw new Error(result.message)
  }finally{await rm(temporary,{recursive:true,force:true})}
}

// One notification per outage, persisted across stop-bridge restarts.
export function createGatewayDisconnectAlerts(send=sendGatewayDisconnectNotification, statePath=join(project,'.local','gateway-alert-state.json')) {
  let pending=Promise.resolve()
  let noticeError=null
  const observe=healthy=>{
    pending=pending.catch(()=>{}).then(async()=>{
      let state={notified:false}
      try{state=JSON.parse(await readFile(statePath,'utf8'))}catch{}
      if(healthy){
        noticeError=null
        if(!state.notified)return
        state={notified:false}
      }else{
        if(state.notified)return
        try{await send();noticeError=null}catch(error){noticeError=error instanceof Error?error.message:String(error);throw error}
        state={notified:true,notifiedAt:new Date().toISOString()}
      }
      await mkdir(resolve(statePath,'..'),{recursive:true})
      await writeFile(statePath,JSON.stringify(state),{mode:0o600})
    })
    return pending
  }
  observe.state=()=>({error:noticeError})
  return observe
}
