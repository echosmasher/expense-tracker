/**
 * Tag matcher — auto-tags line items as personal based on household keywords.
 * Matching is case-insensitive substring search against item description.
 */

export interface LineItemInput {
  description: string
  quantity: number
  unitPriceOre: number
  confidenceLow: boolean
}

export interface TaggedLineItem extends LineItemInput {
  isPersonal: boolean
}

/**
 * Given a list of parsed line items and a household's personal keywords,
 * returns each item with an `isPersonal` flag set to true if the item
 * description contains any keyword (case-insensitive).
 */
export function tagLineItems(
  items: LineItemInput[],
  personalKeywords: string[]
): TaggedLineItem[] {
  const lower = personalKeywords.map((k) => k.toLowerCase())

  return items.map((item) => {
    const desc = item.description.toLowerCase()
    const isPersonal = lower.some((kw) => desc.includes(kw))
    return { ...item, isPersonal }
  })
}
