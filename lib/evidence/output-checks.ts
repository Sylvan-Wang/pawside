/**
 * Pawside Coach — deterministic output checks (spec A0-1).
 *
 * ONE implementation shared by every AI surface through composeWithEvidence.
 * Before this module, the numeric-integrity check existed three times
 * (`lib/nutrition/interpretation.ts#findUntraceableNumbers`,
 * `lib/evidence/interpret.ts#validateNumericIntegrity`, and an inline copy in
 * `composer.ts`) and forbidden-claim / evidence-id / status-escalation checks
 * did not exist at all. This file is the single place all of it lives; the
 * other two implementations are retired (docs/coach/HANDOFF.md §3).
 *
 * Pure functions, no I/O, no provider calls.
 */

export interface FactLike {
  metric_key: string
  value: number | null
  unit?: string | null
}

export interface SignalLike {
  metric_key: string
  status: string
  evidence_ref_ids: string[]
}

export interface RegistryLike {
  /** evidence_id -> forbidden claim strings */
  forbiddenClaims: Map<string, string[]>
  /** all known evidence ids */
  ids: Set<string>
  /** claims forbidden regardless of evidence id (product-wide guardrails, MUST 3.9) */
  globalForbidden?: string[]
}

export type CheckFailure =
  | { code: 'unresolved_placeholder'; detail: string[] }
  | { code: 'bare_number'; detail: string[] }
  | { code: 'untraceable_number'; detail: string[] }
  | { code: 'forbidden_claim'; detail: string[] }
  | { code: 'unknown_evidence_id'; detail: string[] }
  | { code: 'status_escalated'; detail: string[] }
  | { code: 'invalid_action'; detail: string[] }

export interface CheckResult {
  ok: boolean
  failures: CheckFailure[]
}

/* ------------------------------------------------------------------------- */
/* User-facing string collection                                              */
/* ------------------------------------------------------------------------- */

/** Machine fields whose strings are never shown to the user. */
export const MACHINE_TEXT_KEYS = new Set([
  'evidence_ref_ids', 'signal_key', 'metric_key', 'status',
  'domain', 'basis', 'direction', 'level', 'chosen_proposal_id', 'action_type',
])

export function collectUserFacingStrings(value: unknown, out: string[] = [], parentKey: string | null = null): string[] {
  if (typeof value === 'string') {
    if (!parentKey || !MACHINE_TEXT_KEYS.has(parentKey)) out.push(value)
    return out
  }
  if (Array.isArray(value)) {
    for (const item of value) collectUserFacingStrings(item, out, parentKey)
    return out
  }
  if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      collectUserFacingStrings(item, out, key)
    }
  }
  return out
}

/* ------------------------------------------------------------------------- */
/* 1. Numeric integrity — free-number mode (today's v1/v2/v3 prompts)         */
/* ------------------------------------------------------------------------- */
/*
 * The model writes the number itself, and every number it writes must trace
 * back to a supplied fact (or an explicitly allowed extra number, e.g. a plan
 * target that is not a MetricFact). This is the canonical replacement for the
 * three duplicated implementations named above.
 */

export function findUntraceableNumbers(text: string, allowedValues: Array<number | null | undefined>): string[] {
  const allowed = new Set<string>()
  for (const value of allowedValues) {
    if (value === null || value === undefined || !Number.isFinite(value)) continue
    allowed.add(String(value))
    allowed.add(String(Math.round(value)))
    allowed.add(String(Math.round(value * 10) / 10))
    allowed.add(value.toFixed(1))
  }
  const found = text.match(/\d+(?:\.\d+)?/g) ?? []
  return found.filter((token) => !allowed.has(token))
}

/** Convenience guard: true when every number in `text` traces back to an allowed value. */
export function hasTraceableNumbers(text: string, allowedValues: Array<number | null | undefined>): boolean {
  return findUntraceableNumbers(text, allowedValues).length === 0
}

/** Every untraceable number across every user-facing string in `output`. */
export function findUntraceableNumbersInOutput(output: unknown, allowedValues: Array<number | null | undefined>): string[] {
  const found: string[] = []
  for (const text of collectUserFacingStrings(output)) {
    for (const token of findUntraceableNumbers(text, allowedValues)) {
      if (!found.includes(token)) found.push(token)
    }
  }
  return found
}

/* ------------------------------------------------------------------------- */
/* 2. Numeric integrity — placeholder mode (spec A0-4 prompts, `{{metric_key}}`) */
/* ------------------------------------------------------------------------- */
/*
 * The model writes {{metric_key}} instead of digits. The server substitutes
 * the fact value + unit. Numbers can therefore only come from facts.
 *
 *   "今天蛋白还差 {{nutrition.protein_remaining}}"  ->  "今天蛋白还差 42 g"
 */

const PLACEHOLDER = /\{\{\s*([a-z0-9_.]+)\s*\}\}/gi

export function formatFact(fact: FactLike): string {
  if (fact.value === null || !Number.isFinite(fact.value)) return ''
  const value = Number.isInteger(fact.value) ? String(fact.value) : String(Math.round(fact.value * 10) / 10)
  return fact.unit ? `${value} ${fact.unit}` : value
}

export function renderPlaceholders(text: string, facts: FactLike[]): { text: string; unresolved: string[] } {
  const byKey = new Map(facts.map((fact) => [fact.metric_key, fact]))
  const unresolved: string[] = []
  const rendered = text.replace(PLACEHOLDER, (_match, key: string) => {
    const fact = byKey.get(key)
    const formatted = fact ? formatFact(fact) : ''
    if (!formatted) {
      unresolved.push(key)
      return ''
    }
    return formatted
  })
  return { text: rendered, unresolved }
}

/** Deep-renders every user-facing string in a model output object. */
export function renderOutput<T>(output: T, facts: FactLike[]): { output: T; unresolved: string[] } {
  const unresolved: string[] = []
  const walk = (value: unknown, key?: string): unknown => {
    if (typeof value === 'string') {
      if (key && MACHINE_TEXT_KEYS.has(key)) return value
      const rendered = renderPlaceholders(value, facts)
      unresolved.push(...rendered.unresolved)
      return rendered.text
    }
    if (Array.isArray(value)) return value.map((item) => walk(item, key))
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([itemKey, item]) => [itemKey, walk(item, itemKey)]))
    }
    return value
  }
  return { output: walk(output) as T, unresolved }
}

/**
 * Placeholder-mode pre-check: the raw model output must contain no bare
 * digits in user-facing text. Digits inside {{...}} are keys, not numbers,
 * and are stripped before scanning. Fullwidth digits are normalised first.
 */
export function findBareNumbers(rawOutput: unknown): string[] {
  const hits: string[] = []
  for (const text of collectUserFacingStrings(rawOutput)) {
    const stripped = text
      .replace(PLACEHOLDER, '')
      .replace(/[０-９]/g, (digit) => String.fromCharCode(digit.charCodeAt(0) - 0xfee0))
    const matches = stripped.match(/\d+(?:\.\d+)?/g)
    if (matches) hits.push(...matches)
  }
  return hits
}

/* ------------------------------------------------------------------------- */
/* 3. Forbidden claims (registry forbidden_claims enforced on output)          */
/* ------------------------------------------------------------------------- */

const normalise = (value: string) => value.replace(/\s+/g, '').toLowerCase()

/** "官方规定你必须吃 XXg" -> matches "官方规定你必须吃120g" as well. */
const NUM_SENTINEL = '\u0000'
function claimToRegex(claim: string): RegExp {
  // Only UPPERCASE X / XX / XXX are wildcards; lowercase x in English words
  // ("exact") must stay literal. Mark them before lowercasing.
  const marked = claim.replace(/X{1,3}/g, NUM_SENTINEL)
  const escaped = normalise(marked).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(escaped.split(NUM_SENTINEL).join('\\d+(?:\\.\\d+)?'))
}

/**
 * Checks against claims of the evidence ids actually in play (signals sent to
 * the model) plus product-wide guardrails (MUST 3.9). Deliberately NOT all
 * claims in the registry: a claim forbidden for one evidence entry could be a
 * legitimate phrase elsewhere.
 */
export function findForbiddenClaims(renderedOutput: unknown, signals: SignalLike[], registry: RegistryLike): string[] {
  const claims = new Set<string>(registry.globalForbidden ?? [])
  for (const signal of signals) {
    for (const id of signal.evidence_ref_ids) {
      for (const claim of registry.forbiddenClaims.get(id) ?? []) claims.add(claim)
    }
  }
  const text = normalise(collectUserFacingStrings(renderedOutput).join('\n'))
  return [...claims].filter((claim) => claimToRegex(claim).test(text))
}

/* ------------------------------------------------------------------------- */
/* 4. Evidence ids in the output must exist and must have been supplied        */
/* ------------------------------------------------------------------------- */

export function findUnknownEvidenceIds(output: unknown, signals: SignalLike[], registry: RegistryLike): string[] {
  const supplied = new Set(signals.flatMap((signal) => signal.evidence_ref_ids))
  const bad: string[] = []
  const walk = (value: unknown, key?: string) => {
    if (key === 'evidence_ref_ids' && Array.isArray(value)) {
      for (const id of value) {
        if (typeof id !== 'string' || !registry.ids.has(id) || !supplied.has(id)) bad.push(String(id))
      }
      return
    }
    if (Array.isArray(value)) value.forEach((item) => walk(item, key))
    else if (value && typeof value === 'object') Object.entries(value).forEach(([itemKey, item]) => walk(item, itemKey))
  }
  walk(output)
  return bad
}

/* ------------------------------------------------------------------------- */
/* 5. The model may not make a judgement stronger than the rule did           */
/* ------------------------------------------------------------------------- */

const NON_JUDGEMENT = new Set(['not_assessable', 'insufficient_data'])
const STATUS_RANK: Record<string, number> = {
  within_reference: 0,
  ok: 0,
  info: 0,
  below_reference: 1,
  above_reference: 1,
  caution: 2,
  warning: 3,
}

interface ObservationLike {
  signal_key?: string
  status?: string
}

/**
 * `observations` (workout/meal) or `evidence` (coach_output_v1) — whichever
 * array the surface's schema uses to attach a status to a signal_key.
 */
function observationsOf(output: unknown): ObservationLike[] {
  const record = output as { observations?: ObservationLike[]; evidence?: ObservationLike[] } | null
  return record?.observations ?? record?.evidence ?? []
}

export function findEscalatedStatuses(output: unknown, signals: SignalLike[]): string[] {
  const bySignal = new Map(signals.map((signal) => [signal.metric_key, signal.status]))
  const bad: string[] = []
  for (const observation of observationsOf(output)) {
    if (!observation.signal_key || !observation.status) continue
    const inputStatus = bySignal.get(observation.signal_key)
    if (inputStatus === undefined) {
      bad.push(`${observation.signal_key}:not_supplied`)
    } else if (NON_JUDGEMENT.has(inputStatus)) {
      if (observation.status !== inputStatus) bad.push(`${observation.signal_key}:${inputStatus}->${observation.status}`)
    } else if ((STATUS_RANK[observation.status] ?? 99) > (STATUS_RANK[inputStatus] ?? -1)) {
      bad.push(`${observation.signal_key}:${inputStatus}->${observation.status}`)
    }
  }
  return bad
}

/* ------------------------------------------------------------------------- */
/* 6. action_type must come from the allowed list given in this input         */
/* ------------------------------------------------------------------------- */

interface ActionLike {
  action_type?: string
}

/**
 * `allowedActions` is the rule-computed whitelist for this generation (spec
 * A0-4 `context.allowed_actions`, e.g. no `complete_record` when nothing is
 * missing). Undefined/empty means the surface does not use action_type yet —
 * the check is then a no-op rather than rejecting every legacy output.
 */
export function findInvalidActionTypes(output: unknown, allowedActions: string[] | undefined): string[] {
  if (!allowedActions || allowedActions.length === 0) return []
  const allowed = new Set(allowedActions)
  const actions = (output as { next_actions?: ActionLike[] } | null)?.next_actions ?? []
  const bad: string[] = []
  for (const action of actions) {
    if (action.action_type && !allowed.has(action.action_type) && !bad.includes(action.action_type)) {
      bad.push(action.action_type)
    }
  }
  return bad
}

/* ------------------------------------------------------------------------- */
/* Aggregate                                                                   */
/* ------------------------------------------------------------------------- */

export interface RunChecksInput {
  rawOutput: unknown
  facts: FactLike[]
  signals: SignalLike[]
  registry: RegistryLike
  /** false while a surface still uses free numbers (pre-v4 prompts). */
  placeholderMode: boolean
  /** Extra numbers a rule computed that are not MetricFacts (non-placeholder mode only). */
  extraAllowedNumbers?: number[]
  /** context.allowed_actions for this generation, when the surface uses action_type. */
  allowedActions?: string[]
}

export function runOutputChecks(input: RunChecksInput): CheckResult & { rendered: unknown } {
  const failures: CheckFailure[] = []
  let rendered: unknown = input.rawOutput

  if (input.placeholderMode) {
    const bare = findBareNumbers(input.rawOutput)
    if (bare.length > 0) failures.push({ code: 'bare_number', detail: bare })
    const result = renderOutput(input.rawOutput, input.facts)
    rendered = result.output
    if (result.unresolved.length > 0) failures.push({ code: 'unresolved_placeholder', detail: result.unresolved })
  } else {
    const allowed = [
      ...input.facts.map((fact) => fact.value),
      ...(input.extraAllowedNumbers ?? []),
    ]
    const untraceable = findUntraceableNumbersInOutput(input.rawOutput, allowed)
    if (untraceable.length > 0) failures.push({ code: 'untraceable_number', detail: untraceable })
  }

  const forbidden = findForbiddenClaims(rendered, input.signals, input.registry)
  if (forbidden.length > 0) failures.push({ code: 'forbidden_claim', detail: forbidden })

  const unknownIds = findUnknownEvidenceIds(input.rawOutput, input.signals, input.registry)
  if (unknownIds.length > 0) failures.push({ code: 'unknown_evidence_id', detail: unknownIds })

  const escalated = findEscalatedStatuses(input.rawOutput, input.signals)
  if (escalated.length > 0) failures.push({ code: 'status_escalated', detail: escalated })

  const invalidActions = findInvalidActionTypes(input.rawOutput, input.allowedActions)
  if (invalidActions.length > 0) failures.push({ code: 'invalid_action', detail: invalidActions })

  return { ok: failures.length === 0, failures, rendered }
}

/** Feedback text for the single retry: appended to the instructions, never shown to the user. */
export function retryHint(failures: CheckFailure[]): string {
  return failures
    .map((failure) => {
      switch (failure.code) {
        case 'bare_number':
          return `不要写数字 ${failure.detail.join('、')}；数字只能用 {{metric_key}} 占位符。`
        case 'untraceable_number':
          return `出现了资料里没有的数字（${failure.detail.join('、')}）。数字只能引用输入里的数据。`
        case 'unresolved_placeholder':
          return `占位符 ${failure.detail.join('、')} 不存在，只能使用 facts 中的 metric_key。`
        case 'forbidden_claim':
          return `不要使用以下表述：${failure.detail.join('；')}。`
        case 'unknown_evidence_id':
          return `evidence_ref_ids 只能来自输入信号：去掉 ${failure.detail.join('、')}。`
        case 'status_escalated':
          return `判断不能比输入信号更强：${failure.detail.join('、')}。`
        case 'invalid_action':
          return `action_type 必须来自 allowed_actions：去掉 ${failure.detail.join('、')}。`
        default:
          return ''
      }
    })
    .filter(Boolean)
    .join('\n')
}
