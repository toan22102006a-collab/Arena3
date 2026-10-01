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

- Court availability, holds, bookings, check-in and cancellation.
- Classes: timetable generation, enrolment, waitlists, attendance.
- Memberships: plans, orders, activation, freezing, quota consumption.
- The front desk: till shifts, payments, refunds, receipts, walk-ins, equipment.
- Management: pricing, opening rules, revenue and occupancy reporting, audit.
- Customer care: a member can ask the desk something and read the answer.
- An in-app assistant that answers from the centre's own data.

### 1.3 Out of scope

Deliberately, and recorded so nobody plans around them:

- **Multi-site.** One centre per deployment. `center_settings` is a single row
  with a `CHECK (id = 1)`.
- **Real payment processing.** No card acquirer, no bank API, no payment
  gateway. `method` on a payment records how money was taken at the counter;
  a bank transfer is reconciled by a human reading a statement (§5.4).
- **Outbound SMS/email.** The `outbox` table and its dispatcher exist and are
  exercised; the SMS transport is a logging stub. In-app notification is the
  channel that actually reaches members today.
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
| **Manager** | Runs the centre. Everything a receptionist can do, plus pricing, plans, settings, reports, and refund sign-off. | `/manager/*`, `/desk/*` |
| **Guest / walk-in** | Not signed in, or has no account. Served entirely by a receptionist. | — |
| **Scheduler** | Not a person: the job loop that expires holds, marks no-shows, generates sessions and sends reminders. | — |

Roles are exclusive — a user has exactly one — and are enforced server-side on
every request (`requireRole`). The UI hides what a role cannot do; that is a
convenience, not the control.

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

> **Known deviation.** The registration OTP is displayed on screen rather than
> sent, because there is no SMS transport (§1.3). This is acceptable for a
> demonstration deployment and is *not* acceptable for one holding real
> customer accounts. It is the single most important thing to replace before
> the system handles real members.

### 4.2 Booking a court

| ID | Requirement | Enforced by |
| --- | --- | --- |
| FR-B01 | A member sees live availability per court and day, including which slots are held by others. | `GET /v1/occupancy` |
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

### 4.3 Classes

| ID | Requirement | Enforced by |
| --- | --- | --- |
| FR-C01 | A member sees the published timetable with remaining places. | `GET /v1/classes` |
| FR-C02 | Enrolling requires an active plan covering that sport. | **BR-12** |
| FR-C03 | A plan with a session quota must have sessions left. | **BR-18** |
| FR-C04 | A member cannot enrol in a class that clashes with one they are already in. | **BR-24** |
| FR-C05 | A member cannot enrol twice in the same class. | **BR-24** |
| FR-C06 | A class that is not `open` cannot be enrolled in. | **BR-67** |
| FR-C07 | When a class is full, enrolling joins a first-come waitlist with a visible position. | `enrollment_waitlist` |
| FR-C08 | When a place frees, the first person on the waitlist is offered it. The offer stands for `waitlist_offer_hours` (default 2), then passes to the next person. | `waitlistExpire` job |
| FR-C09 | An expired offer cannot be accepted. | **BR-25** |
| FR-C10 | A class that filled between the offer and the acceptance refuses the acceptance rather than overfilling. | **BR-22** |
| FR-C11 | A member may leave a class up to `cancel_class_hours` (default 4) before the next session. | **BR-20** |

### 4.4 Membership

| ID | Requirement | Enforced by |
| --- | --- | --- |
| FR-P01 | A member sees the plans currently on sale, with what each includes. | `GET /v1/plans` |
| FR-P02 | Ordering a plan creates a `pending` subscription. It is not active until paid for. | `POST /v1/subscriptions` |
| FR-P03 | A plan withdrawn from sale cannot be ordered by a member. | **BR-65** |
| FR-P04 | A member with a frozen plan cannot buy another until they unfreeze it. | **BR-14** |
| FR-P05 | Plan orders are rate limited: 3 per minute and 10 per hour per member. | `RULES.planRequest*` |
| FR-P06 | A subscription activates when enough has been paid — in full, or `deposit_pct_activates` if the centre allows deposits. | `activateSubscription` |
| FR-P07 | A member may freeze an active plan, up to `freeze_max_days_year` days a year. | **BR-14** |

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
| FR-D06 | A receptionist can create a member at the counter and sell them a plan in one flow. | `POST /v1/members` |
| FR-D07 | A receptionist can sell a court to a walk-in with no account, taking name and phone only. | `POST /v1/walk-in` |
| FR-D08 | A walk-in may be sold into a slot already under way, provided at least 20 minutes remain. | **BR-66** |
| FR-D09 | A receptionist can lend and take back equipment, and stock is enforced. | **BR-38** |

### 5.3 Taking money

| ID | Requirement | Enforced by |
| --- | --- | --- |
| FR-D10 | A payment records method, amount, VAT rate, what it was for, who took it and which shift. | `payments` |
| FR-D11 | Every payment issues an invoice. | `paymentsCreate` |
| FR-D12 | A repeated payment request with the same idempotency key returns the original payment instead of taking the money twice. | `withIdempotency` |
| FR-D13 | **Reception can see every payment taken in the last 7/14/30 days, by any method, with its receipt — filterable by method.** | `GET /v1/payments/pending` |

### 5.4 Bank transfers

The rule behind this section: *a bank transfer is a promise, not a payment.*

| ID | Requirement | Enforced by |
| --- | --- | --- |
| FR-D14 | Choosing "bank transfer" in the app posts **no payment** and confirms **no booking**. It returns `202`. | `bookingsConfirm` |
| FR-D15 | The slot stays held for `transfer_hold_minutes` (default 120) instead of `hold_minutes` — a banking app takes longer than a card reader. | `center_settings` |
| FR-D16 | Outstanding transfers appear as a desk queue, oldest first, with the member's phone. | `paymentsPending` |
| FR-D17 | Only a receptionist or manager can mark a transfer as received. A member cannot reconcile their own. | `requireRole` → **403** |
| FR-D18 | Reconciling a transfer produces exactly the same payment, invoice and member notification as any other method. | `settleHeldBooking` |
| FR-D19 | A transfer whose hold has expired cannot be reconciled — the court may already have been sold. | **HOLD_EXPIRED** |
| FR-D20 | Reception can reject a transfer that never arrived; the slot returns to sale and the member is told. | `transfer-reject` |

### 5.5 Refunds

| ID | Requirement | Enforced by |
| --- | --- | --- |
| FR-D21 | A refund above `refund_manager_vnd` (default 1,000,000đ) needs a manager's sign-off and waits in a queue. | `refund_pending` |
| FR-D22 | **The same payment cannot be refunded twice.** The guard reads the whole ledger for the booking, not one row. | `paymentsRefund` → **422** |
| FR-D23 | A manager can approve or reject a pending refund; both are audited. | `approve-refund`, `reject-refund` |

### 5.6 Customer care, desk side

| ID | Requirement | Enforced by |
| --- | --- | --- |
| FR-D24 | Open requests from members appear on the desk home. | `GET /v1/tickets` |
| FR-D25 | **The desk can reply in writing. Replying closes the request and notifies the member.** | `POST /v1/tickets/:id/reply` |
| FR-D26 | A request can still be closed without a reply (duplicate, or handled in person). | `POST /v1/tickets/:id/close` |
| FR-D27 | Replies are attributed to the member of staff who wrote them. | `tickets.replied_by` |

---

## 6. Functional requirements — Coach and Manager

### 6.1 Coach

| ID | Requirement | Enforced by |
| --- | --- | --- |
| FR-K01 | A coach sees their own schedule and nobody else's. | `GET /v1/coach/schedule` |
| FR-K02 | A coach marks attendance for a session they teach. | `POST /v1/sessions/:id/attendance` |
| FR-K03 | Attendance for a finished session locks and cannot be rewritten. | **BR-27** |
| FR-K04 | A coach can only be assigned to a class in a sport they teach. | **BR-23** |
| FR-K05 | A coach cannot be scheduled into two places at once. | `coach_occupancies` overlap trigger |

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

## 8. Business rules index

Rules are returned in the error body as `{ code: "BR_VIOLATION", br: "BR-nn",
message }`, so any refusal in the UI can be traced to the line that made it.

| Code | Rule |
| --- | --- |
| BR-01 | One account per phone number / email. |
| BR-02 | Password ≥ 8 characters, letters and digits. |
| BR-07 | A minor needs guardian details. |
| BR-08 | Terms and privacy notice must be accepted. |
| BR-12 | Class enrolment needs an active plan covering that sport. |
| BR-14 | Freeze rules: only an active plan; not while frozen. |
| BR-15 | Freeze allowance per year. |
| BR-17 | Quota payment needs court hours left. |
| BR-18 | Session quota must not be exhausted. |
| BR-20 | Class cancellation window. |
| BR-22 | Cannot overfill a class. |
| BR-23 | Coach must teach that sport. |
| BR-24 | No clashing or duplicate enrolment. |
| BR-25 | A waitlist offer expires. |
| BR-27 | Attendance locks when a session is done. |
| BR-32 | Booking horizon and daily slot cap. |
| BR-35 | Opening hours; court must be ready. |
| BR-38 | Equipment stock. |
| BR-39 | Occupancy integrity. |
| BR-44 | Debt limit blocks new bookings. |
| BR-49 | An open till shift is required to take money. |
| BR-65 | A withdrawn plan cannot be ordered. |
| BR-66 | No booking in the past; walk-in needs 20 minutes left. |
| BR-67 | A class must be open to enrol. |

The table above is as-built: every code in it is emitted by a line of running
code. Rules added in A3-SRS-001 v1.3.2 and v1.4 (with A3-SDD-001 v0.4) are
listed separately, because the running code does not emit them yet or only
covers part of them:

| Code | Rule | Status |
| --- | --- | --- |
| BR-19A | A plan grants benefits only while `start_on ≤ today ≤ end_on`. | Implemented — `memberDiscount` checks `start_on` and `end_on` |
| BR-34A | Plan discount percentages are integers in `[0, 100]`. | Enforced by the `court_discount_pct` CHECK on plans; the API does not emit `BR-34A` |
| BR-34B | No matching price rule ⇒ refuse to quote; never invent a default price. | Implemented — `lookupPrice` throws `BR-34B` when no rule matches or the matched price is outside `(0, 5,000,000]đ`; the same bound is enforced by `priceRulesPut` and a DB `CHECK` on `price_rules` |
| BR-39H | Replacing a hold validates the new hold first; any failure keeps the old hold. | Implemented — `bookingsHold` runs every check before `booking_replace_hold` in one transaction |
| BR-42A | One VAT display mode: prices include VAT (default) or exclude it. | Default mode only — no `prices_include_vat` setting yet |
| BR-43A | Order of money operations; round once, half up, after the discount (and VAT when prices exclude it). | Matches current behaviour in the default VAT mode |

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
(FR-D14), that a member cannot reconcile their own (FR-D17), that reconciling
produces a receipt (FR-D18), and that the same payment cannot be refunded twice
(FR-D22).

```bash
npm run check:api
```

Unit-level rules are covered by `src/lib/arena3/arena3.test.ts` via `npm test`.
