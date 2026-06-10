# Verification Readiness Audit — expense-tracker

> Assessment of whether this codebase is structurally prepared for AI-powered adversarial
> vulnerability review (machine-scale code interrogation in the style of Anthropic Mythos,
> Google Big Sleep, OpenAI Codex Security).
>
> Date: 2026-06-10 · Based on direct codebase inspection at commit `73f159a`

**Key evidence gathered:** TypeScript is maximally strict (`strict` + `exactOptionalPropertyTypes` + `noUncheckedIndexedAccess`), there is **no CI pipeline at all**, and `npm audit` reports **48 known vulnerabilities (2 critical, 21 high)** — though nearly all sit in the Expo/mobile build toolchain and Vitest, not the production backend. The one runtime-relevant hit is `ws` (moderate, uninitialized memory disclosure), which the backend actually uses for realtime sync.

---

**Composite score: 5.7 / 10** (weighted: Security Model Explicitness 25%, Modularity 20%, Tests 20%, Documentation 15%, Dependencies 10%, Tribal Knowledge 10%)

**Honest scoping note up front:** this is a solo-built, self-hosted household app. It does not need enterprise-grade readiness, and saying otherwise would be false alarm. But it is *not* a toy either — it handles password credentials, JWT auth, session cookies, file uploads, and real money between real people, and it's designed to be deployed on the internet. The right bar is "small but genuinely security-sensitive system," and that's the bar used below.

## 1. Verification Readiness Score

**Modularity and Boundary Clarity — 8/10.**
Four-package npm workspace with one genuinely shared seam (`shared/` used by web and mobile), and a backend layered cleanly into routes / middleware / db / services / storage / ws — at ~11.3k lines, an AI tool can hold the entire system in context. A 10 would add an explicit module dependency rule (e.g., routes may not import `db/client` directly) so boundaries are machine-checkable, not just visible.

**Test Coverage and Test Quality — 2/10.**
Exactly one test file exists (162 lines of Vitest covering the settlement calculator); backend, web, and mobile have no test runner installed and no test script. A 10 for this system would be API-level integration tests over every auth and money-mutating endpoint plus property-based tests on the settlement invariants (sum preservation, remainder-to-admin).

**Documentation and Explicitness — 8/10.**
Unusually strong: three features with full spec/plan/tasks artifacts, a constitution, a data model, API contracts, DEPLOYMENT.md, and documented financial invariants — the *intent* of the system is written down, which is exactly what an adversarial tool needs to distinguish bug from feature. A 10 would add a threat model and an explicit authorization matrix (see dimension six).

**Dependency Health and Supply Chain Legibility — 5/10.**
Direct dependencies are lean, mainstream, and lockfile-pinned, but 48 known vulnerabilities sit unaddressed (2 critical — `shell-quote` via Expo tooling and Vitest's dev server; the runtime-relevant `ws` advisory affects the actual WebSocket server), `multer` is on the end-of-life 1.x line, and there is no audit process. A 10 would be a clean `npm audit --omit=dev`, multer 2.x, and audit enforcement in CI.

**Tribal Knowledge Risk — 7/10** (high score = low risk).
The SDD artifacts externalize design rationale far better than typical projects ten times this size, so on paper the bus factor is manageable — but all 32 commits come from one person, and with near-zero tests, every behavioral assumption *not* in the docs exists only in that one head, unpinned by anything executable. A 10 would mean any competent engineer (or AI agent) could verify a change is safe without asking the author anything.

**Security Model Explicitness — 5/10.**
The defensive *mechanisms* are present and deliberate (bcrypt, rotating refresh tokens in httpOnly cookies, helmet, rate limiting, Zod validation, signed expiring URLs, integer-only money), but the authorization *model* — which household member may see or mutate what — lives implicitly in per-route SQL WHERE clauses, with no threat model, no documented trust boundaries, and no security-focused tests. A 10 would be a one-page authz matrix (role × resource × operation) plus tests asserting cross-household access is impossible.

## 2. Structural Blockers

**1. No executable behavioral oracle — Severity: High.**
There are no tests over auth, authorization, or money-mutating API paths. This blocks machine-scale review in a specific way: an adversarial tool will generate findings ("this endpoint may allow cross-household reads"), and there is no mechanism to confirm the finding, verify a fix, or prevent regression — every finding becomes a manual investigation for one person. The tool can *read* this codebase fine; it cannot close the loop.

**2. No CI pipeline — Severity: High.**
There is no `.github/workflows` directory; lint, typecheck, and the one existing test run only when someone remembers to run them. AI adversarial review tools operate continuously at PR/merge time — with no CI, there is literally no place to mount one, and no guarantee the code a tool reviews is even the code that ships.

**3. Implicit authorization boundaries — Severity: Medium.**
Household scoping is enforced query-by-query rather than through a central policy layer or documented matrix. A machine reviewer can verify each query individually but cannot check them against a stated rule — so a missing `household_id` filter (the most likely real vulnerability class in this app) reads as plausible code, not a deviation. This is precisely the bug class that bit you already (`d86cea7` fixed a settlements query referencing the wrong column).

**4. 48 unaddressed known vulnerabilities — Severity: Medium.**
Mostly noise in the Expo toolchain, but noise is the problem: an AI security tool will surface every known CVE first, burying any novel finding under findings you'd dismiss. A clean baseline is what makes new signals visible.

**5. No threat model — Severity: Low-to-Medium.**
The tool can infer the attack surface (auth endpoints, file upload, OpenAI-bound receipt images, WebSocket rooms), but inference burns capability that should be spent finding bugs. For a system this small, one page fixes it.

## 3. Prioritized Refactor Plan

Sequenced by legibility-per-day. Owner is "you" throughout — this is a solo project, and pretending otherwise would be theater. Estimates assume part-time solo pace.

1. **Stand up GitHub Actions CI** running `npm run lint`, `tsc --noEmit` per package, `npm run build`, and the shared test suite on every push. **~2 days.** Unblocks #2 and creates the mounting point for everything else.
2. **Dependency cleanup**: `npm audit fix` for the safe fixes, bump `ws`, migrate `multer` 1.x → 2.x (small API change), accept-and-document the Expo toolchain remainder, add `npm audit --omit=dev` as a CI step. **~3 days.** Unblocks #4.
3. **Integration test suite for auth + money paths**: Supertest against the Express app with a docker-d Postgres; cover register/login/refresh-rotation, expense CRUD with the float-rejection rule, settlement creation, and — critically — *negative* tests asserting member A of household X cannot read or mutate anything in household Y. **~2 sprints, realistically.** Unblocks #1, and is the single highest-value item on this list.
4. **Write the authorization matrix and threat model**: one page each — roles (admin/member) × resources × operations, and trust boundaries (browser ↔ API ↔ Postgres/MinIO/OpenAI/Resend, plus the WebSocket rooms). **~2 days.** Unblocks #3 and #5; do it before or alongside item 3, since the negative tests *are* the matrix made executable.
5. **Property-based tests for the settlement calculator** (fast-check: total øre preserved, no negative outputs, remainder always to admin, transaction count minimal). **~3 days.** Hardens the financially critical core beyond example-based cases.
6. **Centralize household scoping** into a middleware or query-helper that injects the `household_id` constraint, replacing per-route ad-hoc WHERE clauses. **~1 sprint.** Converts blocker #3 from "audit every query" to "audit one function" — exactly the transformation that makes machine review effective.

Total: roughly one quarter at solo part-time pace, with items 1, 2, and 4 done inside the first two weeks.

## 4. Risk Summary for Leadership

Translated to the solo context — this is what a CTO-you should hear:

The good news is unusual: this codebase's *legibility* is already where most teams wish theirs were. It's small, written in maximally strict TypeScript, structured as a clean modular monolith, and — rarest of all — its design intent is written down in spec artifacts that an AI reviewer can use as ground truth. The expensive part of readiness, which most organizations face, you've already paid via spec-driven development.

The gap is entirely on the *verification* side. There is no CI, no tests over the parts that matter most (login, sessions, money movement, household isolation), and four dozen known dependency vulnerabilities sitting unexamined. If you pointed an adversarial AI tool at this today, it would read the code easily, generate plausible findings — and then every one of them would land on you to manually confirm, with no test harness to confirm against and no pipeline to prevent the same bug returning. The tool's output would be homework, not protection.

The risk of waiting is concrete, not hypothetical: this app holds password hashes, auth tokens, and a financial ledger between household members, and the most likely vulnerability class — a query missing its household filter — has already occurred once in your own commit history. The cost to get ready is about one quarter of part-time effort, with the highest-value half (CI, dependency cleanup, authz matrix) achievable in two weeks. For a system this size, that's the entire bill; there is no long tail.

## 5. What "Good" Looks Like

Every push runs lint, strict typecheck, build, and a test suite in which the authorization matrix exists as executable negative tests — cross-household access attempts that must fail. The settlement calculator's invariants are property-tested, not just example-tested. `npm audit` is clean for production dependencies and enforced in CI. Household scoping happens in one auditable function instead of thirty query strings. The one-page threat model names the trust boundaries.

At that point, an AI adversarial reviewer becomes cheap to run continuously: it reads the spec to learn intent, reads the threat model to learn the boundaries, attacks the code, and its findings can be confirmed or dismissed against the test harness in minutes instead of evenings. The system stays exactly as small and self-hosted as it is now — it just stops depending on its one author being careful every single time.
