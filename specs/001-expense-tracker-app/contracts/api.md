# REST API Contracts

**Branch**: `001-expense-tracker-app` | **Date**: 2026-03-29

## Conventions

- Base path: `/api/v1`
- Auth: `Authorization: Bearer <access_token>` on all endpoints except auth routes
- All amounts: integers in **øre**
- All allocation shares: integers in **basis points** (10 000 = 100%)
- Dates: ISO 8601 strings
- Errors: `{ "error": { "code": "SNAKE_CASE_CODE", "message": "Human readable" } }`

---

## Auth

### `POST /auth/register`
Register a new user.

**Request**
```json
{ "email": "string", "password": "string (min 8 chars)", "name": "string" }
```
**Response `201`**
```json
{ "accessToken": "string", "user": { "id": "uuid", "email": "string", "name": "string" } }
```
Sets `refresh_token` httpOnly cookie.

**Errors**: `400 VALIDATION_ERROR`, `409 EMAIL_ALREADY_EXISTS`

---

### `POST /auth/login`
**Request**
```json
{ "email": "string", "password": "string" }
```
**Response `200`**
```json
{ "accessToken": "string", "user": { "id": "uuid", "email": "string", "name": "string" } }
```
Sets `refresh_token` httpOnly cookie.

**Errors**: `401 INVALID_CREDENTIALS`

---

### `POST /auth/refresh`
Exchange refresh token (from cookie) for a new access token.

**Response `200`**
```json
{ "accessToken": "string" }
```
Rotates refresh token cookie.

**Errors**: `401 INVALID_REFRESH_TOKEN`, `401 REFRESH_TOKEN_EXPIRED`

---

### `POST /auth/logout`
Revokes current refresh token.

**Response `204`**

---

### `POST /auth/accept-invite`
Accept a household invite. Creates account if user does not exist.

**Request**
```json
{
  "token": "string",
  "name": "string (required if new user)",
  "password": "string (required if new user)"
}
```
**Response `200`**
```json
{
  "accessToken": "string",
  "user": { "id": "uuid", "email": "string", "name": "string" },
  "householdId": "uuid"
}
```
**Errors**: `400 INVALID_TOKEN`, `400 TOKEN_EXPIRED`, `400 TOKEN_ALREADY_USED`

---

## Users

### `GET /users/me`
**Response `200`**
```json
{
  "id": "uuid",
  "email": "string",
  "name": "string",
  "cards": [{ "id": "uuid", "lastFour": "string", "label": "string" }]
}
```

---

### `PATCH /users/me`
**Request** (all fields optional)
```json
{ "name": "string" }
```
**Response `200`** — updated user object (same shape as GET /users/me)

---

### `POST /users/me/cards`
**Request**
```json
{ "lastFour": "string (4 digits)", "label": "string" }
```
**Response `201`**
```json
{ "id": "uuid", "lastFour": "string", "label": "string" }
```

---

### `DELETE /users/me/cards/:cardId`
**Response `204`**

**Errors**: `404 CARD_NOT_FOUND`

---

## Households

### `POST /households`
**Request**
```json
{
  "name": "string",
  "address": "string",
  "allocationKey": [
    { "userId": "uuid (current user)", "shareBp": 5000 },
    { "userId": "uuid (placeholder — resolved on invite accept)", "shareBp": 5000 }
  ]
}
```
Note: second member's userId is omitted at creation; allocation key is finalised when second member joins.

**Response `201`**
```json
{
  "id": "uuid",
  "name": "string",
  "address": "string",
  "status": "pending",
  "members": [{ "userId": "uuid", "name": "string", "role": "admin" }]
}
```

---

### `GET /households/:householdId`
**Response `200`**
```json
{
  "id": "uuid",
  "name": "string",
  "address": "string",
  "status": "pending|active",
  "members": [{ "userId": "uuid", "name": "string", "role": "admin|member" }],
  "currentAllocationKey": [{ "userId": "uuid", "name": "string", "shareBp": 5000 }],
  "tags": [{ "id": "uuid", "name": "string", "isPersonal": false }],
  "personalKeywords": ["string"]
}
```

---

### `PATCH /households/:householdId`
Admin only. Update name, address, tags, personal keywords, or allocation key (applies to future periods only).

**Request** (all fields optional)
```json
{
  "name": "string",
  "address": "string",
  "personalKeywords": ["string"],
  "newAllocationKey": [{ "userId": "uuid", "shareBp": 5000 }]
}
```
**Response `200`** — updated household object

**Errors**: `403 ADMIN_ONLY`, `400 ALLOCATION_KEY_MUST_SUM_TO_10000`

---

### `POST /households/:householdId/invites`
Admin only. Send an email invite.

**Request**
```json
{ "email": "string" }
```
**Response `201`**
```json
{ "id": "uuid", "email": "string", "expiresAt": "ISO8601" }
```
**Errors**: `403 ADMIN_ONLY`, `409 ALREADY_MEMBER`

---

## Receipts

### `POST /receipts/parse`
Upload a receipt image for AI parsing. Returns parsed line items.

**Request**: `multipart/form-data`, field `receipt` (JPG, PNG, or PDF, max 10MB)

**Response `200`**
```json
{
  "receiptImageKey": "string (MinIO key)",
  "store": "string|null",
  "date": "YYYY-MM-DD|null",
  "detectedCardLastFour": "string|null",
  "items": [
    {
      "description": "string",
      "quantity": 1,
      "unitPriceOre": 4990,
      "confidenceLow": false
    }
  ]
}
```
**Errors**: `400 UNSUPPORTED_FILE_TYPE`, `400 FILE_TOO_LARGE`, `502 PARSE_FAILED` (Anthropic unavailable — empty items array returned, receiptImageKey still valid)

---

## Expenses

### `GET /households/:householdId/expenses`
Returns confirmed + pending expenses for the household (not project expenses).

**Query params**: `?month=YYYY-MM` (optional, defaults to current month), `?status=pending_review|confirmed|settled`

**Response `200`**
```json
{
  "expenses": [
    {
      "id": "uuid",
      "purchasedBy": { "userId": "uuid", "name": "string" },
      "purchaseDate": "YYYY-MM-DD",
      "storeName": "string|null",
      "defaultTag": { "id": "uuid", "name": "string" },
      "status": "pending_review|confirmed|settled",
      "totalOre": 49900,
      "lineItemCount": 5
    }
  ]
}
```

---

### `POST /households/:householdId/expenses`
Create a new expense (after receipt review).

**Request**
```json
{
  "purchasedByUserId": "uuid",
  "purchaseDate": "YYYY-MM-DD",
  "storeName": "string|null",
  "receiptImageKey": "string|null",
  "defaultTagId": "uuid",
  "lineItems": [
    {
      "description": "string",
      "quantity": 10000,
      "unitPriceOre": 4990,
      "totalPriceOre": 4990,
      "tagId": "uuid|null",
      "isPersonal": false,
      "confidenceLow": false
    }
  ]
}
```
**Response `201`** — full expense object (see GET /expenses/:id)

---

### `GET /households/:householdId/expenses/:expenseId`
**Response `200`**
```json
{
  "id": "uuid",
  "purchasedBy": { "userId": "uuid", "name": "string" },
  "purchaseDate": "YYYY-MM-DD",
  "storeName": "string|null",
  "receiptImageUrl": "string|null (signed URL, 1h expiry)",
  "defaultTag": { "id": "uuid", "name": "string" },
  "status": "pending_review|confirmed|settled",
  "lineItems": [
    {
      "id": "uuid",
      "description": "string",
      "quantity": 10000,
      "unitPriceOre": 4990,
      "totalPriceOre": 4990,
      "tag": { "id": "uuid", "name": "string" },
      "isPersonal": false,
      "confidenceLow": false
    }
  ]
}
```

---

### `POST /households/:householdId/expenses/:expenseId/confirm`
Confirm an expense (moves from pending_review → confirmed).

**Response `200`** — updated expense object

**Errors**: `409 ALREADY_CONFIRMED`, `409 ALREADY_SETTLED`

---

## Settlements

### `GET /households/:householdId/settlements`
**Response `200`**
```json
{
  "settlements": [
    {
      "id": "uuid",
      "periodMonth": 3,
      "periodYear": 2026,
      "status": "open|completed",
      "createdAt": "ISO8601"
    }
  ]
}
```

---

### `POST /households/:householdId/settlements`
Admin only. Trigger settlement for the previous calendar month.

**Response `201`**
```json
{
  "id": "uuid",
  "periodMonth": 2,
  "periodYear": 2026,
  "status": "open",
  "balances": [{ "userId": "uuid", "name": "string", "amountOre": 45000 }],
  "transactions": [
    { "id": "uuid", "fromUserId": "uuid", "fromName": "string", "toUserId": "uuid", "toName": "string", "amountOre": 45000, "paidAt": null }
  ]
}
```
**Errors**: `403 ADMIN_ONLY`, `409 SETTLEMENT_ALREADY_EXISTS`

---

### `GET /households/:householdId/settlements/:settlementId`
**Response `200`** — same shape as POST response above

---

### `PATCH /settlements/:settlementId/transactions/:transactionId`
Mark a transaction as paid.

**Request**
```json
{ "paid": true }
```
**Response `200`**
```json
{ "id": "uuid", "paidAt": "ISO8601" }
```
**Errors**: `409 ALREADY_PAID`

---

## Projects

### `GET /households/:householdId/projects`
**Response `200`**
```json
{
  "projects": [
    { "id": "uuid", "name": "string", "status": "active|settling|settled", "memberCount": 3 }
  ]
}
```

---

### `POST /households/:householdId/projects`
**Request**
```json
{
  "name": "string",
  "description": "string|null",
  "memberUserIds": ["uuid"],
  "allocationKey": [{ "userId": "uuid", "shareBp": 5000 }]
}
```
**Response `201`** — full project object

---

### `GET /projects/:projectId`
**Response `200`**
```json
{
  "id": "uuid",
  "name": "string",
  "description": "string|null",
  "status": "active|settling|settled",
  "members": [{ "userId": "uuid", "name": "string" }],
  "allocationKey": [{ "userId": "uuid", "name": "string", "shareBp": 5000 }]
}
```

---

### `POST /projects/:projectId/expenses`
Same request/response shape as `POST /households/:householdId/expenses`.

---

### `GET /projects/:projectId/expenses`
Same shape as `GET /households/:householdId/expenses`.

---

### `POST /projects/:projectId/finish`
Admin only. Triggers settlement calculation for the project.

**Response `200`** — settlement object (same shape as household settlement POST response, without periodMonth/periodYear)

**Errors**: `403 ADMIN_ONLY`, `409 PROJECT_NOT_ACTIVE`

---

## Statistics

### `GET /households/:householdId/statistics`
**Query params**: `?month=YYYY-MM` (defaults to current month), `?includePersonal=true`

**Response `200`**
```json
{
  "month": "YYYY-MM",
  "totalOre": 1234500,
  "byTag": [{ "tagId": "uuid", "tagName": "string", "totalOre": 800000 }],
  "byMember": [{ "userId": "uuid", "name": "string", "totalOre": 617250 }],
  "topItems": [{ "description": "string", "totalOre": 29900, "count": 5 }],
  "trends": [
    { "month": "YYYY-MM", "byTag": [{ "tagId": "uuid", "tagName": "string", "totalOre": 750000 }] }
  ]
}
```

---

### `GET /households/:householdId/statistics/export`
Web only. Returns a CSV file.

**Query params**: same as statistics GET

**Response `200`**
- `Content-Type: text/csv`
- `Content-Disposition: attachment; filename="expenses-YYYY-MM.csv"`

---

## WebSocket

### Connection: `WS /ws`

**Authenticate** immediately after connecting:
```json
{ "type": "auth", "accessToken": "string" }
```

**Server → Client events:**
```json
{ "type": "expense.confirmed", "householdId": "uuid", "expenseId": "uuid" }
{ "type": "settlement.ready", "householdId": "uuid", "settlementId": "uuid" }
{ "type": "settlement.transaction.updated", "settlementId": "uuid", "transactionId": "uuid", "paidAt": "ISO8601" }
```

Clients that fail to authenticate within 10 seconds are disconnected.
