import registryData from '../../docs/product/evidence/evidence-registry.json'

/**
 * Pawside — Evidence Registry access (AI Patch §3, §4, §35).
 *
 * Authority rules this module enforces:
 *   AI Patch §1.1 / Guardrail §1.1 — external sources enter the product ONLY
 *     through this registry. Code must never hand-write a threshold it read in a
 *     paper, and must never fetch a source to "confirm" a value.
 *   AI Patch §4   — every item is versioned and carries allowed/forbidden claims.
 *   AI Patch §14  — `no_universal_threshold` is a first-class reference type.
 *   Product §25.2 — claim strength depends on the evidence level.
 *
 * The data file lives outside `lib/` on purpose: it is a governed product
 * document, like `docs/product/system/method/source-registry.json`, not code.
 * Bridging the two registries is FOLLOW_UP (it touches Method provenance).
 */

export type EvidenceLevel = 'A' | 'B' | 'C' | 'D'

export type ReferenceType =
  | 'minimum'
  | 'maximum'
  | 'range'
  | 'target'
  | 'risk_signal'
  | 'no_universal_threshold'

export interface EvidenceRegistryItem {
  evidence_id: string
  metric_key: string
  population: string
  goal?: string
  formula?: string
  reference_type: ReferenceType
  reference_value?: unknown
  evidence_level: EvidenceLevel | null
  source_org: string
  source_title: string
  source_year: number
  source_url: string
  allowed_claims: string[]
  forbidden_claims: string[]
  applicability_notes: string[]
  version: string
}

interface RegistryFile {
  schemaVersion: number
  registryVersion: string
  note: string
  evidenceLevels: Record<string, string>
  items: EvidenceRegistryItem[]
}

const registry = registryData as unknown as RegistryFile

/** Version string recorded on generated content so a claim stays auditable. */
export const EVIDENCE_REGISTRY_VERSION = registry.registryVersion

export const EVIDENCE_ITEMS: readonly EvidenceRegistryItem[] = registry.items

const byId = new Map(EVIDENCE_ITEMS.map((item) => [item.evidence_id, item]))
const byMetricKey = new Map<string, EvidenceRegistryItem[]>()
for (const item of EVIDENCE_ITEMS) {
  const existing = byMetricKey.get(item.metric_key) ?? []
  existing.push(item)
  byMetricKey.set(item.metric_key, existing)
}

export function getEvidenceItem(evidenceId: string): EvidenceRegistryItem | null {
  return byId.get(evidenceId) ?? null
}

/**
 * Resolves the items applicable to a metric.
 *
 * AI Patch §1.1: when nothing is registered, callers MUST treat the metric as
 * `not_assessable` rather than reaching for a plausible number.
 */
export function getEvidenceForMetric(metricKey: string): EvidenceRegistryItem[] {
  return byMetricKey.get(metricKey) ?? []
}

/**
 * Product §25.2: the copy a claim may use depends on how strong the evidence is.
 *
 * This is the ONLY place that maps evidence level to wording, so a Pawside
 * heuristic can never be phrased as a national standard (AC-AI06).
 */
export function claimStyleForLevel(level: EvidenceLevel | null): {
  style: 'guideline' | 'consensus' | 'research' | 'pawside'
  /** Product §25.2 phrasing ladder. */
  prefix: string
  mustLabelAsPawside: boolean
} {
  switch (level) {
    case 'A':
      return { style: 'guideline', prefix: '低于一般成年人建议范围', mustLabelAsPawside: false }
    case 'B':
      return { style: 'consensus', prefix: '低于常见训练参考范围', mustLabelAsPawside: false }
    case 'C':
      return { style: 'research', prefix: '低于研究中常见的范围', mustLabelAsPawside: false }
    case 'D':
      return { style: 'pawside', prefix: 'Pawside 根据你的近期记录评估为', mustLabelAsPawside: true }
    default:
      // No evidence level means no claim strength to borrow.
      return { style: 'pawside', prefix: 'Pawside 暂无法给出判断', mustLabelAsPawside: true }
  }
}

/**
 * AI Patch §30 / AC-AI12: citations are READ from the registry, never generated
 * by the model. Returning the item rather than a URL string means the model
 * cannot invent a source, a year, or an organisation.
 */
export function resolveCitations(evidenceRefIds: string[]): Array<{
  evidence_id: string
  source_org: string
  source_title: string
  source_year: number
  source_url: string
}> {
  return evidenceRefIds.flatMap((id) => {
    const item = byId.get(id)
    if (!item) return []
    return [{
      evidence_id: item.evidence_id,
      source_org: item.source_org,
      source_title: item.source_title,
      source_year: item.source_year,
      source_url: item.source_url,
    }]
  })
}

/**
 * Validates the registry's internal consistency.
 *
 * Called from tests. A duplicate id or an item with no claim boundary would make
 * the "every judgement is explainable" guarantee unverifiable.
 */
export function validateRegistry(): string[] {
  const problems: string[] = []
  const seen = new Set<string>()

  for (const item of EVIDENCE_ITEMS) {
    if (seen.has(item.evidence_id)) problems.push(`duplicate evidence_id: ${item.evidence_id}`)
    seen.add(item.evidence_id)

    if (item.allowed_claims.length === 0) {
      problems.push(`${item.evidence_id}: allowed_claims is empty`)
    }
    if (item.forbidden_claims.length === 0) {
      problems.push(`${item.evidence_id}: forbidden_claims is empty`)
    }
    if (item.applicability_notes.length === 0) {
      problems.push(`${item.evidence_id}: applicability_notes is empty`)
    }
    // Evidence D items must carry a source for what they were derived from,
    // otherwise the heuristic has no traceable basis.
    if (item.evidence_level === 'D' && !item.source_org) {
      problems.push(`${item.evidence_id}: Evidence D without source_org`)
    }
    /*
     * `no_universal_threshold` items must not smuggle in a usable cutoff.
     *
     * A numeric value is permitted only when it is explicitly labelled as
     * non-diagnostic context — e.g. E-NUT-SAFE-003 must retain the historical
     * 30 kcal/kg FFM/day figure because the IOC statement is precisely about that
     * number NOT being a universal threshold (AI Patch §17). Dropping it would
     * lose the source's meaning; keeping it unlabelled would let a caller treat
     * it as a cutoff. So the label is what makes it safe.
     */
    if (item.reference_type === 'no_universal_threshold' && item.reference_value !== undefined) {
      const labelled = item.applicability_notes.some((note) =>
        /不是.*阈值|不能作为|not a (?:universal )?(?:diagnostic )?threshold|historical/i.test(note))
      if (!labelled) {
        problems.push(
          `${item.evidence_id}: no_universal_threshold carries reference_value without a `
          + 'note stating it is not a usable threshold',
        )
      }
    }
  }

  return problems
}
