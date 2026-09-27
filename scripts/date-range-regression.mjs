import { getLastMonthRange } from '../lib/date-range.ts'

function assertRange(now, expectedStart, expectedEndExclusive) {
  const actual = getLastMonthRange({
    now: new Date(now),
    timeZone: 'America/New_York',
  })
  if (actual.start !== expectedStart || actual.endExclusive !== expectedEndExclusive) {
    console.error(
      `date-range-regression: FAIL - ${now}: expected ${expectedStart}..${expectedEndExclusive}, got ${actual.start}..${actual.endExclusive}`
    )
    process.exit(1)
  }
}

// "Last Month" is a trailing calendar month through today, not the previous
// completed month. The end is exclusive so today's activity is included.
assertRange('2026-09-26T16:00:00Z', '2026-08-26', '2026-09-27')

// Month-end dates clamp to the final valid day in the prior month.
assertRange('2026-03-31T16:00:00Z', '2026-02-28', '2026-04-01')
assertRange('2024-03-31T16:00:00Z', '2024-02-29', '2024-04-01')

// The selected market timezone controls the date boundary.
assertRange('2026-09-27T02:00:00Z', '2026-08-26', '2026-09-27')

console.log('date-range-regression: PASS')
