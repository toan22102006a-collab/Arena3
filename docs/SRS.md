# Arena3 — Software Requirements Specification

**Version 1.0 · 2026-09-20 · Status: as-built**

This document describes what the Arena3 system does, for whom, and under which
rules. It is written *as-built*: every requirement below is implemented in this
repository, and each one names the endpoint, rule code or table that carries it
so the claim can be checked rather than believed. Where the system deliberately
does *not* do something, that is recorded too — a requirements document that
only lists the pleasant parts is a sales brochure.

The companion document [SDD.md](SDD.md) explains *how* these requirements are
implemented. This one stops at *what*.

---

## 1. Purpose and scope

### 1.1 The problem

A single-site sports centre runs four businesses that share one set of courts:
casual court hire, coached classes, memberships, and the front counter that
takes money for all three. Run on paper or on a spreadsheet, these four collide
in predictable ways: a court is sold twice, a class is taught on a court someone
has booked, a member pays and has nothing to prove it, and at the end of the
month nobody can say what was earned.

Arena3 is one schedule and one ledger for all four.

### 1.2 In scope

- Court availability, holds, bookings, check-in, change of slots, and cancellation.
- Classes: timetable generation, enrolment, waitlists, attendance tracking, and student evaluation.
- Memberships: plans, orders, activation, upgrading, freezing, cancellation, and quota consumption.
- The front desk: till shifts, payments, refunds, receipts, walk-ins, equipment.
- Management: pricing, opening rules, revenue and occupancy reporting, audit.
- Customer care: a member can ask the desk something, read the answer, and receive email/SMS notifications.
- An in-app assistant that answers from the centre's own data.

### 1.3 Out of scope

Deliberately, and recorded so nobody plans around them:

- **Multi-site.** One centre per deployment. `center_settings` is a single row
  with a `CHECK (id = 1)`.
- **Real payment processing.** No card acquirer, no bank API, no payment
  gateway. `method` on a payment records how money was taken at the counter;
  a bank transfer is reconciled by a human reading a statement (§5.4).
- **Accounting integration.** Invoices are issued and printable; they are not
  exported to any accounting package.
- **Medical or fitness advice.** The assistant refuses this explicitly.

### 1.4 Definitions

| Term | Meaning |
| --- | --- |
| **Slot** | One bookable unit of court time. `slot_minutes`, default 60. |
| **Hold** | A slot reserved but not yet paid for. Expires automatically. |
| **Occupancy** | The row that makes a court busy. Courts are booked *through* occupancies, never directly (see SDD §4.2). |
| **Quota** | Court hours or class sessions included in a membership plan. |
| **Till shift** | A period during which one receptionist takes money. Opened and closed; cash is counted at close. |
| **ICT** | Indochina Time, UTC+7. Every business date in the system is an ICT date. |
| **BR-nn** | A numbered business rule. Returned to the client in the error body so a refusal can be traced to a rule. |

---

## 2. Actors

| Actor | Who they are | Where they work |
| --- | --- | --- |
| **Member** | A customer of the centre, with or without a membership. | `/app/*`, `/account` |
| **Receptionist** | Front-desk staff. Takes money, opens tills, reconciles transfers, answers requests. | `/desk/*` |
| **Coach** | Teaches classes. Sees their own timetable and marks attendance. | `/coach` |
| **Manager** | The highest role, provisioned by the system. Operates the entire system and centre. Manages role assignments, pricing, plans, settings, reports, refund sign-offs, and includes all receptionist capabilities. | `/manager/*`, `/desk/*` |
| **Guest / walk-in** | Not signed in, or has no account. Served entirely by a receptionist. | — |
| **Automatic System** | Not a person: the job loop that expires holds, marks no-shows, generates sessions and sends reminders. | — |

Roles are exclusive — a user has exactly one — and are enforced server-side on
every request (`requireRole`). The UI hides what a role cannot do; that is a
convenience, not the control. Note that staff members (Coach, Receptionist, Manager) can also purchase plans or book courts acting as a Member.

---

## 3. Assumptions and dependencies

- **A1.** One centre, one timezone (`Asia/Ho_Chi_Minh`), one currency (VND).
- **A2.** Prices are whole dong. Money is never stored as a float; every amount
  is an integer VND column, rounded to `round_vnd` (default 1,000).
- **A3.** A member has a Vietnamese mobile number, and it is unique. The phone
  number is the login identity.
- **A4.** Staff are trusted within their role. This system protects against
  mistakes and against members acting outside their rights; it does not defend
  the till against the person standing at it. It records who did what instead
  (§7.5).
- **A5.** PostgreSQL 16 or compatible. The schema relies on `btree_gist`
  exclusion constraints, `jsonb`, and PL/pgSQL. This is not portable to MySQL.
- **A6.** The assistant requires a Gemini API key. Without one it falls back to
  in-house rule-based answers rather than failing (§9.2).

---

## 4. Functional requirements — Member

### 4.1 Identity

| ID | Requirement | Enforced by |
| --- | --- | --- |
| FR-M01 | A person registers with name, phone, date of birth and a password. | `POST /v1/auth/register` |
| FR-M02 | A phone number may hold exactly one account. | **BR-01** |
| FR-M03 | A password is at least 8 characters and mixes letters and digits. Registration and change both require it typed twice. | **BR-02** |
| FR-M04 | A member under `minor_age` (default 16) cannot register without guardian name and phone. | **BR-07** |
| FR-M05 | Registration requires explicit acceptance of the terms and the data-privacy notice. | **BR-08** |
| FR-M06 | Registration is confirmed by an OTP. | `POST /v1/auth/otp/verify` |
| FR-M07 | A member may edit their own name and health notes, and change their own password. Neither can be done for another user. | `PATCH /v1/me`, `POST /v1/me/password` |
| FR-M08 | A member session lasts 7 days; a staff session lasts 12 hours. | `issueSession` |
| FR-M09 | A member can view their attendance and track their training progress. | `GET /v1/me/progress` |

> **Implementation note.** In demonstration and development environments without
> configured SMS credentials, the registration OTP is displayed on screen. When
> SMS integration is active via feature flags (FR-G10, BR-60, BR-62), OTP codes
> are securely dispatched directly to the member's mobile phone via SMS transport.

### 4.2 Booking a court

| ID | Requirement | Enforced by |
| --- | --- | --- |
| FR-B01 | A member sees a visual schedule of live availability per court and day, including which slots are held by others. | `GET /v1/occupancy` |
| FR-B02 | Booking a slot creates a **hold**, not a booking. The hold lasts `hold_minutes` (default 5). | `POST /v1/bookings` |
| FR-B03 | Two members cannot hold the same court-time. The second attempt is refused, not queued. | Court row lock + overlap trigger → `409 CONFLICT_SLOT` |
| FR-B04 | A slot in the past cannot be booked. | **BR-66** |
| FR-B05 | A slot outside `open_time`–`close_time` cannot be booked. | **BR-35** |
| FR-B06 | A member may book at most `book_ahead_days` (default 7) days ahead. | **BR-32** |
| FR-B07 | A member may hold at most `max_slots_per_day` (default 2) slots for any one day. | **BR-32** |
| FR-B08 | A member owing more than `debt_limit_vnd` cannot book until they settle. | **BR-44** |
| FR-B09 | A court not in `ready` status cannot be booked. | **BR-35** |
| FR-B10 | An unpaid hold is released automatically when its clock runs out, and the slot returns to sale. | `expireHolds` job |
| FR-B11 | Paying converts the hold to a confirmed booking, posts a payment and issues a receipt — atomically. Either all of it happens or none of it does. | `POST /v1/bookings/:id/confirm` |
| FR-B12 | A member with court hours left on their plan may pay with quota instead of money. One hour is consumed. | **BR-17** |
| FR-B13 | Paying by bank transfer does **not** confirm the booking (§5.4). | `POST /v1/bookings/:id/confirm` → `202` |
| FR-B14 | A member may cancel their own court up to `cancel_court_hours` (default 2) before it starts. | `POST /v1/bookings/:id/cancel` |
| FR-B15 | A member may check in from `checkin_before_minutes` (default 15) before the start. | `POST /v1/bookings/:id/check-in` |
| FR-B16 | A booking nobody checks into is marked a no-show after `noshow_grace_minutes`, and is not refunded. | `markNoshow` job |
| FR-B17 | A member can change/reschedule a successfully booked slot up to `cancel_court_hours` before it starts. | `POST /v1/bookings/:id/reschedule` |

### 4.3 Classes

| ID | Requirement | Enforced by |
| --- | --- | --- |
| FR-C01 | A member sees the published timetable with remaining places. | `GET /v1/classes` |
| FR-C02 | Enrolling requires an active plan covering that sport. | **BR-12** |
| FR-C03 | A plan with a session quota must have sessions left. | **BR-18** |
| FR-C04 | A member cannot enrol twice in the same class or in a class that clashes with an existing enrolment. | **BR-24** |
| FR-C05 | A class that is not `open` cannot be enrolled in. | **BR-67** |
| FR-C06 | When a class is full, enrolling joins a first-come waitlist with a visible position. | `enrollment_waitlist` |
| FR-C07 | When a place frees, the first person on the waitlist is offered it. The offer stands for `waitlist_offer_hours` (default 2), then passes to the next person. | `waitlistExpire` job |
| FR-C08 | An expired offer cannot be accepted. | **BR-25** |
| FR-C09 | A class that filled between the offer and the acceptance refuses the acceptance rather than overfilling. | **BR-22** |
| FR-C10 | A member may leave a class up to `cancel_class_hours` (default 4) before the next session. | **BR-20** |
| FR-C11 | A member can review their coach and leave feedback or receive recommendations. | `POST /v1/feedback` |

### 4.4 Membership

| ID | Requirement | Enforced by |
| --- | --- | --- |
| FR-P01 | A member sees the plans currently on sale, with what each includes. | `GET /v1/plans` |
| FR-P02 | Ordering a plan creates a `pending` subscription. It is not active until paid for. | `POST /v1/subscriptions` |
| FR-P03 | A plan withdrawn from sale cannot be ordered by a member. | **BR-65** |
| FR-P04 | A member with a frozen plan cannot buy another until they unfreeze it. | **BR-14** |
| FR-P05 | Plan orders are rate limited: 3 per minute and 10 per hour per member. | `RULES.planRequest*` |
| FR-P06 | A subscription activates when enough has been paid — in full, or `deposit_pct_activates` if the centre allows deposits. | `activateSubscription` |
| FR-P07 | A member may freeze an active plan, up to `freeze_max_days_year` days a year. | **BR-14**, **BR-15** |
| FR-P08 | A member can upgrade their active membership plan by paying the price difference. | `POST /v1/subscriptions/:id/upgrade` |
| FR-P09 | A member can cancel their membership plan. | `POST /v1/subscriptions/:id/cancel`, **BR-47** |

### 4.5 Money, from the member's side

| ID | Requirement | Enforced by |
| --- | --- | --- |
| FR-R01 | Every payment a member makes issues an invoice with line detail. | `invoices`, `invoice_lines` |
| FR-R02 | A member can see every receipt Arena3 has ever issued them and open each as a PDF. | `GET /v1/invoices`, `/account` › Receipts |
| FR-R03 | **Every payment, by any method, notifies the payer with the amount and a link to the receipt.** | `enqueueReceipt` |
| FR-R04 | A refunded payment is shown as refunded wherever it appears. | `payments.status` |

### 4.6 Customer care

| ID | Requirement | Enforced by |
| --- | --- | --- |
| FR-S01 | A member can send the front desk a question or complaint, from the assistant (`ticket: …`) or from Account › Support. | `POST /v1/tickets` |
| FR-S02 | Repeated `ticket:` prefixes are stripped; the desk reads the message, not the instruction. | `ticketBody` |
| FR-S03 | A request with no content is refused rather than opened blank. | `ticketsCreate` |
| FR-S04 | **A member can see every request they have sent and the reply to each.** | `GET /v1/tickets/mine` |
| FR-S05 | A member is notified when the desk replies. | `ticket_replied` notification |
| FR-S06 | A member can receive notifications via both Email and SMS (in addition to in-app). | `email`/`sms` transport |

### 4.7 The assistant

| ID | Requirement | Enforced by |
| --- | --- | --- |
| FR-A01 | The assistant answers about opening hours, prices, plans, coaches, classes, booking, cancelling and waitlists, from the centre's live data — not from general knowledge. | `assistantChat` |
| FR-A02 | A question is at most 800 characters. The composer stops there and says so. | `MAX_CHARS` |
| FR-A03 | At most 20 questions a minute per member. | `RULES.assistant` |
| FR-A04 | The assistant gives no medical advice. | System prompt and fallback text |
| FR-A05 | With no model key configured, the assistant answers from rules rather than failing. The answer is labelled with its source. | `generateAssistantReply` |
| FR-A06 | The assistant can open a support request but can never take money, book, cancel or change anything. | No mutating tools are exposed to it |

---

## 5. Functional requirements — Front desk

### 5.1 Till shifts

| ID | Requirement | Enforced by |
| --- | --- | --- |
| FR-D01 | A receptionist opens a till shift before taking money. | **BR-49** |
| FR-D02 | Only one shift per receptionist may be open at a time. | `shiftOpen` |
| FR-D03 | Closing a shift records counted cash against the books' expectation. | `POST /v1/shifts/:id/close` |
| FR-D04 | Every payment a receptionist takes is attached to their shift. | `payments.shift_id` |

### 5.2 Serving people

| ID | Requirement | Enforced by |
| --- | --- | --- |
| FR-D05 | A receptionist can find a member by name, phone or member code. | `GET /v1/members?q=` |
| FR-D06 | A receptionist can create a member at the counter and sell them a plan in one flow. The plan is automatically activated upon payment. | `POST /v1/members` |
| FR-D07 | A receptionist can sell a court to a walk-in with no account, taking name and phone only, without storing an account. | `POST /v1/walk-in` |
| FR-D08 | A walk-in may be sold into a slot already under way, provided at least 20 minutes remain. | **BR-66** |
| FR-D09 | A receptionist can lend and take back equipment, and stock is enforced. | **BR-38** |
| FR-D10 | A receptionist can explicitly select a specific court from a visual board when making a booking. | `POST /v1/bookings` |

### 5.3 Taking money

| ID | Requirement | Enforced by |
| --- | --- | --- |
| FR-D11 | A payment records method, amount, VAT rate, what it was for, who took it and which shift. | `payments` |
| FR-D12 | Every payment issues an invoice. | `paymentsCreate` |
| FR-D13 | A repeated payment request with the same idempotency key returns the original payment instead of taking the money twice. | `withIdempotency` |
| FR-D14 | **Reception can see every payment taken in the last 7/14/30 days, by any method, with its receipt — filterable by method.** Receipts are accessible directly from the desk home to improve UX. | `GET /v1/payments/pending` |

### 5.4 Bank transfers

The rule behind this section: *a bank transfer is a promise, not a payment.*

| ID | Requirement | Enforced by |
| --- | --- | --- |
| FR-D15 | Choosing "bank transfer" in the app posts **no payment** and confirms **no booking**. It returns `202`. | `bookingsConfirm` |
| FR-D16 | The slot stays held for `transfer_hold_minutes` (default 120) instead of `hold_minutes` — a banking app takes longer than a card reader. | `center_settings` |
| FR-D17 | Outstanding transfers appear as a desk queue, oldest first, with the member's phone. | `paymentsPending` |
| FR-D18 | Only a receptionist or manager can mark a transfer as received. A member cannot reconcile their own. | `requireRole` → **403** |
| FR-D19 | Reconciling a transfer produces exactly the same payment, invoice and member notification as any other method. | `settleHeldBooking` |
| FR-D20 | A transfer whose hold has expired cannot be reconciled — the court may already have been sold. | **HOLD_EXPIRED** |
| FR-D21 | Reception can reject a transfer that never arrived; the slot returns to sale and the member is told. | `transfer-reject` |

### 5.5 Refunds

| ID | Requirement | Enforced by |
| --- | --- | --- |
| FR-D22 | A refund above `refund_manager_vnd` (default 1,000,000đ) needs a manager's sign-off and waits in a queue. | `refund_pending` |
| FR-D23 | **The same payment cannot be refunded twice.** The guard reads the whole ledger for the booking, not one row. | `paymentsRefund` → **422** |
| FR-D24 | A manager can approve or reject a pending refund; both are audited. | `approve-refund`, `reject-refund` |

### 5.6 Customer care, desk side

| ID | Requirement | Enforced by |
| --- | --- | --- |
| FR-D25 | Open requests from members appear on the desk home. | `GET /v1/tickets` |
| FR-D26 | **The desk can reply in writing. Replying closes the request and notifies the member.** | `POST /v1/tickets/:id/reply` |
| FR-D27 | A request can still be closed without a reply (duplicate, or handled in person). | `POST /v1/tickets/:id/close` |
| FR-D28 | Replies are attributed to the member of staff who wrote them. | `tickets.replied_by` |

---

## 6. Functional requirements — Coach and Manager

### 6.1 Coach

| ID | Requirement | Enforced by |
| --- | --- | --- |
| FR-K01 | A coach sees their own schedule (including specific dates and times) and nobody else's. | `GET /v1/coach/schedule` |
| FR-K02 | A coach marks attendance for a session they teach. | `POST /v1/sessions/:id/attendance` |
| FR-K03 | Attendance for a finished session locks and cannot be rewritten. | **BR-27** |
| FR-K04 | A coach can only be assigned to a class in a sport they teach. | **BR-23** |
| FR-K05 | A coach cannot be scheduled into two places at once. | `coach_occupancies` overlap trigger |
| FR-K06 | A coach can evaluate student progress daily and conduct assessment tests. | `POST /v1/sessions/:id/evaluations` |
| FR-K07 | A coach can upload and share teaching materials with the class. | `POST /v1/classes/:id/materials` |
| FR-K08 | A coach can view student profiles, contact them, or leave recommendations/advice. | `POST /v1/members/:id/advice` |

### 6.2 Manager

| ID | Requirement | Enforced by |
| --- | --- | --- |
| FR-G01 | A manager creates and edits membership plans and can withdraw one from sale. | `POST/PATCH /v1/plans` |
| FR-G02 | A manager sets price rules per sport, court class, day type and hour band. | `PUT /v1/price-rules` |
| FR-G03 | A manager edits centre settings: opening hours, slot and hold length, cancellation windows, debt and refund limits, VAT and rounding. | `PATCH /v1/settings` |
| FR-G04 | A manager changes a court's status — ready, maintenance, closed. A court out of service cannot be booked. | `PATCH /v1/courts/:id` |
| FR-G05 | A manager reads revenue for any period, broken down, **with the change against the preceding period of equal length shown in green when it is good news and red when it is not.** | `GET /v1/reports/revenue` |
| FR-G06 | The direction of a change is not assumed to be good: revenue up is green, refunds up is red. | `delta(cur, prev, upIsGood)` |
| FR-G07 | A manager reads court occupancy for a period. | `GET /v1/reports/occupancy` |
| FR-G08 | A manager reads the audit log. | `GET /v1/audit` |
| FR-G09 | A manager creates classes, assigns coaches and publishes timetables. | `POST /v1/classes`, `:id/publish` |
| FR-G10 | A manager toggles feature flags (F4, F5, F6, SMS) without a deploy. | `PATCH /v1/flags` |
| FR-G11 | A manager creates and assigns non-member roles (Manager, Coach, Receptionist) to accounts. | `POST /v1/admin/roles` |
| FR-G12 | Non-member roles (Coach, Receptionist, Manager) can still purchase membership plans or book courts as a member. | `checkRoleHierarchy` |

---

## 7. Non-functional requirements

### 7.1 Correctness of the schedule

**NFR-01.** It must be impossible for two bookings to own the same court-time,
under any concurrency. This is enforced in the database, not in the handler —
two requests arriving in the same millisecond on different instances must still
produce one winner and one `409`. Both booking paths take a row lock on the
court before attaching an occupancy, so they serialise; a trigger then rejects
any overlap. See SDD §4.2 for why this is a trigger rather than an `EXCLUDE`
constraint, and where the guarantee is weaker.

**NFR-02.** The same requirement holds for coaches: no coach may be scheduled
into two overlapping sessions.

**NFR-03.** Money and schedule must never disagree. A confirmed booking always
has its payment and its invoice; a payment for a booking always has a confirmed
booking. Both are written inside one transaction (SDD §4.1).

### 7.2 Performance

**NFR-04.** `GET /v1/me` is on the critical path of every sign-in and is
composed of seven independent reads; they are issued concurrently, so the
request costs one round trip rather than seven.

**NFR-05.** Read-only endpoints do not open a transaction. A `BEGIN/COMMIT`
around a pure `SELECT` costs two extra round trips to a remote database and
buys nothing.

**NFR-06.** The desk home asks for a badge count (`?brief=1`), which runs one
aggregate query — not the three joined queries the full queue screen needs.

**NFR-07.** The background job loop must not poll expensively. Jobs are
scheduled by due time; a pass with nothing to do costs approximately nothing.

### 7.3 Resilience

**NFR-08.** Any request that takes money or changes a schedule accepts an
`Idempotency-Key` and returns the original result on replay. A retried tap must
not charge twice.

**NFR-09.** With no `DATABASE_URL`, the application runs against an embedded
PGLite database and migrates and seeds itself, so a fresh clone works offline
with no setup.

**NFR-10.** Losing the assistant's upstream model degrades the assistant to
rule-based answers. It does not degrade anything else.

### 7.4 Usability

**NFR-11.** Every screen works at 375 px. The member app is a PWA and is
installable.

**NFR-12.** A refusal tells the member what to do instead. Error text is a
sentence, not a code — the code travels alongside it for support.

**NFR-13.** Type is set in three faces with one job each: Be Vietnam Pro for
running text (which must render Vietnamese diacritics correctly), Newsreader
for headings, Anton for figures. Currency is never uppercased — `1,500,000đ`,
never `1,500,000Đ`.

**NFR-14.** Motion is decorative and never load-bearing. Nothing is only
discoverable by animating.

### 7.5 Auditability

**NFR-15.** Every state change a member cannot make themselves — refunds,
transfer reconciliation, shift closes, settings edits, ticket replies — writes
an audit row naming the actor, the action, the entity and the time.

**NFR-16.** Document codes (member, payment, invoice) are allocated from a
counter table and are gapless per kind.

### 7.6 Security and privacy

**NFR-17.** Passwords are stored as salted hashes. No plaintext password is
written anywhere, including logs.

**NFR-18.** A session token is stored as a SHA-256 hash; the raw token exists
only on the client.

**NFR-19.** Authorisation is checked server-side on every request. Hiding a
button is not a control.

**NFR-20.** A member can read only their own bookings, receipts, tickets and
profile. Cross-member reads are `403`, not filtered-empty.

**NFR-21.** Health notes and guardian details are personal data, visible to the
member and to staff who need them, and are never sent to the assistant's
upstream model.

**NFR-22.** The demo password must not be printed on the sign-in page of a
deployment. `VITE_DEMO_LOGINS=off` removes the one-tap demo entirely.

---

## 8. Business rules catalog

Business rules define the constraints, calculations, and operational invariants governing the Arena3 system. Rules are returned to the client in standard error responses as `{ code: "BR_VIOLATION", br: "BR-nn", message: "..." }`, allowing any business refusal to be traced directly to the authoritative rule.

Rules are classified as either:
- **Hard (cứng)**: System-level invariants enforced unconditionally across database triggers, constraints, or cryptographic handlers.
- **Configurable (cấu hình được)**: Centre parameters adjustable by a Manager via centre settings or pricing administration without requiring code changes or system redeployment.

### 8.1 Master Business Rules Index

| Code | Title | Domain | Type | Primary Enforcement |
| --- | --- | --- | --- | --- |
| **BR-01** | Unique Account per Phone Number | Identity | Hard | DB Unique Constraint on `users.phone` |
| **BR-02** | Password Complexity & Storage | Identity | Hard | Password validation & Argon2id/bcrypt hashing |
| **BR-03** | Single Facility Multi-Sport Operation | System | Hard | DB Check constraint `center_settings.id = 1` |
| **BR-04** | Account Lockout on Failed Logins | Security | Configurable | Auth rate limiter & lockout window (5 fails / 15m) |
| **BR-05** | Single Primary Role Assignment | Access | Hard | `users.role` enum constraint |
| **BR-06** | Last Active Manager Protection | Governance | Hard | Server validation guard on user deactivation/role update |
| **BR-07** | Minor Guardianship Requirement | Identity | Configurable | Guardian validation for age < `minor_age` (default 16) |
| **BR-08** | Explicit Terms & PII Consent | Compliance | Hard | Registration requirement (`pii_consent = true`) |
| **BR-09** | Forced Initial Password Reset for Staff | Security | Hard | Auth session gate requiring password change on first login |
| **BR-10** | Active Plan Renewal Continuity | Subscription | Hard | `new_end_date = old_end_date + duration` |
| **BR-11** | Expired Plan Renewal Date Reset | Subscription | Hard | `new_end_date = today + duration` (gap excluded) |
| **BR-12** | Active Subscription Required | Subscription | Hard | Service guard checking status in (`active`) |
| **BR-13** | Subscription Expiry Reminders | Notification | Configurable | Background job alert milestones (T-7, T-3, T-0 days) |
| **BR-14** | Membership Freeze Eligibility | Subscription | Hard | Only active subscriptions can be frozen |
| **BR-15** | Annual Membership Freeze Allowance | Subscription | Configurable | Cap of `freeze_max_days_year` (default 30 days/year) |
| **BR-16** | Subscription Sport Scope Restriction | Subscription | Hard | Plan sport matching (Single-Sport vs All-Access) |
| **BR-17** | Court Rental Quota Consumption | Quota | Configurable | 1 slot = 1 hour deduction; expires with subscription |
| **BR-18** | Class Session Quota Consumption | Quota | Hard | 1 class session = 1 credit deduction; blocked at 0 |
| **BR-19** | Prohibition of Concurrent Active Plans | Subscription | Hard | Maximum 1 active subscription per user per sport scope |
| **BR-19A** | Subscription Benefit Validity Window | Subscription | Hard | Benefits active strictly when `start_on ≤ today ≤ end_on` |
| **BR-20** | Class Cancellation Window | Classes | Configurable | Cancellation allowed ≥ `cancel_class_hours` (default 4h) |
| **BR-21** | Schedule Clash Prevention | Schedule | Hard | Court & Coach overlap prevention via DB locks & triggers |
| **BR-22** | Class Capacity Enforcement | Classes | Configurable | Class enrolment cap (Badminton: 8-16, Basketball/Volleyball: 10-18) |
| **BR-23** | Coach Sport Qualification | Classes | Hard | Coach must be certified for the class sport |
| **BR-24** | Personal Class Conflict & Duplicate Enrolment | Classes | Hard | Member cannot enrol twice or in conflicting session times |
| **BR-25** | Waitlist FIFO & Offer Expiration | Classes | Configurable | FIFO waitlist; offer expires after `waitlist_offer_hours` (default 2h) |
| **BR-26** | Centre-Initiated Class Cancellation Credit | Classes | Hard | Session refund credit granted; immediate student alert |
| **BR-27** | Qualified Coach Substitution | Classes | Hard | Substitute coach must share sport qualification; timetable sync |
| **BR-28** | Session Rescheduling Notice | Classes | Configurable | Advance notice ≥ 12 hours with clash validation (BR-21) |
| **BR-29** | Lifetime Free Trial Class Policy | Classes | Configurable | At most 1 trial class per sport per phone; non-competitive classes only |
| **BR-30** | Court Rental Slot Duration | Court | Configurable | Fixed 60-minute slots starting on the hour (06:00–21:00) |
| **BR-31** | Soft Hold Expiration Window | Court | Configurable | Unpaid slot hold releases after `hold_minutes` (default 5m) |
| **BR-32** | Booking Horizon & Daily Limit | Court | Configurable | Max `book_ahead_days` (7 days) & `max_slots_per_day` (2 slots) |
| **BR-33** | Court Cancellation & No-Show Policy | Court | Configurable | 100% refund if cancelled ≥ `cancel_court_hours` (2h); no-show at +10m |
| **BR-34** | Member Discount on Court Rentals | Pricing | Configurable | Discount percentage applies from active plan |
| **BR-34A** | Discount Percentage Bounds | Pricing | Hard | `court_discount_pct` must be integer in `[0, 100]` |
| **BR-34B** | Explicit Price Rule Required | Pricing | Hard | No matching price rule ⇒ refuse quotation; no default prices |
| **BR-35** | Operating Hours & Court Ready Status | Court | Configurable | Slots only within 06:00–22:00; court status must be `ready` |
| **BR-36** | Maintenance & Event Occupancy | Court | Hard | Maintenance blocks occupy court slots like confirmed bookings |
| **BR-37** | Convertible Court Mutual Exclusion | Court | Hard | Basketball ↔ Volleyball conversion blocks overlapping counterpart slots |
| **BR-38** | Overtime Grace & Equipment Stock | Operations | Configurable | 10m overtime grace; counter equipment verified against stock |
| **BR-39** | Single Active Hold per Member | Court | Hard | New hold attempt automatically terminates existing unpaid hold |
| **BR-39A** | Minimal Walk-In Identification | Desk | Hard | Counter walk-ins require only name + phone; no account needed |
| **BR-39B** | Court Check-In Time Window | Court | Configurable | Check-in open between −15 minutes and +10 minutes of start time |
| **BR-39C** | Personal Class vs Court Warning | Court | Hard | Warning prompt when court booking overlaps enrolled class |
| **BR-39D** | Price & Tax Snapshot at Confirmation | Pricing | Hard | Final price, discounts, and VAT snapshotted on confirmation |
| **BR-39E** | Overdue Equipment Debt Check | Operations | Hard | Unreturned equipment blocks new online court bookings |
| **BR-39F** | Discrete Single-Slot Bookings | Court | Hard | No recurring automated court bookings in v1.0 |
| **BR-39G** | Court Lighting Included in Slot Price | Pricing | Hard | Slot rate includes lighting; no supplementary lighting fee |
| **BR-39H** | Atomic Hold Replacement | Court | Hard | Validate new slot first; replace old slot in single transaction |
| **BR-40** | Immutable Financial Ledger | Finance | Hard | Invoices & payments cannot be modified/deleted; counter-entry for refunds |
| **BR-41** | Refund Authorization Threshold | Finance | Configurable | Refunds ≥ `refund_manager_vnd` (default 1,000,000 VND) require Manager |
| **BR-42** | Invoice VAT Rate Snapshot | Finance | Hard | VAT rate permanently recorded on invoice line items |
| **BR-42A** | Single Centre VAT Display Mode | Finance | Configurable | Uniform centre mode: prices include VAT (default) or exclude VAT |
| **BR-43** | Currency Rounding to 1,000 VND | Finance | Hard | Round half-up to nearest 1,000 VND (`round_vnd`) |
| **BR-43A** | Strict Financial Calculation Pipeline | Finance | Hard | Rack rate → Member discount → VAT (if excl) → Single round → Promo/Quota |
| **BR-44** | Outstanding Debt Ceiling | Credit | Configurable | Debt > `debt_limit_vnd` (default 500,000 VND) suspends new bookings |
| **BR-45** | Plan Activation Deposit | Subscription | Configurable | Payment ≥ `deposit_pct_activates` (default 50%) activates subscription |
| **BR-46** | Non-Stackable Promotional Discounts | Finance | Configurable | Promo codes do not stack with plan discount unless `stackable = true` |
| **BR-47** | 24-Hour Cooling-Off Plan Refund | Subscription | Configurable | 100% refund within 24h of purchase if zero sessions/hours/check-ins used |
| **BR-48** | Quota Excluded from Cash Revenue | Finance | Hard | Quota redemptions tracked separately and excluded from cash/bank totals |
| **BR-49** | Open Till Shift Required | Finance | Hard | Receptionist must have an open till shift to process cash/card payments |
| **BR-50** | AI Lesson Plans Remain Draft | AI | Hard | AI-generated training plans are drafts until approved by a coach |
| **BR-50A** | Silent Degradation on AI Disable | AI | Hard | When AI flags are disabled, AI UI is hidden and endpoints return 403 |
| **BR-50B** | PII Redaction in AI Queries | AI | Hard | Sensitive personal data (IDs, phone, cross-user info) stripped from prompts |
| **BR-51** | Grounded AI Assistant Responses | AI | Hard | Live data queries only; no fabricated schedules, prices, or policies |
| **BR-52** | Strict Prohibition of AI Medical Advice | AI | Hard | Refusal of injury diagnosis/treatment; directs to healthcare professionals |
| **BR-53** | Session Attendance Locking Window | Attendance | Configurable | Attendance locks 2 hours after session finish; Manager unlock required |
| **BR-54** | Gate Check-In vs Class Attendance Separation | Attendance | Hard | Entrance check-in does not count as class attendance and vice versa |
| **BR-55** | Member Health Notes Confidentiality | Privacy | Hard | Health notes restricted to assigned coaches, desk (emergencies), and Manager |
| **BR-56** | Free Training Homework & Drills | Training | Hard | Homework and exercise materials are non-commercial and quota-free |
| **BR-57** | Attendance Status Milestones | Attendance | Configurable | First 10m = `Present`; after 10m = `Late`; unexcused = `Absent` |
| **BR-58** | Consecutive Absence Alert Trigger | Attendance | Configurable | 3 consecutive unexcused absences trigger alerts to Coach and Manager |
| **BR-59** | Coach Attendance Authority Boundary | Attendance | Hard | Coaches can only mark attendance for classes they are assigned to |
| **BR-60** | Mandatory Multi-Channel Notifications | Notification | Hard | In-app notification mandatory for critical events; SMS/Email auxiliary |
| **BR-61** | Append-Only System Audit Log | Audit | Hard | Tamper-proof audit logging for sensitive actions; 12-month retention |
| **BR-62** | Independent Feature Flag Decoupling | System | Hard | Toggling F4, F5, F6, SMS does not break core booking and finance engines |
| **BR-63** | Offline Disconnected Sales Prohibition | Operations | Hard | No offline local bookings or cash collection during network downtime |
| **BR-64** | Soft Deletion & Entity Deactivation | Data | Hard | Master entities (users, plans, courts, classes) deactivated rather than erased |
| **BR-65** | Non-Retroactive Configuration Invariant | Governance | Hard | Edits to prices, rules, and settings apply exclusively to future transactions |
| **BR-66** | Prohibition of Past Slot Booking | Schedule | Hard | Slot start must be in future; walk-ins permitted only if ≥ 20m remain |
| **BR-67** | Draft Classes Hidden from Members | Classes | Hard | Unopened classes hidden from public timetable; visible only to staff |
| **BR-68** | Server-Side RBAC Enforcement | Security | Hard | All authorization checks performed server-side; UI controls are visual only |
| **BR-69** | Unique Sequential Financial Codes | Finance | Hard | Invoice and payment codes strictly gapless and monotonic per sequence |

### 8.2 Detailed Domain Breakdown & Invariants

#### 1. Identity, Access & Governance (BR-01 – BR-09, BR-68)
- **Account Uniqueness (BR-01)**: The primary identity key is a Vietnamese mobile phone number (normalized to `+84` E.164 format). Each phone number holds exactly one user profile. Member codes (`A3-YYYY-nnnn`) are allocated from an atomic sequence and permanently tied to that account.
- **Credential Storage (BR-02)**: Passwords must be at least 8 characters long and combine alphabetic and numerical characters. Hashes are salted using industry-standard hashing algorithms (Argon2id/bcrypt). Plaintext passwords are never logged or stored.
- **Single Centre (BR-03)**: The software operates for a single sports centre with one row in `center_settings` (`CHECK (id = 1)`), in timezone `Asia/Ho_Chi_Minh` (ICT), with prices in integer VND.
- **Lockout Shield (BR-04)**: Protects accounts against brute-force attacks by locking the account for 15 minutes after 5 failed password attempts in 15 minutes. Staff accounts locked by a Manager cannot self-unlock via OTP.
- **Role Isolation (BR-05, BR-68)**: A user has exactly one primary role (`member`, `receptionist`, `coach`, `manager`). Every API endpoint validates credentials and role permissions server-side on every request (`requireRole`). Non-member staff roles possess inherent rights to purchase memberships and book personal court slots under member semantics.
- **Manager Invariant (BR-06)**: The system prevents deleting, demoting, or deactivating the last active Manager to prevent administrative lockout.
- **Minor Protection & Consent (BR-07, BR-08)**: Self-registration is allowed only for individuals aged 16 and older. Minors under 16 must provide guardian full name and phone number. Registration requires explicit checkbox agreement to terms and privacy notices.
- **Staff Password Hygiene (BR-09)**: Newly created staff accounts provided with temporary credentials must change their password on first sign-in before accessing operational consoles.

#### 2. Memberships, Plans & Quota Control (BR-10 – BR-19A, BR-45, BR-47)
- **Plan Lifecycles (BR-10, BR-11, BR-19A)**: Extending an active plan preserves remaining days (`new_end = old_end + duration`), whereas renewing an expired plan starts from today (`new_end = today + duration`). A plan is valid strictly within its calendar window `start_on ≤ today ≤ end_on` (ICT). Plans purchased for future dates remain `Scheduled` without premature benefit activation.
- **Sport Scope (BR-16, BR-19)**: Plans specify their covered sport (`badminton`, `basketball`, `volleyball`, or `all`). A member cannot hold two concurrent active plans covering the same sport scope.
- **Freezing Rules (BR-14, BR-15)**: Only active plans may be frozen. When frozen, benefit usage, court discounts, and class enrolments are suspended. Total freeze duration cannot exceed `freeze_max_days_year` (default 30 days) within any calendar year.
- **Quota Mechanics (BR-17, BR-18, BR-48)**: Quotas grant specific allowances (court hours or class sessions). Deductions occur upon booking confirmation or class attendance. Quota cannot be converted into cash refunds and expires with the plan.
- **Cooling-Off Refund (BR-47)**: Members may cancel a newly purchased plan within 24 hours for a full 100% refund, provided no quota, court time, or facility check-ins have occurred.

#### 3. Class Timetables, Waitlists & Coaching (BR-20 – BR-29, BR-53 – BR-59, BR-67)
- **Timetable Integrity (BR-21, BR-24)**: The database enforces strict schedule non-overlap. No court may host two sessions simultaneously. No member may enrol in overlapping classes.
- **Class Enrolment & Capacity (BR-22, BR-67)**: Only classes published in `open` status accept enrolments. Student capacity is bounded by safety limits. Draft classes are hidden from the member directory.
- **Waitlist FIFO & Offers (BR-25)**: When a class reaches capacity, new applicants join a first-come, first-served waitlist. When a vacancy arises, the leading waitlist member receives an offer reserved for `waitlist_offer_hours` (default 2h) before passing to the next candidate.
- **Cancellations & Adjustments (BR-20, BR-26, BR-28)**: Members must cancel class attendance at least 4 hours before session start to preserve session quota. Centre-initiated session cancellations credit 1 session back to session-based plan holders.
- **Coach Operations & Attendance (BR-23, BR-27, BR-53, BR-57, BR-59)**: Coaches must hold qualifications in the sport they teach. Session attendance records lock 2 hours post-session. Check-in within 10 minutes records `Present`; check-in after 10 minutes records `Late`; failure to attend records `Absent`. Three consecutive unexcused absences trigger alerts (BR-58).

#### 4. Court Hire, Scheduling & Facility Management (BR-30 – BR-39H, BR-63, BR-66)
- **Court Slot Slicing (BR-30, BR-35, BR-66)**: Court hire is sold in 60-minute blocks between 06:00 and 22:00. Booking slots in the past is rejected; walk-ins may purchase an in-progress slot only if at least 20 minutes remain.
- **Soft Holds & Atomic Replacement (BR-31, BR-39, BR-39H)**: Placing a slot on hold creates a temporary 5-minute reservation. A user may hold only one pending slot at a time. Replacing a hold validates the new slot atomically before releasing the existing hold; validation failure leaves the original hold untouched.
- **Horizon & Anti-Hoarding (BR-32)**: Members may book up to 7 days ahead and hold a maximum of 2 slots per day.
- **Cancellation & No-Show (BR-33, BR-39B)**: Full refund/quota reversal is available for cancellations at least 2 hours before start. Check-in is valid between −15 minutes and +10 minutes of start time; unverified slots are marked `NoShow` without refund.
- **Maintenance & Court Conversion (BR-36, BR-37)**: Maintenance blocks reserve occupancy to prevent bookings. Convertible court configurations (e.g. basketball to volleyball) enforce mutual exclusion over the shared physical space.
- **Counter Walk-In Workflow (BR-39A)**: Receptionists can book walk-in court time capturing only customer name and phone number, eliminating account creation barriers.

#### 5. Pricing, Financial Pipeline & Invoicing (BR-34 – BR-34B, BR-40 – BR-46, BR-49, BR-65, BR-69)
- **Pricing Invariant (BR-34B, BR-39D, BR-65)**: Every court-time must have an explicit price rule matching sport, day type, and time band; default prices are forbidden. Prices and VAT rates snapshot at confirmation; subsequent setting adjustments never apply retroactively.
- **Calculation Order & Rounding (BR-42A, BR-43, BR-43A)**:
  $$\text{Final Price} = \text{Round}_{1000}\Big(\big(\text{Rack Rate} \times (1 - \text{Discount}_{\%})\big) \times (1 + \text{VAT}_{\text{if excl}})\Big) - \text{Promo}$$
  Calculation applies a single half-up rounding to the nearest 1,000 VND.
- **Immutability & Audit (BR-40, BR-49, BR-61, BR-69)**: Financial ledger records and invoices are immutable. Till shifts require counting physical cash against system totals upon close.
- **Debt Ceiling & Manager Sign-off (BR-41, BR-44)**: Unpaid balances exceeding 500,000 VND block further bookings. Refunds of 1,000,000 VND or greater require explicit Manager approval.

#### 6. Artificial Intelligence & Operational Safety (BR-50 – BR-52, BR-50A/B, BR-62)
- **Grounded AI Answers (BR-51)**: The AI assistant answers member queries regarding schedules, prices, classes, and rules strictly via live tool calls into the database context; hallucination or guessing is blocked.
- **Strict Medical Disclaimer (BR-52)**: The AI assistant refuses diagnostic or rehabilitation advice, referring inquiries to medical specialists.
- **AI Training Plan Review (BR-50)**: AI-generated coaching drills or lesson outlines are generated as drafts and require explicit coach review and approval.
- **Safety Flags & Privacy (BR-50A, BR-50B, BR-62)**: Toggling off AI feature flags completely disables AI routes and interfaces. Member PII (national IDs, passwords, phone numbers) is stripped from AI context prompts.

---

## 9. External interfaces

### 9.1 API

A single JSON API under `/v1`. Bearer token in `authorization`. Errors are
`{ code, message, ... }` with these mappings:

| HTTP | Code | Meaning |
| --- | --- | --- |
| 401 | `UNAUTHENTICATED` | No session, or it expired. |
| 403 | `FORBIDDEN` | Wrong role, or somebody else's data. |
| 404 | `NOT_FOUND` | No such thing. |
| 409 | `CONFLICT_SLOT` | Somebody else got that court-time first. |
| 409 | `HOLD_EXPIRED` | The clock ran out. |
| 409 | `CONFLICT_STATE` | Right thing, wrong state. |
| 422 | `BR_VIOLATION` | A named business rule refused it. Carries `br`. |
| 422 | `VALIDATION` | The request was malformed. |
| 429 | `RATE_LIMITED` | Too fast. |

### 9.2 Gemini

The assistant calls Google Gemini with a system prompt and a context block
assembled from the centre's own settings, plans, classes and coaches. No
personal data of any member is included. Absence of a key, a network failure,
or a refusal all fall back to rule-based answers.

### 9.3 Storage

PostgreSQL 16 (Neon in production) or embedded PGLite in development. Schema
changes are forward-only numbered migrations in `migrations/`, applied in one
transaction and recorded in `_migrations`.

---

## 10. Acceptance

The system is accepted when `scripts/arena3-api-check.mjs` passes against a
running instance. That harness is the executable form of this document: it
drives real HTTP against a real database and asserts the requirements that are
cheap to get wrong — notably that a transfer does not confirm a booking
(FR-D15), that a member cannot reconcile their own (FR-D18), that reconciling
produces a receipt (FR-D19), and that the same payment cannot be refunded twice
(FR-D23).

```bash
npm run check:api
```

Unit-level rules are covered by `src/lib/arena3/arena3.test.ts` via `npm test`.
