// Checks that every translation key used in the web app exists, and has non-empty English and Hindi text.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('../web/src', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const files = []
const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); statSync(p).isDirectory() ? walk(p) : /\.(tsx?|ts)$/.test(f) && files.push(p) } }
walk(root)

const src = files.filter((f) => !f.endsWith('strings.ts')).map((f) => readFileSync(f, 'utf8')).join('\n')
const strings = readFileSync(join(root, 'lib/strings.ts'), 'utf8')
const defined = new Set([...strings.matchAll(/^\s*'?([A-Za-z0-9_.]+)'?:\s*\[/gm)].map((m) => m[1]))

const used = new Set()
for (const m of src.matchAll(/\bt\(\s*'([^']+)'/g)) used.add(m[1])
// keys stored in arrays/objects and later passed to t(): any quoted token with a known key prefix
for (const m of src.matchAll(/'((?:step|tab|aud|col|shot|cmp|kpi|filter|label|gear|tl|rail|help)_[a-z_]+)'/g)) used.add(m[1])
// dynamic prefixes
for (const [prefix, vals] of Object.entries({
  'type.': ['phone', 'laptop', 'tablet', 'charger', 'crt_monitor', 'lcd_monitor', 'router', 'set_top_box'],
  'mat.': ['copper', 'aluminium', 'steel', 'plastic', 'glass', 'pcb', 'battery_li'],
  'flag.': ['duplicate_photo', 'weight_outlier', 'gps_far', 'low_safety', 'rapid_repeat', 'recheck_requested'],
  'status.': ['open', 'listed', 'sold', 'held'],
  'diff.': ['easy', 'medium', 'hard'],
  'role.': ['worker', 'recycler', 'repairer', 'auditor'],
  'bid.': ['open', 'accepted', 'rejected', 'expired'],
  'approval.': ['pending', 'approved', 'rejected'],
  'ob_role_': ['worker_d', 'recycler_d', 'repairer_d'],
  'issue.': ['cracked_screen', 'swollen_battery', 'corrosion_or_water', 'missing_parts', 'heavy_wear', 'burn_marks'],
  'pc_desc_': ['A', 'B', 'C', 'D'],
  'fair_': ['within', 'below', 'above'],
  'flag_why.': ['duplicate_photo', 'weight_outlier', 'gps_far', 'low_safety', 'rapid_repeat', 'recheck_requested'],
})) for (const v of vals) used.add(prefix + v)

for (const k of ['none','recheck','held','listed','open','sold']) { used.add('next_'+k+'_t'); used.add('next_'+k+'_b') }
for (const k of ['low','mid','high']) used.add('conf_'+k)
for (const k of ['top','under','back','label']) used.add('shot_'+k+'_help')
for (const k of ['normal','large','xlarge']) used.add('text_'+k)
const missing = [...used].filter((k) => !/[._]$/.test(k) && !defined.has(k))
const empty = [...strings.matchAll(/'?([A-Za-z0-9_.]+)'?:\s*\[\s*'\s*'|,\s*'\s*'\s*\]/g)]

// Extra languages live in strings.<code>.ts as Record<string, string>. Each must cover every defined key, keep the same {placeholders}, and add no unknown keys.
const placeholders = (t) => [...t.matchAll(/\{[a-z]+\}/g)].map((m) => m[0]).sort().join(',')
const enText = {}
for (const m of strings.matchAll(/^\s*(?:'([A-Za-z0-9_.]+)'|([A-Za-z0-9_]+)):\s*\[\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")/gm)) enText[m[1] ?? m[2]] = m[3] ?? m[4]
let langProblems = 0
for (const code of ['bn', 'ta', 'te', 'mr', 'gu']) {
  const text = readFileSync(join(root, `lib/strings.${code}.ts`), 'utf8')
  const have = new Map()
  for (const m of text.matchAll(/^\s*(?:'([A-Za-z0-9_.]+)'|([A-Za-z0-9_]+)):\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")/gm)) have.set(m[1] ?? m[2], m[3] ?? m[4])
  const lack = [...defined].filter((k) => !have.has(k))
  const extra = [...have.keys()].filter((k) => !defined.has(k))
  const bad = [...have].filter(([k, v]) => !v.trim() || (enText[k] !== undefined && placeholders(v) !== placeholders(enText[k]))).map(([k]) => k)
  console.log(`${code}: ${have.size} strings` + (lack.length ? `, MISSING ${lack.join(', ')}` : '') + (extra.length ? `, UNKNOWN ${extra.join(', ')}` : '') + (bad.length ? `, BAD PLACEHOLDERS/EMPTY ${bad.join(', ')}` : ''))
  langProblems += lack.length + extra.length + bad.length
}

console.log(`keys defined: ${defined.size}, keys used: ${used.size}`)
console.log(missing.length ? `MISSING: ${missing.join(', ')}` : 'No missing keys.')
if (empty.length) console.log('EMPTY strings found')
process.exit(missing.length || langProblems ? 1 : 0)
