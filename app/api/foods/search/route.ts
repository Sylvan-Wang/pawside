import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

// GET /api/foods/search?q=鸡胸&limit=20
// Searches canonical_name first, then aliases. Returns ranked results.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const q = searchParams.get('q')?.trim()
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '20'), 50)

  if (!q || q.length < 1) {
    return NextResponse.json([])
  }

  const supabase = await createClient()

  // Search canonical names (with nutrition preview)
  const { data: byName, error: nameErr } = await supabase
    .from('foods')
    .select(`
      id,
      canonical_name,
      category,
      default_unit,
      food_nutrition (
        energy_kcal,
        protein_g,
        fat_g,
        carb_g
      )
    `)
    .eq('is_active', true)
    .ilike('canonical_name', `%${q}%`)
    .limit(limit)

  if (nameErr) {
    return NextResponse.json({ error: nameErr.message }, { status: 500 })
  }

  // Search aliases, get their parent foods
  const { data: byAlias, error: aliasErr } = await supabase
    .from('food_aliases')
    .select(`
      alias,
      foods (
        id,
        canonical_name,
        category,
        default_unit,
        food_nutrition (
          energy_kcal,
          protein_g,
          fat_g,
          carb_g
        )
      )
    `)
    .ilike('alias', `%${q}%`)
    .limit(limit)

  if (aliasErr) {
    return NextResponse.json({ error: aliasErr.message }, { status: 500 })
  }

  // Merge and deduplicate by food id, canonical matches first
  const seen = new Set<number>()
  const results: {
    food_id: number
    canonical_name: string
    category: string | null
    default_unit: string
    matched_alias: string | null
    nutrition: {
      energy_kcal: number | null
      protein_g: number | null
      fat_g: number | null
      carb_g: number | null
    } | null
  }[] = []

  // Canonical name matches (higher priority)
  for (const f of byName ?? []) {
    if (seen.has(f.id)) continue
    seen.add(f.id)
    const n = Array.isArray(f.food_nutrition) ? f.food_nutrition[0] : f.food_nutrition
    results.push({
      food_id: f.id,
      canonical_name: f.canonical_name,
      category: f.category,
      default_unit: f.default_unit,
      matched_alias: null,
      nutrition: n ? {
        energy_kcal: n.energy_kcal,
        protein_g: n.protein_g,
        fat_g: n.fat_g,
        carb_g: n.carb_g,
      } : null,
    })
  }

  // Alias matches (lower priority, fill remaining slots)
  for (const row of byAlias ?? []) {
    const f = Array.isArray(row.foods) ? row.foods[0] : row.foods
    if (!f || seen.has(f.id)) continue
    seen.add(f.id)
    const n = Array.isArray(f.food_nutrition) ? f.food_nutrition[0] : f.food_nutrition
    results.push({
      food_id: f.id,
      canonical_name: f.canonical_name,
      category: f.category,
      default_unit: f.default_unit,
      matched_alias: row.alias,
      nutrition: n ? {
        energy_kcal: n.energy_kcal,
        protein_g: n.protein_g,
        fat_g: n.fat_g,
        carb_g: n.carb_g,
      } : null,
    })
  }

  return NextResponse.json(results.slice(0, limit))
}
