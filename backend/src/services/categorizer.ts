/**
 * AI-powered product categorization for receipt line items.
 * Sends a batch of item descriptions to OpenAI and returns category assignments
 * with confidence levels. Runs as a separate call from receipt parsing.
 */
import OpenAI from 'openai'

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

export interface CategorizationInput {
  index: number
  description: string
}

export interface CategorizationResult {
  index: number
  category: string
  confidence: 'high' | 'medium' | 'low'
}

const SYSTEM_PROMPT = `You are a grocery and household product categorizer. Given a list of product descriptions from a receipt (Norwegian, Swedish, or English), assign each item to exactly one product category.

Always respond with valid JSON only, no markdown, no explanation.

Input format:
{
  "items": [
    { "index": 0, "description": "KAFFE 450 G FILTERMALT" },
    { "index": 1, "description": "Zalo 500 ml" }
  ]
}

Response format:
{
  "results": [
    { "index": 0, "category": "Coffee", "confidence": "high" },
    { "index": 1, "category": "Cleaning Supplies", "confidence": "high" }
  ]
}

Rules:
- Use short, human-readable English category names (title case)
- Common categories include but are not limited to: Coffee, Tea, Dairy, Bread & Bakery, Meat, Fish & Seafood, Fruits & Vegetables, Frozen Food, Snacks & Candy, Beverages, Cleaning Supplies, Hygiene & Personal Care, Paper Products, Pet Supplies, Baby Products, Alcohol, Condiments & Spices, Pasta & Rice, Canned Goods, Breakfast Cereals
- You are NOT limited to the list above. If a product clearly belongs to a category not listed, use an appropriate name
- Prefer specific categories over generic ones: "Coffee" is better than "Beverages" for coffee products, "Cleaning Supplies" is better than "Household" for cleaning products
- If a product is ambiguous or you genuinely cannot determine what it is, set confidence to "low"
- Norwegian grocery terms to be aware of:
  - "kaffe" = coffee, "melk" = milk, "brød" = bread, "ost" = cheese
  - "tannkrem" / "tannbørste" = dental/hygiene, "såpe" = soap
  - "oppvaskmiddel" / "Zalo" = dish soap (cleaning supplies)
  - "kjøtt" = meat, "fisk" = fish, "grønnsaker" = vegetables
  - "vaskemiddel" = laundry detergent, "toalettpapir" = toilet paper
  - Brand names: "Zalo" = dish soap, "Jif" = cleaning, "Blenda" = laundry detergent
- Swedish grocery terms:
  - "kaffe" = coffee, "mjölk" = milk, "bröd" = bread
  - "tandkräm" = toothpaste, "tvål" = soap, "diskmedel" = dish soap
- Receipt descriptions are often truncated or abbreviated. Use your best judgment
- "BLUE JAVA" is a coffee brand -> category "Coffee"
- When in doubt between two plausible categories, pick the more specific one and set confidence to "medium"`

const TIMEOUT_MS = 10_000

/**
 * Categorize a batch of items via AI. On failure returns all items as
 * Uncategorized with low confidence — never throws.
 */
export async function categorizeWithAI(
  items: CategorizationInput[]
): Promise<CategorizationResult[]> {
  if (items.length === 0) return []

  const fallback: CategorizationResult[] = items.map((item) => ({
    index: item.index,
    category: 'Uncategorized',
    confidence: 'low' as const,
  }))

  const userPrompt = `Categorize these receipt items:\n${JSON.stringify({ items }, null, 2)}`

  const parsePromise = client.chat.completions
    .create({
      model: 'gpt-4o-mini',
      max_tokens: 2048,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
    })
    .then((response) => {
      const text = response.choices[0]?.message?.content ?? ''
      const parsed = JSON.parse(text) as { results: CategorizationResult[] }
      return (parsed.results ?? []).map((r) => ({
        index: r.index,
        category: r.category ?? 'Uncategorized',
        confidence: (['high', 'medium', 'low'].includes(r.confidence) ? r.confidence : 'low') as CategorizationResult['confidence'],
      }))
    })

  const timeoutPromise = new Promise<CategorizationResult[]>((resolve) =>
    setTimeout(() => resolve(fallback), TIMEOUT_MS)
  )

  try {
    return await Promise.race([parsePromise, timeoutPromise])
  } catch {
    return fallback
  }
}
