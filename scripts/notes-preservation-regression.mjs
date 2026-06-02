/**
 * Regression tests for notes, needs_review, and setup_tag preservation during
 * sync/upload. Mirrors the exact preserveManualFields logic in all three routes:
 *   app/api/cron/sync/route.ts
 *   app/api/ibkr/fetch/route.ts
 *   app/api/trades/upload/route.ts
 *
 * Root incident: a database restore wiped all notes and needs_review flags.
 * The snapshot system (createTradeSnapshot) provides recovery. These tests
 * guard the sync-side preservation so a normal sync never strips the data.
 */

function fail(message) {
  console.error(`notes-preservation-regression: FAIL — ${message}`)
  process.exit(1)
}

// ---------------------------------------------------------------------------
// Exact replica of the preserveManualFields logic used in all three routes.
// Update this if the route logic changes.
// ---------------------------------------------------------------------------
function preserveManualFields(newRows, existingRows) {
  const normalizeTs = (t) => t ? t.slice(0, 19) : ''

  const openRowsBySymbol = new Map()
  const allRowsBySymbol = new Map()
  for (const existing of existingRows) {
    const allList = allRowsBySymbol.get(existing.symbol) ?? []
    allList.push(existing)
    allRowsBySymbol.set(existing.symbol, allList)
    if (existing.exit_time != null) continue
    const list = openRowsBySymbol.get(existing.symbol) ?? []
    list.push(existing)
    openRowsBySymbol.set(existing.symbol, list)
  }

  const byKey = new Map(
    existingRows.map(r => {
      const key = r.exit_time
        ? `${r.symbol}|${normalizeTs(r.entry_time)}|${normalizeTs(r.exit_time)}`
        : `${r.symbol}|${normalizeTs(r.entry_time)}`
      return [key, r]
    })
  )

  for (const row of newRows) {
    const key = row.exit_time
      ? `${row.symbol}|${normalizeTs(row.entry_time)}|${normalizeTs(row.exit_time)}`
      : `${row.symbol}|${normalizeTs(row.entry_time)}`
    const exactExisting = byKey.get(key)
    const symbolOpenRows = openRowsBySymbol.get(row.symbol) ?? []
    const existing = exactExisting ?? (row.exit_time == null && symbolOpenRows.length === 1 ? symbolOpenRows[0] : null)
    if (!existing) continue
    if (row.setup_tag === 'untagged' && existing.setup_tag) row.setup_tag = existing.setup_tag
    if (!row.notes && existing.notes) row.notes = existing.notes
    if (!row.needs_review && existing.needs_review) row.needs_review = existing.needs_review
    if (row.stop_loss == null && existing.stop_loss != null) row.stop_loss = existing.stop_loss
    if (existing.stop_loss_locked) row.stop_loss_locked = true
    if (row.r_multiple == null && existing.r_multiple != null) row.r_multiple = existing.r_multiple
  }

  // Safety net: search ALL rows (open and closed) for stop_loss_locked.
  // A partial exit can move a locked row from open → closed, and then the
  // key-matching loop above won't find it. Without this, the lock is silently lost.
  for (const row of newRows) {
    if (row.exit_time != null) continue
    if (row.stop_loss_locked) continue
    const allSymbolRows = allRowsBySymbol.get(row.symbol) ?? []
    const lockedRow = allSymbolRows.find(r => r.stop_loss_locked)
    if (lockedRow) {
      row.stop_loss_locked = true
      if (row.stop_loss == null && lockedRow.stop_loss != null) row.stop_loss = lockedRow.stop_loss
    }
  }

  return newRows
}

function fresh(overrides = {}) {
  return {
    symbol: 'TEST',
    entry_time: '2026-01-10T14:00:00.000Z',
    exit_time: '2026-01-15T20:00:00.000Z',
    stop_loss: null,
    r_multiple: null,
    setup_tag: 'untagged',
    notes: null,
    needs_review: false,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// 1. Closed trade: notes preserved via exact symbol|entry|exit key
// ---------------------------------------------------------------------------
{
  const existing = [
    { symbol: 'FSLY', entry_time: '2026-03-09T13:48:24.000Z', exit_time: '2026-04-10T14:26:43.000Z',
      stop_loss: null, r_multiple: null, setup_tag: 'breakout',
      notes: 'wrong 4/10 exit price, should have moved stop to low of 4/9',
      needs_review: true },
  ]
  const rows = [fresh({ symbol: 'FSLY', entry_time: '2026-03-09T13:48:24.000Z', exit_time: '2026-04-10T14:26:43.000Z', setup_tag: 'breakout' })]
  preserveManualFields(rows, existing)
  if (!rows[0].notes) fail('closed trade: notes not preserved via exact key match')
  if (!rows[0].needs_review) fail('closed trade: needs_review not preserved via exact key match')
  if (rows[0].setup_tag !== 'breakout') fail('closed trade: setup_tag not preserved')
}

// ---------------------------------------------------------------------------
// 2. Closed trade: needs_review=true preserved even when notes is empty
// ---------------------------------------------------------------------------
{
  const existing = [
    { symbol: 'CAR', entry_time: '2026-04-21T23:35:09.000Z', exit_time: '2026-04-22T15:34:27.000Z',
      stop_loss: null, r_multiple: null, setup_tag: 'momentum',
      notes: null, needs_review: true },
  ]
  const rows = [fresh({ symbol: 'CAR', entry_time: '2026-04-21T23:35:09.000Z', exit_time: '2026-04-22T15:34:27.000Z', setup_tag: 'momentum' })]
  preserveManualFields(rows, existing)
  if (!rows[0].needs_review) fail('closed trade: needs_review=true (no notes) not preserved')
}

// ---------------------------------------------------------------------------
// 3. Open trade: exact entry_time match — notes and needs_review preserved
// ---------------------------------------------------------------------------
{
  const existing = [
    { symbol: 'DELL', entry_time: '2026-04-01T19:47:45.000Z', exit_time: null,
      stop_loss: 177.00, r_multiple: null, setup_tag: 'breakout',
      notes: '177 stop loss on 2nd exit is unlucky, use more buffer',
      needs_review: false },
  ]
  const rows = [fresh({ symbol: 'DELL', entry_time: '2026-04-01T19:47:45.000Z', exit_time: null })]
  preserveManualFields(rows, existing)
  if (!rows[0].notes) fail('open trade (exact match): notes not preserved')
  if (rows[0].stop_loss !== 177.00) fail('open trade (exact match): stop_loss not preserved')
}

// ---------------------------------------------------------------------------
// 4. Open trade: entry_time off by 1 second (XML openDateTime ≠ DB stored),
//    single DB row → fallback preserves notes and needs_review
// ---------------------------------------------------------------------------
{
  const existing = [
    { symbol: 'GSAT', entry_time: '2026-04-14T14:00:00.000Z', exit_time: null,
      stop_loss: 77.77, r_multiple: null, setup_tag: 'momentum',
      notes: 'adding to position at breakout', needs_review: true },
  ]
  // Incoming row has entry_time one second later (from XML openDateTime field)
  const rows = [fresh({ symbol: 'GSAT', entry_time: '2026-04-14T14:00:01.000Z', exit_time: null })]
  preserveManualFields(rows, existing)
  if (!rows[0].notes) fail('open trade (1s mismatch, single row): notes not preserved via fallback')
  if (!rows[0].needs_review) fail('open trade (1s mismatch, single row): needs_review not preserved via fallback')
  if (rows[0].stop_loss !== 77.77) fail('open trade (1s mismatch, single row): stop_loss not preserved via fallback')
  if (rows[0].setup_tag !== 'momentum') fail('open trade (1s mismatch, single row): setup_tag not preserved via fallback')
}

// ---------------------------------------------------------------------------
// 5. Open trade: MULTIPLE existing open rows for same symbol → no fallback.
//    Neither row's metadata propagates when entry_time mismatches both.
//    This is expected: ambiguous which row owns the metadata.
// ---------------------------------------------------------------------------
{
  const existing = [
    { symbol: 'TSLA', entry_time: '2026-04-01T14:00:00.000Z', exit_time: null,
      stop_loss: 220.00, r_multiple: null, setup_tag: 'breakout',
      notes: 'initial lot', needs_review: false },
    { symbol: 'TSLA', entry_time: '2026-04-02T15:30:00.000Z', exit_time: null,
      stop_loss: 218.00, r_multiple: null, setup_tag: 'breakout',
      notes: 'add-on lot', needs_review: false },
  ]
  // New row from XML — entry_time doesn't match either DB row
  const rows = [fresh({ symbol: 'TSLA', entry_time: '2026-04-01T14:00:01.000Z', exit_time: null })]
  preserveManualFields(rows, existing)
  // No fallback when multiple open rows exist — this is documented behavior
  if (rows[0].notes) fail('open trade (multiple rows, mismatch): should NOT carry over notes when ambiguous')
}

// ---------------------------------------------------------------------------
// 6. Existing notes do NOT overwrite notes the new row already has.
//    User may have updated notes in the DB since last parse.
// ---------------------------------------------------------------------------
{
  const existing = [
    { symbol: 'SLV', entry_time: '2026-01-30T16:08:32.000Z', exit_time: '2026-02-02T17:10:34.000Z',
      stop_loss: null, r_multiple: null, setup_tag: 'short',
      notes: 'old note from DB', needs_review: false },
  ]
  const rows = [fresh({ symbol: 'SLV', entry_time: '2026-01-30T16:08:32.000Z', exit_time: '2026-02-02T17:10:34.000Z',
    notes: 'new note already set on incoming row' })]
  preserveManualFields(rows, existing)
  if (rows[0].notes !== 'new note already set on incoming row') {
    fail('should not overwrite notes that the incoming row already has')
  }
}

// ---------------------------------------------------------------------------
// 7. New row has needs_review=true → existing needs_review=false does NOT
//    overwrite it. (Preserving a review flag the user just set.)
// ---------------------------------------------------------------------------
{
  const existing = [
    { symbol: 'PRIM', entry_time: '2026-01-09T15:17:07.000Z', exit_time: '2026-02-04T17:31:20.000Z',
      stop_loss: null, r_multiple: null, setup_tag: 'untagged',
      notes: null, needs_review: false },
  ]
  const rows = [fresh({ symbol: 'PRIM', entry_time: '2026-01-09T15:17:07.000Z', exit_time: '2026-02-04T17:31:20.000Z',
    needs_review: true })]
  preserveManualFields(rows, existing)
  if (!rows[0].needs_review) fail('incoming needs_review=true should not be overwritten by existing=false')
}

// ---------------------------------------------------------------------------
// 8. Trade not in existingRows → fields stay as parsed (no crash, no bleed)
// ---------------------------------------------------------------------------
{
  const rows = [fresh({ symbol: 'NEW', entry_time: '2026-05-01T14:00:00.000Z', exit_time: '2026-05-02T14:00:00.000Z' })]
  preserveManualFields(rows, [])
  if (rows[0].notes !== null) fail('brand new trade should have null notes after preserve pass')
  if (rows[0].needs_review !== false) fail('brand new trade should have needs_review=false after preserve pass')
}

// ---------------------------------------------------------------------------
// 9. stop_loss_locked safety net: locked row is CLOSED (partial exit moved it
//    from open → closed). New open row from parser has a different key, so the
//    main loop doesn't match. Safety net must carry the lock via allRowsBySymbol.
//    Root incident: COHR / ARM / ORCL stop losses wiped by manual sync because
//    the safety net only searched openRowsBySymbol, missing the closed locked row.
// ---------------------------------------------------------------------------
{
  const existing = [
    // The locked row is now CLOSED (e.g., a partial exit was recorded with an exit_time)
    { symbol: 'ARM', entry_time: '2026-05-01T14:00:00.000Z', exit_time: '2026-05-15T18:00:00.000Z',
      stop_loss: 125.50, stop_loss_locked: true, r_multiple: null, setup_tag: 'breakout',
      notes: null, needs_review: false },
  ]
  // New incoming open row — key won't match the closed DB row
  const rows = [{ ...fresh({ symbol: 'ARM', entry_time: '2026-05-20T14:00:00.000Z', exit_time: null }),
    stop_loss: null, stop_loss_locked: false }]
  preserveManualFields(rows, existing)
  if (!rows[0].stop_loss_locked) fail('stop_loss_locked safety net: lock not carried from closed row to new open row')
  if (rows[0].stop_loss !== 125.50) fail(`stop_loss_locked safety net: stop_loss not carried from closed row, got ${rows[0].stop_loss}`)
}

// ---------------------------------------------------------------------------
// 10. stop_loss_locked safety net: when the lock IS carried via the main loop
//     (exact key match on an open row), the safety net should not double-apply.
// ---------------------------------------------------------------------------
{
  const existing = [
    { symbol: 'ORCL', entry_time: '2026-05-10T14:00:00.000Z', exit_time: null,
      stop_loss: 175.00, stop_loss_locked: true, r_multiple: null, setup_tag: 'momentum',
      notes: null, needs_review: false },
  ]
  const rows = [{ ...fresh({ symbol: 'ORCL', entry_time: '2026-05-10T14:00:00.000Z', exit_time: null }),
    stop_loss: null, stop_loss_locked: false }]
  preserveManualFields(rows, existing)
  if (!rows[0].stop_loss_locked) fail('stop_loss_locked: lock not preserved via exact key match on open row')
  if (rows[0].stop_loss !== 175.00) fail(`stop_loss_locked: stop_loss not preserved via exact key match, got ${rows[0].stop_loss}`)
}

console.log('notes-preservation-regression: PASS')
