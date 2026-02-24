import fs from 'fs'

const csv = fs.readFileSync('mytrade.csv', 'utf8')
const lines = csv.split('\n').filter(l => l.trim())
const headers = lines[0].split(',').map(h => h.replace(/"/g, '').trim().toLowerCase())

const getIdx = (...names) => {
  for (const n of names) {
    const i = headers.indexOf(n.toLowerCase())
    if (i >= 0) return i
  }
  return -1
}

const parseRow = (line) => {
  const cols = []
  let inQuote = false, cur = ''
  for (const ch of line) {
    if (ch === '"') { inQuote = !inQuote }
    else if (ch === ',' && !inQuote) { cols.push(cur); cur = '' }
    else cur += ch
  }
  cols.push(cur)
  return cols
}

const iOci = getIdx('open/closeindicator')
const iSym = getIdx('symbol')
const iDt  = getIdx('datetime')
const iPnl = getIdx('fifopnlrealized')
const iComm = getIdx('ibcommission')

const rows = lines.slice(1).map(parseRow)

const seen = new Map()
const dups = []

rows.forEach((row, i) => {
  const oci = (row[iOci] || '').replace(/"/g, '').toUpperCase()
  if (!oci.includes('C')) return

  const sym     = (row[iSym]  || '').replace(/"/g, '').trim()
  const exitTime = (row[iDt]  || '').replace(/"/g, '').trim()
  const fifoPnl  = parseFloat((row[iPnl]  || '0').replace(/"/g, ''))
  const comm     = parseFloat((row[iComm] || '0').replace(/"/g, ''))
  const pnl      = Math.round((fifoPnl + comm) * 1000) / 1000

  const key = `${sym}|${exitTime}|${pnl}`
  if (seen.has(key)) {
    dups.push({ key, line1: seen.get(key) + 2, line2: i + 2 })
  } else {
    seen.set(key, i)
  }
})

if (dups.length) {
  console.log('DUPLICATE DEDUP KEYS IN CSV:')
  dups.forEach(d => console.log(' ', d.key, '→ lines', d.line1, '&', d.line2))
} else {
  console.log('No duplicate dedup keys found in CSV')
}
console.log('Total C-rows checked:', [...rows.filter(r => (r[iOci]||'').replace(/"/g,'').toUpperCase().includes('C'))].length)
