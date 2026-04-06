/**
 * Typed REST API client — shared by web and mobile.
 * Handles token refresh on 401 automatically.
 * All monetary amounts in øre (integers).
 */

let accessToken: string | null = null
let onTokenRefreshed: ((token: string) => void) | null = null
let refreshPromise: Promise<string> | null = null

export function setAccessToken(token: string) {
  accessToken = token
}

export function onRefresh(callback: (token: string) => void) {
  onTokenRefreshed = callback
}

async function refreshToken(): Promise<string> {
  if (refreshPromise) return refreshPromise

  refreshPromise = fetch('/api/v1/auth/refresh', {
    method: 'POST',
    credentials: 'include',
  })
    .then(async (res) => {
      if (!res.ok) throw new Error('Refresh failed')
      const data = (await res.json()) as { accessToken: string }
      accessToken = data.accessToken
      onTokenRefreshed?.(data.accessToken)
      return data.accessToken
    })
    .finally(() => { refreshPromise = null })

  return refreshPromise
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  retry = true
): Promise<T> {
  const headers = new Headers(options.headers)
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`)
  if (!(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json')
  }

  const res = await fetch(`/api/v1${path}`, {
    ...options,
    headers,
    credentials: 'include',
  })

  if (res.status === 401 && retry) {
    const newToken = await refreshToken()
    headers.set('Authorization', `Bearer ${newToken}`)
    return request<T>(path, { ...options, headers }, false)
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: { code: string; message: string } }
    const err = new ApiError(
      res.status,
      body.error?.code ?? 'UNKNOWN',
      body.error?.message ?? res.statusText
    )
    throw err
  }

  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

// ─── Auth ────────────────────────────────────────────────────────────────────

export interface LoginResponse {
  accessToken: string
  user: { id: string; email: string; name: string }
}

export const auth = {
  register: (body: { email: string; password: string; name: string }) =>
    request<LoginResponse>('/auth/register', { method: 'POST', body: JSON.stringify(body) }),

  login: (body: { email: string; password: string }) =>
    request<LoginResponse>('/auth/login', { method: 'POST', body: JSON.stringify(body) }),

  refresh: () =>
    request<{ accessToken: string }>('/auth/refresh', { method: 'POST' }),

  logout: () =>
    request<void>('/auth/logout', { method: 'POST' }),

  getInvite: (token: string) =>
    request<{ email: string; householdName: string; isNewUser: boolean }>(
      `/auth/invite-info?token=${encodeURIComponent(token)}`
    ),

  acceptInvite: (body: { token: string; name?: string; password?: string }) =>
    request<LoginResponse & { householdId: string }>('/auth/accept-invite', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
}

// ─── Users ───────────────────────────────────────────────────────────────────

export interface UserPreferences {
  theme: 'light' | 'dark'
  notifyNewExpense: boolean
  notifySettlement: boolean
  notifyInvite: boolean
}

export interface UserProfile {
  id: string
  email: string
  name: string
  avatarUrl: string | null
  preferences: UserPreferences
  cards: Array<{ id: string; lastFour: string; label: string }>
}

export const users = {
  me: () => request<UserProfile>('/users/me'),
  updateMe: (body: { name?: string }) =>
    request<UserProfile>('/users/me', { method: 'PATCH', body: JSON.stringify(body) }),
  changePassword: (body: { currentPassword: string; newPassword: string }) =>
    request<{ message: string }>('/users/me/password', { method: 'POST', body: JSON.stringify(body) }),
  uploadAvatar: (file: File) => {
    const form = new FormData()
    form.append('avatar', file)
    return request<{ avatarUrl: string }>('/users/me/avatar', { method: 'POST', body: form })
  },
  updatePreferences: (body: Partial<UserPreferences>) =>
    request<UserPreferences>('/users/me/preferences', { method: 'PATCH', body: JSON.stringify(body) }),
  deleteAccount: (body: { password: string }) =>
    request<void>('/users/me', { method: 'DELETE', body: JSON.stringify(body) }),
  addCard: (body: { lastFour: string; label: string }) =>
    request<{ id: string; lastFour: string; label: string }>('/users/me/cards', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  deleteCard: (cardId: string) =>
    request<void>(`/users/me/cards/${cardId}`, { method: 'DELETE' }),
}

// ─── Households ──────────────────────────────────────────────────────────────

export interface Household {
  id: string
  name: string
  address: string
  status: 'pending' | 'active'
  members: Array<{ userId: string; name: string; role: 'admin' | 'member' }>
  currentAllocationKey: Array<{ userId: string; name: string; shareBp: number }>
  tags: Array<{ id: string; name: string; isPersonal: boolean }>
  personalKeywords: string[]
}

export const households = {
  create: (body: { name: string; address?: string; allocationKey: Array<{ userId: string; shareBp: number }> }) =>
    request<Household>('/households', { method: 'POST', body: JSON.stringify(body) }),

  listMine: () =>
    request<Household[]>('/households'),

  get: (householdId: string) =>
    request<Household>(`/households/${householdId}`),

  update: (householdId: string, body: { name?: string; address?: string; personalKeywords?: string[]; newAllocationKey?: Array<{ userId: string; shareBp: number }> }) =>
    request<Household>(`/households/${householdId}`, { method: 'PATCH', body: JSON.stringify(body) }),

  invite: (householdId: string, body: { email: string }) =>
    request<{ id: string; email: string; expiresAt: string }>(`/households/${householdId}/invites`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
}

// ─── Receipts ────────────────────────────────────────────────────────────────

export interface ParsedReceipt {
  receiptImageKey: string
  receiptImageUrl: string
  store: string | null
  date: string | null
  detectedCardLastFour: string | null
  items: Array<{
    description: string
    quantity: number
    unitPriceOre: number
    confidenceLow: boolean
    categoryId?: string | null
    categoryName?: string
  }>
}

export const receipts = {
  parse: (householdId: string, file: File) => {
    const form = new FormData()
    form.append('receipt', file)
    return request<ParsedReceipt>(`/receipts/parse?householdId=${encodeURIComponent(householdId)}`, {
      method: 'POST',
      body: form,
    })
  },
}

// ─── Expenses ────────────────────────────────────────────────────────────────

export interface Expense {
  id: string
  householdId: string
  purchasedBy: string
  purchaserName: string
  receiptImageKey: string | null
  receiptImageUrl: string | null
  store: string | null
  date: string | null
  totalAmountOre: number
  cardLastFour: string | null
  status: 'pending_review' | 'confirmed' | 'settled'
  createdAt: string
  lineItems: Array<{
    id: string
    description: string
    quantity: number
    unitPriceOre: number
    tagId: string | null
    isPersonal: boolean
    categoryId: string | null
    categoryName: string | null
  }>
}

export const expenses = {
  list: (householdId: string, params?: { month?: string; status?: string }) => {
    const qs = new URLSearchParams(params as Record<string, string>).toString()
    return request<{ expenses: Expense[] }>(`/households/${householdId}/expenses${qs ? `?${qs}` : ''}`)
  },
  create: (householdId: string, body: {
    receiptImageKey?: string
    store?: string
    date?: string
    purchasedBy: string
    cardLastFour?: string
    lineItems: Array<{
      description: string
      quantity: number
      unitPriceOre: number
      tagId?: string
      isPersonal?: boolean
      categoryId?: string
    }>
  }) =>
    request<Expense>(`/households/${householdId}/expenses`, { method: 'POST', body: JSON.stringify(body) }),
  get: (householdId: string, expenseId: string) =>
    request<Expense>(`/households/${householdId}/expenses/${expenseId}`),
  confirm: (householdId: string, expenseId: string) =>
    request<Expense>(`/households/${householdId}/expenses/${expenseId}/confirm`, { method: 'POST' }),
  updateLineItem: (householdId: string, expenseId: string, lineItemId: string, body: {
    unitPriceOre?: number; quantity?: number; description?: string
  }) =>
    request<Expense['lineItems'][0] & { newTotalAmountOre: number }>(
      `/households/${householdId}/expenses/${expenseId}/line-items/${lineItemId}`,
      { method: 'PATCH', body: JSON.stringify(body) }
    ),
}

// ─── Settlements ─────────────────────────────────────────────────────────────

export interface Settlement {
  id: string
  periodMonth: number | null
  periodYear: number | null
  status: 'open' | 'completed'
  balances: Array<{ userId: string; name: string; amountOre: number }>
  transactions: Array<{
    id: string
    fromUserId: string
    fromName: string
    toUserId: string
    toName: string
    amountOre: number
    paidAt: string | null
  }>
}

export const settlements = {
  list: (householdId: string) =>
    request<{ settlements: Settlement[] }>(`/households/${householdId}/settlements`),
  trigger: (householdId: string) =>
    request<Settlement>(`/households/${householdId}/settlements`, { method: 'POST' }),
  get: (householdId: string, settlementId: string) =>
    request<Settlement>(`/households/${householdId}/settlements/${settlementId}`),
  markPaid: (settlementId: string, transactionId: string) =>
    request<{ id: string; paidAt: string }>(`/settlements/${settlementId}/transactions/${transactionId}`, {
      method: 'PATCH',
      body: JSON.stringify({ paid: true }),
    }),
}

// ─── Projects ────────────────────────────────────────────────────────────────

export interface Project {
  id: string
  name: string
  description: string | null
  status: 'active' | 'settling' | 'settled'
  members: Array<{ userId: string; name: string }>
  allocationKey: Array<{ userId: string; name: string; shareBp: number }>
}

export const projects = {
  list: (householdId: string) =>
    request<{ projects: Array<{ id: string; name: string; status: string; memberCount: number }> }>(`/households/${householdId}/projects`),
  create: (householdId: string, body: unknown) =>
    request<Project>(`/households/${householdId}/projects`, { method: 'POST', body: JSON.stringify(body) }),
  get: (projectId: string) =>
    request<Project>(`/projects/${projectId}`),
  finish: (projectId: string) =>
    request<Settlement>(`/projects/${projectId}/finish`, { method: 'POST' }),
  listExpenses: (projectId: string) =>
    request<{ expenses: Expense[] }>(`/projects/${projectId}/expenses`),
  createExpense: (projectId: string, body: unknown) =>
    request<Expense>(`/projects/${projectId}/expenses`, { method: 'POST', body: JSON.stringify(body) }),
}

// ─── Statistics ──────────────────────────────────────────────────────────────

export interface Statistics {
  month: string
  totalOre: number
  byTag: Array<{ tagId: string; tagName: string; totalOre: number }>
  byMember: Array<{ userId: string; name: string; totalOre: number }>
  topItems: Array<{ description: string; totalOre: number; count: number }>
  trends: Array<{ month: string; byTag: Array<{ tagId: string; tagName: string; totalOre: number }> }>
  byCategory: Array<{ categoryId: string | null; categoryName: string; totalOre: number; itemCount: number }>
  categoryTrends: Array<{ month: string; byCategory: Array<{ categoryId: string | null; categoryName: string; totalOre: number }> }>
}

export interface CategoryDetailItem {
  lineItemId: string
  description: string
  quantity: number
  unitPriceOre: number
  isPersonal: boolean
  expenseId: string
  store: string | null
  expenseDate: string | null
  purchaserName: string
}

export interface CategoryDetail {
  categoryId: string | null
  categoryName: string
  items: CategoryDetailItem[]
}

export interface CategoryInfo {
  id: string
  name: string
  isSystem: boolean
  mappingCount: number
}

export interface CategoryUpdateResult {
  lineItemId: string
  categoryId: string
  categoryName: string
  mappingSaved: boolean
}

export const statistics = {
  get: (householdId: string, params?: { month?: string; includePersonal?: boolean }) => {
    const qs = new URLSearchParams(params as Record<string, string>).toString()
    return request<Statistics>(`/households/${householdId}/statistics${qs ? `?${qs}` : ''}`)
  },
  categoryDetail: (householdId: string, categoryId: string, params?: { month?: string; includePersonal?: boolean }) => {
    const qs = new URLSearchParams(params as Record<string, string>).toString()
    return request<CategoryDetail>(`/households/${householdId}/statistics/category/${categoryId}${qs ? `?${qs}` : ''}`)
  },
  exportCsv: (householdId: string, params?: { month?: string; includePersonal?: boolean }) => {
    const qs = new URLSearchParams(params as Record<string, string>).toString()
    return fetch(`/api/v1/households/${householdId}/statistics/export${qs ? `?${qs}` : ''}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
  },
}

// ─── Categories ─────────────────────────────────────────────────────────────

export const categories = {
  list: (householdId: string) =>
    request<{ categories: CategoryInfo[] }>(`/households/${householdId}/categories`),

  rename: (householdId: string, categoryId: string, name: string) =>
    request<{ id: string; name: string; merged: boolean }>(
      `/households/${householdId}/categories/${categoryId}`,
      { method: 'PATCH', body: JSON.stringify({ name }) }
    ),

  remove: (householdId: string, categoryId: string) =>
    request<void>(`/households/${householdId}/categories/${categoryId}`, { method: 'DELETE' }),

  updateLineItemCategory: (
    householdId: string,
    expenseId: string,
    lineItemId: string,
    categoryName: string
  ) =>
    request<CategoryUpdateResult>(
      `/households/${householdId}/expenses/${expenseId}/line-items/${lineItemId}/category`,
      { method: 'PATCH', body: JSON.stringify({ categoryName }) }
    ),
}
