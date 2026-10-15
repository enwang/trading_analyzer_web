// Hydration guard: reading Web Storage (sessionStorage/localStorage) inside a
// useState lazy initializer makes the client's first render diverge from the
// server render (the server has no storage), so React throws the page away
// and re-renders it entirely on the client — a steep, easy-to-miss slowdown
// on heavy pages. This regression test scans every component for the pattern.
// Storage reads belong in useEffect (after mount) instead.
//
// Run: npm run test:hydration-guard-regression

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))

function isStorageAccess(node) {
  // Matches `sessionStorage`, `localStorage`, `window.sessionStorage`, etc.
  if (ts.isIdentifier(node)) {
    return node.text === 'sessionStorage' || node.text === 'localStorage'
  }
  if (ts.isPropertyAccessExpression(node)) {
    return node.name.text === 'sessionStorage' || node.name.text === 'localStorage'
  }
  return false
}

function findStorageInInitializer(fnNode) {
  let found = null
  const visit = (node) => {
    if (found) return
    if (isStorageAccess(node)) {
      found = node
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(fnNode)
  return found
}

// Returns [{ line, text }] for every useState lazy initializer that reads
// Web Storage. Only function-form initializers run during the first render,
// so plain-value useState calls are fine.
export function findViolations(sourceText, fileName) {
  const sourceFile = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const violations = []
  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression
      const isUseState =
        (ts.isIdentifier(callee) && callee.text === 'useState') ||
        (ts.isPropertyAccessExpression(callee) && callee.name.text === 'useState')
      const init = node.arguments[0]
      if (isUseState && init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) {
        const bad = findStorageInInitializer(init)
        if (bad) {
          const { line } = sourceFile.getLineAndCharacterOfPosition(bad.getStart())
          violations.push({ line: line + 1, text: bad.getText() })
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return violations
}

function fail(message) {
  console.error(`hydration-guard-regression: FAIL - ${message}`)
  process.exit(1)
}

// --- Self-test: the checker must catch the bad pattern and allow good ones.
const BAD = `
  const [month, setMonth] = useState(() => {
    try { return window.sessionStorage.getItem('analysis-month') } catch { return null }
  })
`
if (findViolations(BAD, 'bad.tsx').length !== 1) {
  fail('self-test: storage read inside a useState initializer was not flagged')
}

const GOOD = `
  const [month, setMonth] = useState(null)
  useEffect(() => {
    try { setMonth(window.sessionStorage.getItem('analysis-month')) } catch {}
  }, [])
`
if (findViolations(GOOD, 'good.tsx').length !== 0) {
  fail('self-test: storage read inside useEffect was wrongly flagged')
}

// --- Scan the real components.
function collectTsxFiles(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) out.push(...collectTsxFiles(path))
    else if (entry.endsWith('.tsx')) out.push(path)
  }
  return out
}

const files = [
  ...collectTsxFiles(join(repoRoot, 'components')),
  ...collectTsxFiles(join(repoRoot, 'app')),
]
for (const file of files) {
  const violations = findViolations(readFileSync(file, 'utf8'), file)
  for (const v of violations) {
    fail(`${file.replace(repoRoot, '')}:${v.line} reads ${v.text} inside a useState initializer — move it into useEffect to avoid a hydration re-render`)
  }
}

console.log(`hydration-guard-regression: PASS (scanned ${files.length} tsx files)`)
