# Feature Specification: Mobile Client (PWA → native iOS)

**Feature Branch**: `004-mobile-client`
**Created**: 2026-08-31
**Status**: Draft
**Depends on**: 001-expense-tracker-app (auth, receipts, expenses), 003-decouple-settlement (settlement snapshots)
**Blocks**: 005-multi-currency

---

## Summary

Household Wizard today is a desktop-shaped web app served by nginx on the LAN. Receipts can only be
added from a machine on the home network, which means a receipt has to survive in a pocket until
someone gets home and sits down at a computer. In practice they don't.

This spec turns the app into something usable from a phone, anywhere: a phone-shaped responsive
layout installable to the iOS home screen, a camera capture flow that feeds the existing OpenAI
receipt parser, an upload queue so capture never fails on a bad connection, a publicly reachable
deployment, and finally a native iOS shell built from the same web bundle via Capacitor.

The app is delivered in phases that each stand alone. Phase 1 (responsive shell + installable PWA)
is useful on its own and requires no changes to authentication or deployment.

## Business Value

The single biggest source of missing expenses is the gap between buying something and being at a
computer. Closing that gap — scan the receipt in the shop, on the spot — is the difference between
a tracker that reflects reality and one that has to be reconstructed from memory at settlement time.

Making the app reachable off-LAN is a hard prerequisite for every other mobile feature, and for
spec 005 (travel expenses), which is by definition used away from home.

---

## User Stories

### User Story 1 -- The App Fits a Phone (Priority: P1)

A member opens Household Wizard on an iPhone and gets a layout designed for a phone: a bottom tab
bar instead of a desktop sidebar, thumb-reachable primary actions, and no horizontal scrolling.
They can install it to the home screen and launch it without browser chrome.

**Why this priority**: Every subsequent story is used on a phone. An eight-item desktop sidebar is
unusable at 390pt wide, so this gates all of them.

**Independent Test**: Load the existing app on a phone-sized viewport; all current screens are
navigable and readable with no code changes to the API.

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
5. **Given** all eight destinations currently in the sidebar, **Then** every one remains reachable
   on a phone — those not in the tab bar are reachable from "More".
6. **Given** a member visits the app in mobile Safari, **When** they use Add to Home Screen,
   **Then** the app launches standalone (no browser chrome) with its own icon, name, and splash
   background.
7. **Given** the app was previously loaded, **When** it is opened with no network connection,
   **Then** the application shell renders and shows an explicit offline state, rather than a
   browser error page.
8. **Given** a new version has been deployed, **When** the user next launches the app, **Then**
   the new version is applied without a manual cache clear.

---

### User Story 2 -- Scan a Receipt With the Camera (Priority: P1)

A member standing in a shop taps Scan, photographs the receipt, and gets the same parsed line-item
review screen the current upload flow produces.

**Why this priority**: This is the feature the whole spec exists for.

**Independent Test**: Capture a receipt on a phone with connectivity and confirm the resulting
expense is indistinguishable from one created by the existing file-upload path.

**Acceptance Scenarios**:

1. **Given** a member taps Scan, **When** the device has a camera, **Then** the system camera opens
   for a single photo, and cancelling returns to the previous screen with nothing created.
2. **Given** a photo has been captured, **When** it is submitted, **Then** it is reduced in
   resolution and re-encoded to JPEG on the device before upload.
3. **Given** an iPhone that captures in HEIC, **When** the photo is submitted, **Then** the upload
   is accepted — the client never sends a format the API rejects.
4. **Given** a captured photo, **When** the upload completes, **Then** the existing parse,
   card-matching, and categorization behaviour applies unchanged and the member lands on the
   line-item review screen.
5. **Given** a device or browser with no camera available, **Then** the Scan action falls back to
   choosing an existing image, and the rest of the flow is identical.
6. **Given** the parser returns no items (timeout or failure), **Then** the member still reaches the
   review screen with the photo attached and can enter line items by hand.

---

### User Story 3 -- Capture Never Fails, Even Offline (Priority: P1)

A member photographs receipts with no usable connection — roaming disabled, a basement restaurant,
a foreign SIM that hasn't attached. Capture always succeeds locally. Uploads and parsing happen
later, automatically, when connectivity returns. Several receipts can be captured back to back
without waiting for any of them.

**Why this priority**: Without this, the on-the-go use case fails in exactly the situations it was
built for, and the receipt is gone by the time the member is back online.

**Independent Test**: Enable airplane mode, capture three receipts, re-enable connectivity, and
confirm three parsed drafts appear with no user action.

**Acceptance Scenarios**:

1. **Given** no network connection, **When** a member captures a receipt, **Then** the capture is
   stored on the device and the member is told it is queued — no error is shown and no data is lost.
2. **Given** queued captures exist, **When** connectivity is restored or the app is reopened,
   **Then** the queue uploads automatically without the member initiating it.
3. **Given** a member captures several receipts in succession, **Then** each is queued independently
   and the member is never blocked waiting for a previous upload or parse to finish.
4. **Given** queued captures exist, **Then** a pending count is visible from the main navigation,
   and the queue can be inspected as a list.
5. **Given** a queued capture whose upload fails permanently, **Then** it is shown in an explicit
   failed state with the reason and a retry action — it is never silently dropped.
6. **Given** a queued capture is successfully uploaded and parsed, **Then** it becomes a normal
   expense awaiting review and is removed from the queue.
7. **Given** the app is force-quit with items still queued, **When** it is relaunched, **Then** the
   queued items and their images are still present.
8. **Given** a queued capture, **Then** it records which household or project it was captured for,
   and lands there when flushed.

---

### User Story 4 -- Reachable From Anywhere, Safely (Priority: P1)

The app is served over HTTPS at a stable public hostname and works over cellular. Opening it to the
internet does not open account creation to the internet: accounts exist only by invitation.

**Why this priority**: LAN-only is a hard blocker on every story above. Account lockdown is not
optional once the host is public — public registration lets a stranger create an account and spend
the household's OpenAI credit.

**Independent Test**: With the device on cellular and off the home network, complete a full login →
scan → review → confirm cycle.

**Acceptance Scenarios**:

1. **Given** a device with no connection to the home network, **When** a member opens the public
   hostname, **Then** the app loads over HTTPS and authenticated requests succeed.
2. **Given** the public deployment, **When** anyone attempts to create an account without a valid
   invitation, **Then** the request is rejected — there is no self-service registration path.
3. **Given** a valid, unexpired, unused invitation, **When** the invitee follows it, **Then** they
   can create their account exactly as before.
4. **Given** a brand-new deployment with an empty database, **Then** there is a documented way to
   create the first account, which is not reachable over the network.
5. **Given** any response from the web origin, **Then** it carries a content security policy,
   HSTS, MIME-sniffing protection, and a referrer policy.
6. **Given** the content security policy, **Then** the app's own fonts, images, and API calls all
   function under it — the policy is verified against the running app, not assumed.
7. **Given** the app is reachable publicly, **Then** the documented trust boundaries and threat
   table are updated to reflect that the LAN perimeter no longer exists.

---

### User Story 5 -- Receipt Images Load Without Exposing Storage (Priority: P1)

Receipt images display on a phone over cellular, without the object store being reachable from the
public internet and without image access depending on a link that expires.

**Why this priority**: Ships with User Story 4 — otherwise every receipt renders as a broken image
off-LAN. It also closes a real authorization gap.

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
5. **Given** the deployment, **Then** the object store has no publicly reachable endpoint.

---

### User Story 6 -- Native iOS App (Priority: P2)

The same web bundle runs as a native iOS app installed from TestFlight, with the system camera and
credentials held in the platform keychain. Sessions survive across app launches.

**Why this priority**: The PWA delivers most of the value first. This adds durable installation,
native capture, and storage that iOS will not evict — but it depends on everything above being
stable.

**Independent Test**: Install from TestFlight, log in, force-quit, relaunch, and confirm the session
is intact and a scan completes end to end.

**Acceptance Scenarios**:

1. **Given** the native app, **When** a member logs in, **Then** their session persists across
   force-quit and device restart without re-entering a password.
2. **Given** the native app has been unused for weeks, **When** it is reopened within the refresh
   window, **Then** the member is still signed in.
3. **Given** the native app, **When** a member taps Scan, **Then** the native camera is used rather
   than a web file picker.
4. **Given** the browser-based app, **Then** its session handling is unchanged from today and its
   refresh credential remains inaccessible to page scripts.
5. **Given** a session credential is presented twice, **Then** the existing reuse-detection
   behaviour applies identically regardless of client type.
6. **Given** the native app, **Then** it does not run a service worker, and it never serves a stale
   bundle after an update.
7. **Given** a member signs out on one client, **Then** that client's session is revoked and other
   clients are unaffected.

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
  failed parse degrades to the existing empty-items behaviour.
- The same receipt is captured twice. Both become separate expenses; de-duplication is out of scope.
- Connectivity returns mid-upload and drops again. A partially uploaded capture is retried from the
  beginning; a partial upload never creates a partial expense.
- A member is signed in on both the PWA and the native app. Both sessions work independently.
- The public hostname is unreachable because the host machine is off or asleep. The app shows an
  offline state and queued captures remain queued.

---

## Out of Scope (V1)

- Android, iPad-optimised layouts, and any non-iOS native target.
- App Store distribution and public availability. Distribution is TestFlight-internal only.
- Offline creation or editing of expenses, settlements, projects, or categories. The queue holds
  captured images only; there is no offline write model and no conflict resolution.
- Offline reading of expense data. Only the application shell is available offline.
- Push notifications. Settlement notification remains email.
- Receipt de-duplication, multi-page receipts, and stitching several photos into one expense.
- Biometric app lock, PIN, and per-device session management UI.
- Home screen widgets, Siri/App Intents, and an iOS share extension for importing receipts from
  Photos or Mail.
- Location tagging of expenses. Location metadata continues to be stripped from every image.
- Any change to the settlement algorithm or to how expenses are split.
- Migration of the retired Expo package's screens. The package is removed, not ported.

---

## Non-Functional Requirements

- The browser client's session behaviour and its resistance to script-based credential theft MUST
  NOT regress. Any alternative credential transport MUST be confined to the native client.
- Session rotation and reuse detection MUST be identical for all client types; only the transport
  of the credential may differ.
- Every new API route MUST have an entry in `AUTHORIZATION.md` and a negative cross-household test
  in `backend/test/household-isolation.test.ts`, per the project convention.
- A single web bundle MUST serve both the browser and native clients. Platform differences are
  resolved at runtime behind a narrow interface, not by forking screens or maintaining a parallel
  route tree.
- The client MUST NOT assume the API is same-origin. The API base URL is configuration.
- Captured images MUST be reduced on-device before upload so a scan is usable on a mobile
  connection within the existing parser timeout.
- Authenticated API responses MUST NOT be persisted to any offline cache.
- The queue MUST survive app termination and MUST NOT lose an image as a result of a failed upload,
  a failed parse, or an app crash.
- The public deployment MUST terminate TLS and MUST NOT serve the application over plain HTTP.
- Existing browser users MUST NOT be signed out by this work.

---

## Success Criteria

- **SC-001**: Every authenticated screen is fully usable at 390pt width with no horizontal scroll
  and no control obscured by system UI. Verified on a physical iPhone.
- **SC-002**: A member on cellular, off the home network, completes login → scan → review → confirm
  and the expense appears for the other household member. Verified end to end on a physical device.
- **SC-003**: With the network disabled, three consecutive captures all succeed locally; on
  restoring the network, all three upload and parse with no user action and none is lost. Verified
  by manual airplane-mode test and by an automated queue test.
- **SC-004**: Time from tapping Scan to the camera being ready is not gated on a network request.
- **SC-005**: No unauthenticated or cross-household request can retrieve a receipt image, and the
  object store is not reachable from outside the host. Verified by isolation test and by an
  external port check.
- **SC-006**: Account creation is impossible without a valid invitation. Verified by an integration
  test asserting the public registration path no longer exists.
- **SC-007**: The security headers on the public origin are present and the app functions fully
  under the content security policy with no console violations. Verified against the running app.
- **SC-008**: In the native app, a session survives force-quit and device restart, and a rotated
  credential presented twice still triggers family-wide revocation. Verified on device and by test.
- **SC-009**: The browser client's refresh credential remains unreadable from page scripts after
  this work. Verified by test.
- **SC-010**: `npm audit --omit=dev` is clean across all remaining workspace packages once the Expo
  package is removed.

## Assumptions

- Two known members, both on iOS. No Android device needs to be supported.
- The household accepts that the app's availability is bounded by the availability of the host
  machine and its connection.
- Receipt images continue to be sent to OpenAI for parsing, and continue to have metadata stripped
  before leaving the host.
- An Apple Developer Program membership is available for TestFlight distribution before User Story 6
  ships. Stories 1-5 do not require one.
- The existing invitation flow (hashed, single-use, expiring tokens) is sufficient as the sole
  account-creation path.
