import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Recipe suggestions. A recipe is a pointer to somebody else's video. Everything shown
 * here comes from the `recipes` table (row-level security lets a user read only rows
 * that are published AND whose feature key `recipes` is on for them); the model is
 * never asked to pick, write, or paraphrase a recipe, so it cannot invent a link or a
 * number. The calorie figure, when shown, is the video's own claim and is labelled so.
 */

export interface RecipeRow {
  recipe_code: string
  title: string
  source_url: string
  kcal_claimed: number | null
  kcal_basis: string
  minutes: number | null
  ingredients: string[]
  search_text: string
}

const COLUMNS = 'recipe_code,title,source_url,kcal_claimed,kcal_basis,minutes,ingredients,search_text'
export const RECIPE_LIMIT = 3

export function coachRecipesKilled(): boolean {
  const raw = process.env.PAWSIDE_COACH_RECIPES?.trim().toLowerCase()
  return raw === '0' || raw === 'false' || raw === 'off'
}

/** Words to look for: letters and digits only (nothing from the user reaches a filter expression). */
export function topicTerms(topic: string | null): string[] {
  if (!topic) return []
  const terms = topic.normalize('NFKC').split(/[^\p{L}\p{N}]+/u).map((t) => t.trim()).filter((t) => t.length > 0)
  return [...new Set(terms)].slice(0, 3)
}

function hash(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619) }
  return h >>> 0
}

/**
 * Pure ranking: more matching terms first; ties broken by a hash of (day, code), so the
 * same question on the same day gets the same answer and a different day rotates the list.
 * With search terms and no match the answer is an EMPTY list (never an unrelated recipe).
 */
export function rankRecipes(rows: RecipeRow[], terms: string[], today: string, limit = RECIPE_LIMIT): RecipeRow[] {
  const scored = rows.map((row) => ({
    row,
    hits: terms.filter((term) => row.search_text.includes(term) || row.title.includes(term) || row.ingredients.some((i) => i.includes(term))).length,
  }))
  const pool = terms.length > 0 ? scored.filter((s) => s.hits > 0) : scored
  return pool
    .sort((a, b) => b.hits - a.hits || hash(`${today}|${a.row.recipe_code}`) - hash(`${today}|${b.row.recipe_code}`))
    .slice(0, limit)
    .map((s) => s.row)
}

/** Reads published recipes this user may see. Any failure means "no suggestions", never an error to the user. */
export async function pickRecipes(supabase: SupabaseClient, topic: string | null, today: string): Promise<RecipeRow[]> {
  if (coachRecipesKilled()) return []
  try {
    const terms = topicTerms(topic)
    // The whole published list is a few hundred short rows: filter and rank in code, so no
    // user-derived text is ever placed in a database filter.
    const query = supabase.from('recipes').select(COLUMNS).eq('status', 'published').limit(500)
    const { data, error } = await query
    if (error || !data) return []
    return rankRecipes(data as RecipeRow[], terms, today)
  } catch {
    return []
  }
}

export function recipeText(recipes: RecipeRow[]): string {
  if (recipes.length === 0) return ''
  const lines = ['可以看看这几个（都是 B 站视频，点链接去看做法）：']
  for (const recipe of recipes) {
    lines.push(`· ${recipe.title}`)
    const facts: string[] = []
    // A whole-day or unknown-basis number is not a number for one meal: never shown as one.
    if (recipe.kcal_claimed !== null && recipe.kcal_basis !== 'day' && recipe.kcal_basis !== 'unknown') {
      facts.push(`视频标称约 ${recipe.kcal_claimed} kcal`)
    }
    if (recipe.minutes !== null) facts.push(`约 ${recipe.minutes} 分钟`)
    if (facts.length > 0) lines.push(`  ${facts.join(' · ')}`)
    lines.push(`  ${recipe.source_url}`)
  }
  lines.push('热量是视频自己标的，不是我算的，也不会记进你今天的饮食里。')
  return lines.join('\n')
}
