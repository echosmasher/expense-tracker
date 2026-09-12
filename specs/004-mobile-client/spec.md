# Feature Specification: Mobile Client (iOS PWA)

**Feature Branch**: `004-mobile-client`
**Created**: 2026-08-31 · **Revised**: 2026-09-12
**Status**: Agreed (ready for tickets)
**Depends on**: 001-expense-tracker-app (auth, receipts, expenses), 003-decouple-settlement (settlement snapshots)
**Blocks**: 005-multi-currency
**Plan**: [plan.md](./plan.md) · **Tickets**: GitHub issues labelled `spec:004-mobile-client`

---

## Summary

Household Wizard today is a desktop-shaped web app served by nginx on the LAN. Receipts can only be
added from a machine on the home network, which means a receipt has to survive in a pocket until
someone gets home and sits down at a computer. In practice they don't.

This spec turns the app into something usable from an iPhone, anywhere: a phone-shaped responsive
layout installed to the iOS home screen as a Progressive Web App, a session that survives relaunch,
a camera capture flow that produces a draft expense through the existing OpenAI receipt parser, a
capture queue so a scan never fails on a bad connection, and a publicly reachable deployment behind
Cloudflare Tunnel with the account surface locked to invitation only.

The app is a PWA and nothing else. There is no native shell, no App Store or TestFlight
distribution, and the retired Expo package is deleted rather than ported. This is a personal app
for two known members; it is also a public showcase repository, so security documentation and CI
gates are kept in step with every change.

### Revision notes (2026-09-12)

Against the 2026-08-31 draft:

- **Native iOS app (Capacitor / TestFlight) removed.** Installed web apps on iOS keep httpOnly
  cookies and are exempt from Safari's seven-day script-storage cap, so the native shell bought
  little for a lot of cost. The Expo package is deleted in this phase.
- **Session restore added as its own story.** Today the web app never uses the refresh cookie on
  load: every reload lands on the login page. On a home-screen app that would mean a password on
  every launch.
- **Online and offline capture unified on one path.** Every scan enters the local capture queue
  and is flushed immediately when online. The server creates the draft expense in a single call
  (upload, parse, categorise, create). There is one code path and one endpoint, not two.
- **Draft expenses become editable server-side.** The previous flow built the whole expense in the
  browser and created it on submit; a queued capture has nobody at the keyboard, so the server has
  to be able to create an incomplete draft and the client has to be able to edit it afterwards.
- **Security headers live in nginx**, which serves the SPA; the API's helmet config never applied
  to the app origin. Fonts are self-hosted so the content security policy and the offline shell
  don't depend on a third-party origin.
- **Constitution amendment included.** The constitution still names the Anthropic API, realtime
  WebSockets, a required React Native app, and public registration. It is amended in this phase.

## Business Value

The single biggest source of missing expenses is the gap between buying something and being at a
computer. Closing that gap — scan the receipt in the shop, on the spot — is the difference between
a tracker that reflects reality and one that has to be reconstructed from memory at settlement time.

Making the app reachable off-LAN is a hard prerequisite for every other mobile feature, and for
spec 005 (travel expenses), which is by definition used away from home.

---

## User Stories

### User Story 1 -- The App Fits a Phone and Installs to the Home Screen (Priority: P1)

A member opens Household Wizard on an iPhone and gets a layout designed for a phone: a bottom tab
bar instead of a desktop sidebar, thumb-reachable primary actions, and no horizontal scrolling.
They add it to the home screen and launch it without browser chrome. Opened with no connection, it
shows its own offline state rather than a browser error.

**Why this priority**: Every subsequent story is used on a phone. An eight-item desktop sidebar is
unusable at 390pt wide, so this gates all of them.

**Independent Test**: Load the app on a phone-sized viewport; all current screens are navigable and
readable with no changes to the API. Add to Home Screen; relaunch in airplane mode.

**Acceptance Scenarios**:

1. **Given** a viewport narrower than the tablet breakpoint, **When** any authenticated screen
   renders, **Then** navigation appears as a bottom tab bar with four destinations (Expenses,
   Settlement, Projects, More) and a visually distinct central Scan action.
2. **Given** a viewport at or above the tablet breakpoint, **When** any authenticated screen
   renders, **Then** the existing sidebar navigation is shown unchanged.
3. **Given** the app runs on a device with a home indicator, **Then** the bottom tab bar is inset
   above the safe area and no control is obscured by system UI.
4. **Given** any text input on any screen, **When** the user focuses it, **Then** the page does not
   zoom, and it does not remain zoomed after blur.
5. **Given** all destinations currently in the sidebar (Statistics, Household, Categories, Profile,
   Register Household, Log out), **Then** every one remains reachable on a phone from "More".
6. **Given** a member visits the app in mobile Safari, **When** they use Add to Home Screen,
   **Then** the app launches standalone (no browser chrome) with its own icon, name, and splash
   background.
7. **Given** the app was previously loaded, **When** it is opened with no network connection,
   **Then** the application shell renders and shows an explicit offline state, rather than a
   browser error page.
8. **Given** a new version has been deployed, **When** the user next launches the app, **Then**
   the new version is applied without a manual cache clear.
9. **Given** the app's fonts, **Then** they are served from the app's own origin so the offline
   shell and the content security policy do not depend on a third party.

---

### User Story 2 -- The Session Survives Relaunch (Priority: P1)

A member logs in once. Every later launch of the home-screen app, and every reload of the browser
tab, resumes their session silently for as long as the refresh credential is valid.

**Why this priority**: Without this the installed app asks for a password on every launch, which
makes the "scan in the shop" story slower than taking a photo and doing it at home. It is also a
latent defect in the desktop app today.

**Independent Test**: Log in, force-quit the home-screen app, relaunch; the expense list is shown
with no login prompt.

**Acceptance Scenarios**:

1. **Given** a valid refresh credential, **When** the app loads, **Then** a new access token is
   obtained silently and the member lands on their intended screen without seeing the login page.
2. **Given** no refresh credential or an expired or revoked one, **When** the app loads, **Then**
   the login page is shown, with no error flash for the ordinary "not signed in" case.
3. **Given** the session is being restored, **Then** the app shows a neutral loading state rather
   than briefly rendering the login page.
4. **Given** a member signs out, **Then** their refresh credential is revoked and the next launch
   shows the login page.
5. **Given** the browser client, **Then** the refresh credential remains an httpOnly cookie that is
   inaccessible to page scripts, and the rotation and reuse-detection behaviour is unchanged.
6. **Given** a deep link opened while signed out (for example an invite link), **When** the member
   signs in, **Then** they land on the deep-linked screen.

---

### User Story 3 -- Scan a Receipt and Land on a Draft (Priority: P1)

A member standing in a shop taps Scan, photographs the receipt, and lands on a review screen for a
draft expense that the server has already parsed and categorised. The member corrects what the
parser got wrong and confirms.

**Why this priority**: This is the feature the whole spec exists for.

**Independent Test**: Capture a receipt on a phone with connectivity and confirm the resulting
expense is indistinguishable from one created by the existing manual-entry path once confirmed.

**Acceptance Scenarios**:

1. **Given** a member taps Scan, **When** the device has a camera, **Then** the system camera opens
   for a single photo, and cancelling returns to the previous screen with nothing created.
2. **Given** a photo has been captured, **When** it is submitted, **Then** it is reduced in
   resolution and re-encoded to JPEG on the device before upload.
3. **Given** an iPhone that captures in HEIC, **When** the photo is submitted, **Then** the upload
   is accepted — the client never sends a format the API rejects.
4. **Given** a captured photo, **When** the upload completes, **Then** a single API call has
   sanitised and stored the image, parsed it, matched the card, categorised the items, and created
   an expense in `pending_review` attributed to the capturing member; the member lands on the
   review screen for that draft.
5. **Given** the draft review screen, **Then** the member can change the store, date, purchaser,
   card, and each line item, add and remove line items, and confirm — all against the stored draft,
   so nothing is lost if the screen is closed mid-edit.
6. **Given** a device or browser with no camera available, **Then** the Scan action falls back to
   choosing an existing image, and the rest of the flow is identical.
7. **Given** the parser returns no items (timeout or failure), **Then** the draft is still created
   with the photo attached and zero line items, and the member enters line items by hand. A draft
   with zero line items cannot be confirmed.
8. **Given** a scan started from inside a project, **Then** the draft is created in that project.
9. **Given** the existing manual "Add Expense" path (no receipt), **Then** it continues to work.

---

### User Story 4 -- Capture Never Fails, Even Offline (Priority: P1)

A member photographs receipts with no usable connection — roaming disabled, a basement restaurant,
a foreign SIM that hasn't attached. Capture always succeeds locally. Uploads and parsing happen
later, automatically, when connectivity returns while the app is open. Several receipts can be
captured back to back without waiting for any of them.

**Why this priority**: Without this, the on-the-go use case fails in exactly the situations it was
built for, and the receipt is gone by the time the member is back online.

**Independent Test**: Enable airplane mode, capture three receipts, re-enable connectivity, and
confirm three drafts appear with no user action beyond keeping the app open.

**Acceptance Scenarios**:

1. **Given** any capture, online or offline, **Then** it is written to the on-device queue first;
   with connectivity it is flushed immediately and the member lands on the draft; without, the
   member is told it is queued — no error is shown and no data is lost.
2. **Given** queued captures exist, **When** connectivity is restored while the app is open, or the
   app is launched or brought to the foreground, **Then** the queue uploads automatically without
   the member initiating it. (iOS offers no background execution to web apps; the queue does not
   flush while the app is closed.)
3. **Given** a member captures several receipts in succession, **Then** each is queued independently
   and the member is never blocked waiting for a previous upload or parse to finish.
4. **Given** queued captures exist, **Then** a pending count is visible on the Scan action, and the
   queue can be inspected as a list.
5. **Given** a queued capture whose upload fails permanently, **Then** it is shown in an explicit
   failed state with the reason and a retry action — it is never silently dropped.
6. **Given** a queued capture is successfully uploaded, **Then** it becomes a draft expense awaiting
   review and is removed from the queue.
7. **Given** the app is force-quit with items still queued, **When** it is relaunched, **Then** the
   queued items and their images are still present.
8. **Given** a queued capture, **Then** it records which household or project it was captured for,
   and lands there when flushed.
9. **Given** an upload that is interrupted and retried, **Then** at most one draft is created for
   that capture — a retry never duplicates an expense.

---

### User Story 5 -- Reachable From Anywhere, Safely (Priority: P1)

The app is served over HTTPS at a stable public hostname through a Cloudflare Tunnel and works over
cellular. Opening it to the internet does not open account creation to the internet: accounts exist
only by invitation, and the first account is created from the host's shell.

**Why this priority**: LAN-only is a hard blocker on every story above. Account lockdown is not
optional once the host is public — public registration lets a stranger create an account and spend
the household's OpenAI credit.

**Independent Test**: With the device on cellular and off the home network, complete a full login →
scan → review → confirm cycle.

**Acceptance Scenarios**:

1. **Given** a device with no connection to the home network, **When** a member opens the public
   hostname, **Then** the app loads over HTTPS and authenticated requests succeed.
2. **Given** the public deployment, **When** anyone attempts to create an account without a valid
   invitation, **Then** the request is rejected — there is no self-service registration route or
   page.
3. **Given** a valid, unexpired, unused invitation, **When** the invitee follows it, **Then** they
   can create their account exactly as before.
4. **Given** a brand-new deployment with an empty database, **Then** there is a documented
   command, run on the host, that creates the first account. It is not reachable over the network.
5. **Given** any response from the web origin, **Then** it carries a content security policy,
   HSTS, MIME-sniffing protection, a referrer policy, and a permissions policy that allows the
   camera only for the app's own origin.
6. **Given** the content security policy, **Then** the app's own fonts, images, blob URLs, and API
   calls all function under it with no console violations — the policy is verified against the
   running app, not assumed.
7. **Given** the API's per-IP rate limits, **Then** they key on the real client address as passed
   by the tunnel, not on the tunnel's or nginx's address.
8. **Given** the app is reachable publicly, **Then** `THREAT-MODEL.md` and `AUTHORIZATION.md` are
   updated to reflect that the LAN perimeter no longer exists and that registration is gone.
9. **Given** `DEPLOYMENT.md`, **Then** it describes the tunnel setup as the one supported path and
   no longer describes exposing the object store.

---

### User Story 6 -- Receipt Images Load Without Exposing Storage (Priority: P1)

Receipt and avatar images display on a phone over cellular, without the object store being
reachable from the public internet and without image access depending on a link that expires.

**Why this priority**: Ships with User Story 5 — otherwise every receipt renders as a broken image
off-LAN. It also closes a real authorization gap: a signed URL is a bearer credential that outlives
the session that minted it.

**Independent Test**: From cellular, open an expense with a receipt and confirm the image renders;
confirm the object store is not reachable from the same device.

**Acceptance Scenarios**:

1. **Given** an authenticated member of the owning household, **When** they open an expense with a
   receipt, **Then** the image is served through the API and renders.
2. **Given** an authenticated user who is not a member of the owning household, **When** they
   request that receipt image, **Then** the request is rejected as forbidden.
3. **Given** an unauthenticated request for a receipt image, **Then** it is rejected.
4. **Given** an expense screen left open for longer than the old signed-URL lifetime, **When** the
   member reloads the image, **Then** it still renders — image access does not expire.
5. **Given** the deployment, **Then** the object store has no publicly reachable endpoint and no
   configuration variable describing one.
6. **Given** a member's avatar, **Then** it is served the same way, to the owner only.
7. **Given** any image response, **Then** it is marked non-cacheable by shared caches.

---

### User Story 7 -- One Client, One Honest Constitution (Priority: P2)

The retired Expo package is deleted, and the constitution is amended to describe the system as it
now is, so a reader of the public repository is not misled.

**Why this priority**: Not user-facing, but it removes every remaining `npm audit` finding,
simplifies both Dockerfiles and CI, and stops the domain docs pointing at a package that no longer
matters. Cheap, and it makes later tickets easier.

**Independent Test**: `npm audit --omit=dev` is clean for every workspace; CI passes; the
constitution's principles match the code.

**Acceptance Scenarios**:

1. **Given** the repository, **Then** the `mobile/` workspace no longer exists, and no build,
   lint, CI, Dockerfile, or documentation step references it.
2. **Given** `npm audit --omit=dev` across all workspaces, **Then** it is clean and enforced in CI
   for all of them.
3. **Given** `.specify/memory/constitution.md`, **Then** it is at version 2.0.0 and: names OpenAI
   as the parsing provider; drops the React Native client and the realtime requirement; lists
   `accept-invite` (not `register`) as the only unauthenticated account-creation route; describes
   the offline capture queue as the only offline write; and records the amendment rationale.

---

## Edge Cases

- A capture is queued for a project that is deleted, or a household the member is removed from,
  before the queue flushes. The flush fails with a clear reason and the item is retained in the
  failed state so the image is not lost.
- The device's clock is wrong or the timezone differs from home. Queued captures record when they
  were taken; the expense date remains what the parser reads from the receipt or what the member
  enters.
- Device storage fills while captures are queued. The member is told capture cannot proceed rather
  than the app silently discarding an earlier queued item.
- A very large or very dark photo is captured. Downscaling still produces an accepted upload; a
  failed parse degrades to a zero-item draft.
- The same receipt is captured twice. Both become separate drafts; de-duplication is out of scope.
- Connectivity returns mid-upload and drops again. A partially uploaded capture is retried from the
  beginning; a retry presents the same capture identity so the server never creates a second draft.
- The session expires while items are queued. The items stay queued; the flush resumes after the
  member signs in again.
- The public hostname is unreachable because the host machine is off or asleep. The app shows an
  offline state and queued captures remain queued.
- A member has the app open in Safari and installed on the home screen. iOS gives them separate
  cookie jars; each is its own session and both work.

## Out of Scope (V1)

- Any native app, Capacitor shell, App Store, or TestFlight distribution.
- Android, iPad-optimised layouts, and any non-iOS target beyond "still works in a desktop browser".
- Offline creation or editing of expenses, settlements, projects, or categories. The queue holds
  captured images only; there is no offline write model and no conflict resolution.
- Offline reading of expense data. Only the application shell is available offline.
- Push notifications. Settlement notification remains email.
- Receipt de-duplication, multi-page receipts, and stitching several photos into one expense.
- Biometric app lock, PIN, and per-device session management UI.
- Home screen widgets, Siri/App Intents, and an iOS share extension.
- Location tagging of expenses. Location metadata continues to be stripped from every image.
- Any change to the settlement algorithm or to how expenses are split.
- Porting the Expo package's screens. The package is removed, not ported.

## Non-Functional Requirements

- The browser client's session behaviour and its resistance to script-based credential theft MUST
  NOT regress. The refresh credential stays an httpOnly cookie.
- Every new API route MUST have an entry in `AUTHORIZATION.md` and a negative cross-household test
  in `backend/test/household-isolation.test.ts`, per the project convention.
- The client MUST NOT assume the API is same-origin. The API base URL is configuration, defaulting
  to same-origin.
- Captured images MUST be reduced on-device before upload so a scan is usable on a mobile
  connection within the existing parser timeout.
- Authenticated API responses MUST NOT be persisted to any offline cache. The service worker MUST
  treat every `/api/` request as network-only.
- The queue MUST survive app termination and MUST NOT lose an image as a result of a failed upload,
  a failed parse, or an app crash.
- Draft creation from a capture MUST be idempotent per capture, so a retried upload never creates
  a duplicate expense and a partial upload never creates a partial expense.
- The public deployment MUST terminate TLS and MUST NOT serve the application over plain HTTP.
- Existing browser users MUST NOT be signed out by this work.
- The web workspace gains a unit-test runner; the queue state machine and the draft endpoints are
  covered by automated tests, and CI runs them.

## Success Criteria

- **SC-001**: Every authenticated screen is fully usable at 390pt width with no horizontal scroll
  and no control obscured by system UI. Verified on a physical iPhone.
- **SC-002**: A member on cellular, off the home network, completes login → scan → review → confirm
  and the expense appears for the other household member. Verified end to end on a physical device.
- **SC-003**: With the network disabled, three consecutive captures all succeed locally; on
  restoring the network, all three upload and become drafts with no user action and none is lost.
  Verified by manual airplane-mode test and by an automated queue test.
- **SC-004**: Time from tapping Scan to the camera being ready is not gated on a network request.
- **SC-005**: No unauthenticated or cross-household request can retrieve a receipt image, and the
  object store is not reachable from outside the host. Verified by isolation test and by an
  external port check.
- **SC-006**: Account creation is impossible without a valid invitation. Verified by an integration
  test asserting the public registration route no longer exists.
- **SC-007**: The security headers on the public origin are present and the app functions fully
  under the content security policy with no console violations. Verified against the running app.
- **SC-008**: A signed-in member relaunches the home-screen app and reaches the expense list with
  no login prompt; a signed-out member sees the login page. Verified on device and by test.
- **SC-009**: Retrying an interrupted capture upload creates exactly one expense. Verified by
  integration test replaying the same capture identity.
- **SC-010**: `npm audit --omit=dev` is clean across all workspaces once the Expo package is
  removed, and CI enforces it for all of them.

## Assumptions

- Two known members, both on iOS. No Android device needs to be supported.
- The household accepts that the app's availability is bounded by the availability of the host
  machine and its connection.
- Receipt images continue to be sent to OpenAI for parsing, and continue to have metadata stripped
  before leaving the host.
- A domain and a Cloudflare account are available. No Apple Developer Program membership is needed.
- The existing invitation flow (hashed, single-use, expiring tokens) is sufficient as the sole
  account-creation path.
- Installed web apps on iOS retain their cookies and IndexedDB across launches unless the user
  removes the app; this is treated as durable enough for a personal app.
