import { getSql } from "@/lib/db";
import { ApiError, err, handleError, json } from "./errors";
import { withIdempotency } from "./helpers";
import { startJobLoop } from "./jobs";
import { authFromRequest, optionalAuth, requireRole, staffRoles, type PublicUser } from "./session";
import { withTx } from "./tx";
import * as authH from "./handlers/auth";
import * as memberH from "./handlers/members";
import * as planH from "./handlers/plans";
import * as bookH from "./handlers/bookings";
import * as classH from "./handlers/classes";
import * as deskH from "./handlers/desk";
import * as reportH from "./handlers/reports";
import * as onlineH from "./handlers/online";
import * as opsH from "./handlers/ops";
import * as staffH from "./handlers/staff";
import * as trainH from "./handlers/training";
import * as checkinH from "./handlers/checkin";
import * as promoH from "./handlers/promos";
import * as attH from "./handlers/attendance";

type Result = { status: number; body: unknown };

function pathOf(request: Request): { method: string; parts: string[]; url: URL } {
  const url = new URL(request.url);
  const raw = url.pathname.replace(/^\/v1\/?/, "").replace(/\/+$/, "");
  const parts = raw ? raw.split("/") : [];
  return { method: request.method.toUpperCase(), parts, url };
}

async function dispatch(request: Request): Promise<Response | Result> {
  startJobLoop();
  const { method, parts } = pathOf(request);
  const p0 = parts[0] ?? "";
  const p1 = parts[1] ?? "";
  const p2 = parts[2] ?? "";

  const idem = (userId: string | null, fn: () => Promise<Result>) =>
    withTx(async (sql) => {
      const r = await withIdempotency(sql, request, userId, true, fn);
      return r;
    });

  // Public auth
  if (method === "POST" && p0 === "auth" && p1 === "register") {
    return withTx((sql) => authH.register(sql, request));
  }
  if (method === "POST" && p0 === "auth" && p1 === "otp" && p2 === "verify") {
    return withTx((sql) => authH.verifyOtp(sql, request));
  }
  if (method === "POST" && p0 === "auth" && p1 === "login") {
    return withTx((sql) => authH.login(sql, request));
  }
  /*
   * payOS calling to say a link was paid.
   *
   * Public because payOS carries no session, and deliberately NOT wrapped in
   * `idem()`: that helper requires an `Idempotency-Key` header and throws
   * without one, which payOS has no way to send. Replay safety comes from the
   * unique index on `(provider, provider_txn_id)` and from the payment's own
   * status, not from a header.
   */
  // The order-sequence high-water mark, readable without a session: whoever is
  // migrating the database needs it precisely when nobody can sign in yet.
  if (method === "GET" && p0 === "payments" && p1 === "online" && p2 === "sequence") {
    return withTx((sql) => onlineH.onlineSequence(sql));
  }
  if (method === "POST" && p0 === "payments" && p1 === "online" && p2 === "webhook") {
    return withTx((sql) => onlineH.payosWebhook(sql, request));
  }
  if (method === "POST" && p0 === "auth" && p1 === "password" && p2 === "forgot") {
    return withTx((sql) => authH.forgot(sql, request));
  }

  if (method === "GET" && p0 === "plans" && !p1) {
    const sql = await getSql();
    const user = await optionalAuth(sql, request);
    return planH.plansList(sql, user);
  }
  if (method === "GET" && p0 === "courts" && !p1) {
    const sql = await getSql();
    return bookH.courtsList(sql);
  }
  if (method === "GET" && p0 === "classes" && !p1) {
    const sql = await getSql();
    const user = await optionalAuth(sql, request);
    return classH.classesList(sql, request, user);
  }
  if (method === "GET" && p0 === "price-rules" && !p1) {
    const sql = await getSql();
    return deskH.priceRulesGet(sql);
  }

  // Authenticated
  const authed = async (fn: (sql: Awaited<ReturnType<typeof getSql>>, user: PublicUser) => Promise<Result | Response>) => {
    return withTx(async (sql) => {
      const user = await authFromRequest(sql, request);
      return fn(sql, user);
    });
  };

  // Same authentication, no transaction. Every handler reached through this is
  // a pure `select` — verified one by one — so a BEGIN/COMMIT buys nothing and
  // costs real time: it takes a connection out of the pool and spends two extra
  // round trips on it. That is cheap when the app and the database share a
  // region and brutal when they don't — against a database a continent away it
  // was half a second per read.
  const authedRead = async (fn: (sql: Awaited<ReturnType<typeof getSql>>, user: PublicUser) => Promise<Result | Response>) => {
    const sql = await getSql();
    const user = await authFromRequest(sql, request);
    return fn(sql, user);
  };

  if (method === "POST" && p0 === "auth" && p1 === "logout") {
    return authed((sql, user) => authH.logout(sql, request, user));
  }
  if (method === "GET" && p0 === "me" && !p1) {
    return authedRead((sql, user) => authH.meGet(sql, user));
  }
  if (method === "GET" && p0 === "me" && p1 === "bookings" && !p2) {
    return authedRead((sql, user) => bookH.meBookings(sql, user));
  }
  if (method === "GET" && p0 === "me" && p1 === "attendance" && !p2) {
    return authedRead((sql, user) => opsH.meAttendance(sql, user));
  }
  if (method === "PATCH" && p0 === "me" && !p1) {
    return authed((sql, user) => authH.mePatch(sql, request, user));
  }
  if (method === "GET" && p0 === "me" && p1 === "notifications" && !p2) {
    return authedRead((sql, user) => authH.meNotifications(sql, user));
  }
  if (method === "POST" && p0 === "me" && p1 === "notifications" && p2 === "read") {
    return authed((sql, user) => authH.meNotificationsRead(sql, request, user));
  }
  if (method === "POST" && p0 === "me" && p1 === "password") {
    return authed((sql, user) => authH.mePassword(sql, request, user));
  }
  if (method === "GET" && p0 === "occupancy" && p1 === "detail") {
    return authedRead((sql, user) => bookH.occupancyDetail(sql, request, user));
  }
  if (method === "GET" && p0 === "availability" && !p1) {
    return authedRead((sql) => bookH.availabilityGet(sql, request));
  }
  if (method === "GET" && p0 === "occupancy" && !p1) {
    return authedRead((sql) => bookH.occupancyGet(sql, request));
  }
  if (method === "PATCH" && p0 === "courts" && p1 && !p2) {
    return authed((sql, user) => bookH.courtsPatch(sql, p1, request, user));
  }

  // Staff accounts — the manager is the only one who issues them (R-01…R-03).
  if (method === "GET" && p0 === "staff" && !p1) {
    return authedRead((sql, user) => staffH.staffList(sql, request, user));
  }
  if (method === "POST" && p0 === "staff" && !p1) {
    return authed((sql, user) => staffH.staffCreate(sql, request, user));
  }
  if (method === "PATCH" && p0 === "staff" && p1 && !p2) {
    return authed((sql, user) => staffH.staffPatch(sql, p1, request, user));
  }
  if (method === "POST" && p0 === "staff" && p1 && p2 === "reset-password") {
    return authed((sql, user) => staffH.staffResetPassword(sql, p1, user));
  }
  if (method === "POST" && p0 === "staff" && p1 && p2 === "revoke-sessions") {
    return authed((sql, user) => staffH.staffRevokeSessions(sql, p1, user));
  }

  if (method === "GET" && p0 === "directory" && p1 === "members") {
    return authedRead((sql, user) => memberH.membersDirectory(sql, request, user));
  }
  if (method === "GET" && p0 === "members" && !p1) {
    return authedRead((sql, user) => memberH.membersSearch(sql, request, user));
  }
  if (method === "POST" && p0 === "members" && !p1) {
    return authed((sql, user) => memberH.membersCreate(sql, request, user));
  }
  if (method === "GET" && p0 === "members" && p1 && !p2) {
    return authedRead((sql, user) => memberH.memberGet(sql, p1, user));
  }
  if (method === "POST" && p0 === "members" && p1 && p2 === "reset-password") {
    return authed((sql, user) => memberH.memberResetPassword(sql, p1, user));
  }
  if (method === "PATCH" && p0 === "members" && p1 && !p2) {
    return authed((sql, user) => memberH.membersUpdate(sql, p1, request, user));
  }

  if (method === "POST" && p0 === "plans" && !p1) {
    return authed((sql, user) => planH.plansCreate(sql, request, user));
  }
  if (method === "GET" && p0 === "plans" && p1 && !p2) {
    return authedRead((sql, user) => planH.plansGet(sql, p1, user));
  }
  if (method === "PATCH" && p0 === "plans" && p1 && !p2) {
    return authed((sql, user) => planH.plansPatch(sql, p1, request, user));
  }
  if (method === "POST" && p0 === "subscriptions" && !p1) {
    return authed((sql, user) => planH.subscriptionsCreate(sql, request, user));
  }

  if (method === "POST" && p0 === "bookings" && !p1) {
    return authed((sql, user) =>
      withIdempotency(sql, request, user.id, true, () => bookH.bookingsHold(sql, request, user)),
    );
  }
  if (method === "POST" && p0 === "bookings" && p1 && p2 === "confirm") {
    return authed((sql, user) =>
      withIdempotency(sql, request, user.id, true, () => bookH.bookingsConfirm(sql, p1, request, user)),
    );
  }
  if (method === "POST" && p0 === "bookings" && p1 && p2 === "transfer-confirm") {
    return authed((sql, user) => bookH.bookingsTransferConfirm(sql, p1, user));
  }
  if (method === "POST" && p0 === "bookings" && p1 && p2 === "transfer-reject") {
    return authed((sql, user) => bookH.bookingsTransferReject(sql, p1, request, user));
  }
  if (method === "POST" && p0 === "bookings" && p1 && p2 === "cancel") {
    return authed((sql, user) => bookH.bookingsCancel(sql, p1, user));
  }
  if (method === "POST" && p0 === "bookings" && p1 && p2 === "reschedule") {
    return authed((sql, user) => bookH.bookingsReschedule(sql, p1, request, user));
  }
  if (method === "POST" && p0 === "bookings" && p1 && p2 === "check-in") {
    return authed((sql, user) => bookH.bookingsCheckIn(sql, p1, user));
  }
  if (method === "GET" && p0 === "bookings" && p1 && !p2) {
    return authedRead((sql, user) => bookH.bookingGet(sql, p1, user));
  }
  if (method === "POST" && p0 === "walk-in") {
    return authed((sql, user) =>
      withIdempotency(sql, request, user.id, true, () => bookH.walkIn(sql, request, user)),
    );
  }

  if (method === "POST" && p0 === "shifts" && p1 === "open") {
    return authed((sql, user) => deskH.shiftOpen(sql, user));
  }
  if (method === "GET" && p0 === "shifts" && p1 === "current") {
    return authedRead((sql, user) => deskH.shiftCurrent(sql, user));
  }
  if (method === "POST" && p0 === "shifts" && p1 && p2 === "close") {
    return authed((sql, user) => deskH.shiftClose(sql, p1, request, user));
  }

  if (method === "POST" && p0 === "classes" && !p1) {
    return authed((sql, user) => classH.classesCreate(sql, request, user));
  }
  if (method === "POST" && p0 === "classes" && p1 && p2 === "publish") {
    return authed((sql, user) => classH.classesPublish(sql, p1, user));
  }
  if (method === "POST" && p0 === "classes" && p1 && p2 === "enroll") {
    return authed((sql, user) => classH.classesEnroll(sql, p1, request, user));
  }
  if (method === "GET" && p0 === "classes" && p1 && !p2) {
    return authedRead((sql, user) => classH.classDetail(sql, p1, user));
  }
  if (method === "GET" && p0 === "classes" && p1 && p2 === "roster") {
    return authedRead((sql, user) => classH.classRoster(sql, p1, user));
  }
  if (method === "PATCH" && p0 === "classes" && p1 && !p2) {
    return authed((sql, user) => classH.classesPatch(sql, p1, request, user));
  }
  if (method === "POST" && p0 === "classes" && p1 && p2 === "coach") {
    return authed((sql, user) => classH.classesAssignCoach(sql, p1, request, user));
  }
  if (method === "POST" && p0 === "sessions" && p1 && p2 === "cancel") {
    return authed((sql, user) => classH.sessionCancel(sql, p1, request, user));
  }
  if (method === "POST" && p0 === "sessions" && p1 && p2 === "reschedule") {
    return authed((sql, user) => classH.sessionReschedule(sql, p1, request, user));
  }
  if (method === "GET" && p0 === "coach" && p1 === "schedule") {
    return authedRead((sql, user) => classH.coachSchedule(sql, user));
  }
  if (method === "DELETE" && p0 === "enrollments" && p1) {
    return authed((sql, user) => classH.enrollmentDelete(sql, p1, user));
  }

  if (method === "GET" && p0 === "payments" && p1 === "pending") {
    return authedRead((sql, user) => deskH.paymentsPending(sql, request, user));
  }
  // Raise a payOS link — the member on their phone, or reception showing the
  // QR to a customer standing at the counter.
  if (method === "POST" && p0 === "payments" && p1 === "online" && !p2) {
    return authed((sql, user) => onlineH.onlineCreate(sql, request, user));
  }
  // Ask payOS whether it has been paid. Deliberately idempotent rather than
  // idempotency-keyed: the return page, reception's screen and the job loop all
  // poll the same link, and none of them can supply a shared key.
  if (method === "POST" && p0 === "payments" && p1 === "online" && p2 && parts[3] === "verify") {
    return authed((sql, user) => onlineH.onlineVerify(sql, p2, user));
  }
  if (method === "POST" && p0 === "payments" && !p1) {
    return authed((sql, user) =>
      withIdempotency(sql, request, user.id, true, () => deskH.paymentsCreate(sql, request, user)),
    );
  }
  if (method === "POST" && p0 === "payments" && p1 && p2 === "refund") {
    return authed((sql, user) => deskH.paymentsRefund(sql, p1, request, user));
  }
  if (method === "POST" && p0 === "payments" && p1 && p2 === "approve-refund") {
    return authed((sql, user) => deskH.paymentsApproveRefund(sql, p1, request, user));
  }
  if (method === "POST" && p0 === "payments" && p1 && p2 === "reject-refund") {
    return authed((sql, user) => deskH.paymentsRejectRefund(sql, p1, request, user));
  }
  // Ordered before the `.pdf` case only for readability — the two cannot collide.
  if (method === "GET" && p0 === "invoices" && !p1) {
    return authedRead((sql, user) => deskH.invoicesMine(sql, request, user));
  }
  if (method === "GET" && p0 === "invoices" && p1?.endsWith(".pdf")) {
    const id = p1.replace(/\.pdf$/, "");
    return authedRead((sql, user) => deskH.invoicePdf(sql, id, request, user));
  }

  if (method === "GET" && p0 === "reports" && p1 === "attendance" && !p2) {
    return authedRead((sql, user) => attH.reportsAttendance(sql, request, user));
  }
  if (method === "GET" && p0 === "at-risk" && !p1) {
    return authedRead((sql, user) => attH.atRiskList(sql, user));
  }
  if (method === "POST" && p0 === "contacts" && !p1) {
    return authed((sql, user) => attH.contactCreate(sql, request, user));
  }
  if (method === "GET" && p0 === "members" && p1 && p2 === "contacts") {
    return authedRead((sql, user) => attH.contactList(sql, p1, user));
  }
  if (method === "GET" && p0 === "reports" && p1 && p2 === "export") {
    return authedRead((sql, user) => reportH.reportsExport(sql, request, user, p1));
  }
  if (method === "GET" && p0 === "reports" && p1 === "revenue") {
    return authedRead((sql, user) => {
      requireRole(user, ["manager"]);
      return deskH.reportsRevenue(sql, request, user);
    });
  }
  if (method === "GET" && p0 === "reports" && p1 === "capacity") {
    return authedRead((sql, user) => reportH.reportsCapacity(sql, request, user));
  }
  if (method === "GET" && p0 === "reports" && p1 === "members") {
    return authedRead((sql, user) => reportH.reportsMembers(sql, request, user));
  }
  if (method === "GET" && p0 === "reports" && p1 === "occupancy") {
    return authedRead((sql, user) => deskH.reportsOccupancy(sql, request, user));
  }
  if (method === "GET" && p0 === "settings" && !p1) {
    return authedRead((sql, user) => deskH.settingsGet(sql, user));
  }
  if (method === "PATCH" && p0 === "settings" && !p1) {
    return authed((sql, user) => deskH.settingsPatch(sql, request, user));
  }
  if (method === "PUT" && p0 === "price-rules") {
    return authed((sql, user) => deskH.priceRulesPut(sql, request, user));
  }
  if (method === "GET" && p0 === "audit") {
    return authedRead((sql, user) => deskH.auditList(sql, request, user));
  }

  if (method === "POST" && p0 === "subscriptions" && p1 && p2 === "freeze") {
    return authed((sql, user) => opsH.subscriptionFreeze(sql, p1, request, user));
  }
  if (method === "POST" && p0 === "subscriptions" && p1 && p2 === "unfreeze") {
    return authed((sql, user) => opsH.subscriptionUnfreeze(sql, p1, user));
  }
  if (method === "POST" && p0 === "subscriptions" && p1 && p2 === "decline") {
    return authed((sql, user) => deskH.subscriptionDecline(sql, p1, user));
  }
  if (method === "POST" && p0 === "waitlist" && p1 && p2 === "accept") {
    return authed((sql, user) => opsH.waitlistAccept(sql, p1, user));
  }
  if (method === "GET" && p0 === "equipment" && !p1) {
    return authedRead((sql) => opsH.equipmentList(sql));
  }
  if (method === "GET" && p0 === "equipment" && p1 === "loans") {
    return authedRead((sql, user) => opsH.loansOpen(sql, user));
  }
  if (method === "POST" && p0 === "equipment" && p1 === "loans" && !p2) {
    return authed((sql, user) => opsH.equipmentLoan(sql, request, user));
  }
  if (method === "POST" && p0 === "equipment" && p1 === "loans" && parts[3] === "return") {
    return authed((sql, user) => opsH.equipmentReturn(sql, p2, user));
  }
  if (method === "GET" && p0 === "sessions" && p1 && p2 === "attendance") {
    return authedRead((sql, user) => opsH.sessionAttendanceGet(sql, p1, user));
  }
  if (method === "POST" && p0 === "sessions" && p1 && p2 === "attendance") {
    return authed((sql, user) => opsH.sessionAttendancePost(sql, p1, request, user));
  }
  if (method === "GET" && p0 === "training-plans" && !p1) {
    return authedRead((sql, user) => opsH.trainingList(sql, request, user));
  }
  if (method === "POST" && p0 === "training-plans" && !p1) {
    return authed((sql, user) => trainH.trainingCreate(sql, request, user));
  }
  // Before the /:id routes, or "suggest" is read as a plan id.
  if (method === "POST" && p0 === "training-plans" && p1 === "suggest") {
    return authed((sql, user) => opsH.trainingSuggest(sql, request, user));
  }
  if (method === "GET" && p0 === "training-plans" && p1 === "templates") {
    return authedRead((sql, user) => trainH.templatesList(sql, request, user));
  }
  if (method === "POST" && p0 === "training-plans" && p1 === "from-template") {
    return authed((sql, user) => trainH.plansFromTemplate(sql, request, user));
  }
  if (method === "POST" && p0 === "training-plans" && p1 && p2 === "save-template") {
    return authed((sql, user) => trainH.templateSave(sql, p1, request, user));
  }
  if (method === "GET" && p0 === "training-plans" && p1 && p2 === "versions") {
    return authedRead((sql, user) => trainH.planVersions(sql, p1, user));
  }
  if (method === "PATCH" && p0 === "training-plans" && p1 && !p2) {
    return authed((sql, user) => trainH.trainingPatch(sql, p1, request, user));
  }
  if (method === "POST" && p0 === "classes" && p1 && p2 === "plans" && parts[3] === "duplicate-week") {
    return authed((sql, user) => trainH.plansDuplicateWeek(sql, p1, request, user));
  }
  if (method === "GET" && p0 === "sessions" && p1 && p2 === "results") {
    return authedRead((sql, user) => trainH.sessionResultsGet(sql, p1, user));
  }
  if (method === "PUT" && p0 === "sessions" && p1 && p2 === "results") {
    return authed((sql, user) => trainH.sessionResultsPut(sql, p1, request, user));
  }
  if (method === "GET" && p0 === "students" && p1 && p2 === "profile") {
    return authedRead((sql, user) => trainH.studentProfile(sql, p1, user));
  }
  if (method === "PUT" && p0 === "students" && p1 && p2 === "level") {
    return authed((sql, user) => trainH.studentLevelPut(sql, p1, request, user));
  }
  if (method === "POST" && p0 === "students" && p1 && p2 === "notes") {
    return authed((sql, user) => trainH.studentNotePost(sql, p1, request, user));
  }
  if (method === "POST" && p0 === "students" && p1 && p2 === "reviews") {
    return authed((sql, user) => trainH.studentReviewPost(sql, p1, request, user));
  }
  if (method === "GET" && p0 === "homework" && !p1) {
    return authedRead((sql, user) => trainH.homeworkList(sql, request, user));
  }
  if (method === "POST" && p0 === "homework" && !p1) {
    return authed((sql, user) => trainH.homeworkCreate(sql, request, user));
  }
  if (method === "GET" && p0 === "me" && p1 === "training" && !p2) {
    return authedRead((sql, user) => trainH.meTraining(sql, user));
  }
  if (method === "PUT" && p0 === "me" && p1 === "training-goal") {
    return authed((sql, user) => trainH.meTrainingGoal(sql, request, user));
  }
  if (method === "GET" && p0 === "me" && p1 === "homework" && !p2) {
    return authedRead((sql, user) => trainH.meHomework(sql, user));
  }
  if (method === "PUT" && p0 === "me" && p1 === "homework" && p2) {
    return authed((sql, user) => trainH.meHomeworkPut(sql, p2, request, user));
  }
  // Door check-in (SRS v1.4.1 FR-TRN-02, BR-71/72): QR scan, manual with a reason, optional self check-in.
  if (method === "POST" && p0 === "desk" && p1 === "gate-checkin") {
    return authed((sql, user) => checkinH.gateCheckin(sql, request, user));
  }
  if (method === "POST" && p0 === "desk" && p1 === "scan") {
    return authed((sql, user) => checkinH.deskScan(sql, request, user));
  }
  if (method === "GET" && p0 === "desk" && p1 === "checkin-qr") {
    return authedRead((sql, user) => checkinH.deskCheckinCode(sql, user));
  }
  if (method === "GET" && p0 === "desk" && p1 === "gate-checkins") {
    return authedRead((sql, user) => checkinH.gateCheckins(sql, user));
  }
  if (method === "GET" && p0 === "me" && p1 === "checkin-token") {
    return authedRead((sql, user) => checkinH.meCheckinToken(sql, user));
  }
  if (method === "GET" && p0 === "me" && p1 === "bookings" && p2 && parts[3] === "checkin-token") {
    return authedRead((sql, user) => checkinH.meBookingCheckinToken(sql, p2, user));
  }
  if (method === "POST" && p0 === "me" && p1 === "self-checkin") {
    return authed((sql, user) => checkinH.meSelfCheckin(sql, request, user));
  }
  // Promotions (FR-PAY-03, BR-44..46, BR-70). "validate" before the /:id routes.
  if (method === "GET" && p0 === "promotions" && !p1) {
    return authedRead((sql, user) => promoH.promosList(sql, user));
  }
  if (method === "POST" && p0 === "promotions" && p1 === "validate") {
    return authedRead((sql, user) => promoH.promosValidate(sql, request, user));
  }
  if (method === "POST" && p0 === "promotions" && !p1) {
    return authed((sql, user) => promoH.promosCreate(sql, request, user));
  }
  if (method === "PATCH" && p0 === "promotions" && p1 && !p2) {
    return authed((sql, user) => promoH.promosPatch(sql, p1, request, user));
  }
  if (method === "GET" && p0 === "promotions" && p1 && p2 === "redemptions") {
    return authedRead((sql, user) => promoH.promosRedemptions(sql, p1, user));
  }
  if (method === "POST" && p0 === "assistant") {
    return authed((sql, user) => opsH.assistantChat(sql, request, user));
  }
  // Before the bare /tickets read, or "mine" is matched as a ticket id.
  if (method === "GET" && p0 === "tickets" && p1 === "mine") {
    return authedRead((sql, user) => opsH.ticketsMine(sql, user));
  }
  if (method === "GET" && p0 === "tickets" && !p1) {
    return authedRead((sql, user) => opsH.ticketsList(sql, request, user));
  }
  if (method === "POST" && p0 === "tickets" && !p1) {
    return authed((sql, user) => opsH.ticketsCreate(sql, request, user));
  }
  if (method === "POST" && p0 === "tickets" && p1 && p2 === "reply") {
    return authed((sql, user) => opsH.ticketReply(sql, p1, request, user));
  }
  if (method === "POST" && p0 === "tickets" && p1 && p2 === "close") {
    return authed((sql, user) => opsH.ticketClose(sql, p1, user));
  }
  if (method === "GET" && p0 === "flags") {
    const sql = await getSql();
    return opsH.flagsGet(sql);
  }
  if (method === "PATCH" && p0 === "flags") {
    return authed((sql, user) => opsH.flagsPatch(sql, request, user));
  }

  if (method === "DELETE" && p0 === "payments") {
    throw err.forbidden("Payments cannot be deleted — issue a refund instead.");
  }

  void staffRoles;
  void idem;
  throw err.notFound(`No route for ${method} /v1/${parts.join("/")}`);
}

export async function handleApi(request: Request): Promise<Response> {
  try {
    const result = await dispatch(request);
    if (result instanceof Response) return result;
    if (result.status === 204) return new Response(null, { status: 204 });
    return json(result.status, result.body);
  } catch (e) {
    if (e instanceof ApiError) return json(e.status, e.body());
    return handleError(e);
  }
}
