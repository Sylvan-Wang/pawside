import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

// GET /api/foods/[id]/nutrition
// Returns full nutrition details + portion templates for a food
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const foodId = parseInt(id)
  if (isNaN(foodId)) {
    return NextResponse.json({ error: '无效的食物 ID' }, { status: 400 })
  }

  const supabase = await createClient()

  const { data, error } = await supabase
    .from('foods')
    .select(`
      id,
      canonical_name,
      category,
      default_unit,
      food_nutrition (
        basis_type,
        energy_kcal,
        protein_g,
        fat_g,
        carb_g,
        fiber_g,
        sodium_mg
      ),
      food_portion_templates (
        portion_name,
        weight_g,
        note
      )
    `)
    .eq('id', foodId)
    .eq('is_active', true)
    .single()

  if (error || !data) {
    return NextResponse.json({ error: '食物不存在' }, { status: 404 })
  }

  const n = Array.isArray(data.food_nutrition) ? data.food_nutrition[0] : data.food_nutrition

  return NextResponse.json({
    food_id: data.id,
    canonical_name: data.canonical_name,
    category: data.category,
    default_unit: data.default_unit,
    basis_type: n?.basis_type ?? 'per_100g',
    nutrition: n ? {
      energy_kcal: n.energy_kcal,
      protein_g: n.protein_g,
      fat_g: n.fat_g,
      carb_g: n.carb_g,
      fiber_g: n.fiber_g,
      sodium_mg: n.sodium_mg,
    } : null,
    portion_templates: data.food_portion_templates ?? [],
  })
}
