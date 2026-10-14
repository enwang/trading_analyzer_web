import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
import * as splits from '../lib/ibkr/stock-splits.ts'
import * as hidden from '../lib/hidden-trades.ts'
const source=fs.readFileSync('app/api/ibkr/fetch/route.ts','utf8')
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText
const trade={symbol:'TEST',entry_time:'2026-10-08T14:00:00Z',exit_time:'2026-10-08T15:00:00Z',side:'long',entry_price:100,exit_price:102,shares:10,pnl:20,setup_tag:'untagged',r_multiple:null}
const original={...trade,stop_loss:95,current_stop_loss:null,stop_loss_locked:true,initial_risk_amount:50,r_multiple:0.4,notes:'keep my note',setup_tag:'breakout',needs_review:true,execution_legs:null}
function fixture({auth=true,snapshot=async()=>({id:'snapshot-1'}),flexError=false}={}){
 const state={fetches:0,writeRows:null,callbacks:[],queries:[],snapshotFinished:false}
 const supabase={auth:{getUser:async()=>({data:{user:auth?{id:'user-1'}:null}})},from(table){
  state.queries.push(table)
  const q={operation:'read',select(){return q},eq(){return q},in(){return q},is(){return q},not(){return q},delete(){assert.ok(state.snapshotFinished,'No deletion before backup');q.operation='delete';return q},upsert(rows){assert.ok(state.snapshotFinished,'No write before backup');q.operation='upsert';if(table==='trades')state.writeRows=rows;return q},single(){return Promise.resolve({data:{ibkr_token:'saved-token',ibkr_query_id:'saved-query'},error:null})},then(resolve,reject){return Promise.resolve({data:table==='hidden_trades'?[]:table==='trades'?(q.operation==='upsert'?[{id:'trade-1'}]:[original]):[],error:null}).then(resolve,reject)}}
  return q
 }}
 const mocks={
  '@/lib/supabase/server':{createClient:async()=>supabase},
  '@/lib/ibkr/flex':{fetchFlexAll:async(token,query)=>{assert.equal(token,'saved-token');assert.equal(query,'saved-query');state.fetches++;if(flexError)throw new Error('report failed');return {trades:[trade],navDaily:[],navChange:[],cashTransactions:[]}}},
  '@/lib/trade-snapshots':{createTradeSnapshot:async()=>{const r=await snapshot();state.snapshotFinished=true;return r},pruneOldSnapshots:async()=>{throw new Error('cleanup failed')}},
  '@/lib/ibkr/stock-splits':splits,'@/lib/hidden-trades':hidden,
  '@/lib/market/stop-loss':{usesStopLossFirstSizing:()=>true},
  'next/server':{after:callback=>state.callbacks.push(callback),NextResponse:{json:(body,options)=>({body,status:options?.status??200})}},
 }
 const module={exports:{}}
 new Function('require','module','exports',compiled)(name=>{assert.ok(mocks[name],name);return mocks[name]},module,module.exports)
 return {state,post:body=>module.exports.POST({json:async()=>body})}
}
const deferred=Promise.withResolvers()
const parallel=fixture({snapshot:()=>deferred.promise})
const pending=parallel.post({})
await new Promise(setImmediate)
assert.equal(parallel.state.fetches,1,'Flex fetch must begin while snapshot is still pending')
assert.equal(parallel.state.writeRows,null)
deferred.resolve({id:'snapshot-1'})
const result=await pending
assert.equal(result.status,200)
assert.equal(result.body.userId,'user-1')
assert.equal(result.body.upserted,1)
assert.equal(parallel.state.writeRows[0].notes,original.notes)
assert.equal(parallel.state.writeRows[0].stop_loss,original.stop_loss)
assert.equal(parallel.state.writeRows[0].setup_tag,original.setup_tag)
assert.equal(parallel.state.writeRows[0].initial_risk_amount,original.initial_risk_amount)
assert.equal(parallel.state.callbacks.length,1,'Pruning is deferred until after the response')
const denied=fixture({auth:false})
assert.equal((await denied.post({})).status,401)
assert.equal(denied.state.fetches,0)
assert.equal(denied.state.queries.length,0)
const failedBackup=fixture({snapshot:async()=>{throw new Error('backup failed')}})
assert.equal((await failedBackup.post({})).status,500)
assert.equal(failedBackup.state.writeRows,null)
const failedReport=fixture({flexError:true})
assert.equal((await failedReport.post({})).status,500)
assert.equal(failedReport.state.writeRows,null)
const partial=fixture()
assert.equal((await partial.post({token:'partial'})).status,400)
assert.equal(partial.state.fetches,0)
console.log('Sync performance checks passed: parallel report/backup, backup-before-write, saved credentials, auth isolation, metadata preservation, deferred cleanup, failure safety')
