/**
 * manager-admin.mjs — Test suite for Manager Media, Courts, and Staff Admin
 * (Docs: docs/AGENT-MANAGER-ADMIN.md, Phần 4)
 *
 * Covers:
 *   - Assets: public list, RBAC (403 for non-manager), valid upload (JPEG, PNG, WebP),
 *     invalid files (SVG renamed, HTML, GIF, bad magic, >2MB, bad slot, video slot upload,
 *     traversal/http src_path), revert & reset, enabled reflection, file endpoint headers, audit.
 *   - Courts: auto-generated code, duplicate code (409), invalid format (422), RBAC (403),
 *     blocked sport change on future occupancies, retire blocked vs clean, retired court hold BR-06,
 *     GET /v1/courts exclusion, restore, last court of sport with active plans protection,
 *     PATCH status backwards compatibility.
 *   - Staff: happy path receptionist & coach (with sports), duplicate phone BR-01, coach missing sports (400),
 *     RBAC (403 for non-manager).
 */

import { IDS, api, check, loginAll, summary } from "../agent-lib.mjs";

console.log("===============================================================");
console.log("  SUITE: MANAGER-ADMIN (MEDIA, COURTS, STAFF)");
console.log("===============================================================\n");

const who = await loginAll();
const mgr = who.manager.token;
const rec = who.receptionist.token;
const coa = who.coach.token;
const mem = who.memberNoPlan.token;

const nonManagers = [
  { role: "receptionist", token: rec },
  { role: "coach", token: coa },
  { role: "member", token: mem },
];

// Helper: build a synthetic PNG buffer of width x height
function makePng(width = 800, height = 600) {
  const buf = Buffer.alloc(100);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52]).copy(buf, 0);
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

// Helper: build a synthetic JPEG buffer
function makeJpeg() {
  // JPEG SOI (FF D8) + SOF0 (FF C0) with height 600, width 800
  const buf = Buffer.alloc(50);
  buf[0] = 0xff; buf[1] = 0xd8; // SOI
  buf[2] = 0xff; buf[3] = 0xc0; // SOF0
  buf.writeUInt16BE(17, 4);     // length
  buf[6] = 8;                   // precision
  buf.writeUInt16BE(600, 7);    // height
  buf.writeUInt16BE(800, 9);    // width
  buf[11] = 3;                  // components
  return buf;
}

// Helper: build a synthetic WebP buffer (VP8 lossy)
function makeWebp(width = 800, height = 600) {
  const buf = Buffer.alloc(40);
  Buffer.from("RIFF").copy(buf, 0);
  buf.writeUInt32LE(32, 4);
  Buffer.from("WEBPVP8 ").copy(buf, 8);
  buf.writeUInt32LE(20, 16);
  // VP8 keyframe header
  buf[20] = 0x9d; buf[21] = 0x01; buf[22] = 0x2a;
  buf.writeUInt16LE(width & 0x3fff, 26);
  buf.writeUInt16LE(height & 0x3fff, 28);
  return buf;
}

// ---------------------------------------------------------------------------
// 1. ASSETS TESTS
// ---------------------------------------------------------------------------
console.log("\n--- 1. Assets: Public List & RBAC ---");

// Public list without auth
const pubList = await api("/site-assets");
check("AST-01", "GET /v1/site-assets without auth returns 200", pubList, {
  status: 200,
  test: (r) => Array.isArray(r.data?.items) && r.data.items.length > 0,
  why: "items is a non-empty array",
});

// Non-manager role access checks
for (const { role, token } of nonManagers) {
  const rList = await api("/manager/site-assets", { token });
  check(`AST-02-${role}`, `GET /v1/manager/site-assets as ${role} -> 403`, rList, { status: 403 });

  const rUpload = await api("/manager/site-assets/upload", {
    method: "POST",
    token,
    body: { slot: "landing.hero.image", data_base64: makePng().toString("base64") },
  });
  check(`AST-03-${role}`, `POST /v1/manager/site-assets/upload as ${role} -> 403`, rUpload, { status: 403 });

  const rPatch = await api("/manager/site-assets/landing.hero.image", {
    method: "PATCH",
    token,
    body: { enabled: false },
  });
  check(`AST-04-${role}`, `PATCH /v1/manager/site-assets/:slot as ${role} -> 403`, rPatch, { status: 403 });

  const rRevert = await api("/manager/site-assets/landing.hero.image/revert", {
    method: "POST",
    token,
    body: {},
  });
  check(`AST-05-${role}`, `POST /v1/manager/site-assets/:slot/revert as ${role} -> 403`, rRevert, { status: 403 });

  const rReset = await api("/manager/site-assets/landing.hero.image/reset", {
    method: "POST",
    token,
    body: {},
  });
  check(`AST-06-${role}`, `POST /v1/manager/site-assets/:slot/reset as ${role} -> 403`, rReset, { status: 403 });
}

console.log("\n--- 1. Assets: Upload Valid Formats & Version Increment ---");

// Read initial version of landing.hero.image
const initialList = await api("/manager/site-assets", { token: mgr });
const initialHero = initialList.data?.items?.find((x) => x.slot === "landing.hero.image");
const v0 = initialHero?.version ?? 1;

// Upload valid PNG
const upPng = await api("/manager/site-assets/upload", {
  method: "POST",
  token: mgr,
  body: { slot: "landing.hero.image", data_base64: makePng(800, 600).toString("base64") },
});
check("AST-07", "Upload valid PNG -> 200 and version increments", upPng, {
  status: 200,
  test: (r) => r.data?.version === v0 + 1 && r.data?.url?.includes("/v1/site-assets/landing.hero.image/file"),
  why: `version increments from ${v0} to ${v0 + 1}`,
});

// Upload valid JPEG
const upJpeg = await api("/manager/site-assets/upload", {
  method: "POST",
  token: mgr,
  body: { slot: "landing.hero.image", data_base64: makeJpeg().toString("base64") },
});
check("AST-08", "Upload valid JPEG -> 200 and version increments", upJpeg, {
  status: 200,
  test: (r) => r.data?.version === v0 + 2,
  why: `version increments to ${v0 + 2}`,
});

// Upload valid WebP
const upWebp = await api("/manager/site-assets/upload", {
  method: "POST",
  token: mgr,
  body: { slot: "landing.hero.image", data_base64: makeWebp(800, 600).toString("base64") },
});
check("AST-09", "Upload valid WebP -> 200 and version increments", upWebp, {
  status: 200,
  test: (r) => r.data?.version === v0 + 3,
  why: `version increments to ${v0 + 3}`,
});

console.log("\n--- 1. Assets: Validation & Rejections ---");

// SVG disguised / renamed
const svgFake = Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'><circle r='50'/></svg>");
const upSvg = await api("/manager/site-assets/upload", {
  method: "POST",
  token: mgr,
  body: { slot: "landing.hero.image", data_base64: svgFake.toString("base64") },
});
check("AST-10", "Upload disguised SVG -> 422", upSvg, { status: 422 });

// HTML
const htmlFake = Buffer.from("<!DOCTYPE html><html><body><h1>test</h1></body></html>");
const upHtml = await api("/manager/site-assets/upload", {
  method: "POST",
  token: mgr,
  body: { slot: "landing.hero.image", data_base64: htmlFake.toString("base64") },
});
check("AST-11", "Upload HTML payload -> 422", upHtml, { status: 422 });

// GIF
const gifFake = Buffer.from("GIF89a\x01\x00\x01\x00\x80\x00\x00");
const upGif = await api("/manager/site-assets/upload", {
  method: "POST",
  token: mgr,
  body: { slot: "landing.hero.image", data_base64: gifFake.toString("base64") },
});
check("AST-12", "Upload GIF format -> 422", upGif, { status: 422 });

// Invalid magic bytes
const badMagic = Buffer.from("random invalid binary garbage for testing magic bytes");
const upBadMagic = await api("/manager/site-assets/upload", {
  method: "POST",
  token: mgr,
  body: { slot: "landing.hero.image", data_base64: badMagic.toString("base64") },
});
check("AST-13", "Upload invalid magic bytes -> 422", upBadMagic, { status: 422 });

// Exceeds 2 MB
const largeBuf = Buffer.alloc(2 * 1024 * 1024 + 500);
const upLarge = await api("/manager/site-assets/upload", {
  method: "POST",
  token: mgr,
  body: { slot: "landing.hero.image", data_base64: largeBuf.toString("base64") },
});
check("AST-14", "Upload exceeding 2 MB -> 422 or 413", upLarge, {
  status: [413, 422],
});

// Unknown slot
const upUnknown = await api("/manager/site-assets/upload", {
  method: "POST",
  token: mgr,
  body: { slot: "nonexistent.unknown.slot", data_base64: makePng().toString("base64") },
});
check("AST-15", "Upload to unknown slot -> 404", upUnknown, { status: 404 });

// Video slot upload / PUT -> 422
const upVideo = await api("/manager/site-assets/landing.hero.video", {
  method: "PUT",
  token: mgr,
  body: { data_base64: makePng().toString("base64") },
});
check("AST-16", "Upload/PUT image to video slot -> 422", upVideo, { status: 422 });

// src_path with traversal or http
const patchTraversal = await api("/manager/site-assets/landing.hero.image", {
  method: "PATCH",
  token: mgr,
  body: { src_path: "/media/../secret.txt" },
});
check("AST-17", "PATCH src_path with '..' -> 422", patchTraversal, { status: 422 });

const patchHttp = await api("/manager/site-assets/landing.hero.image", {
  method: "PATCH",
  token: mgr,
  body: { src_path: "https://evil.com/image.png" },
});
check("AST-18", "PATCH src_path with 'http' -> 422", patchHttp, { status: 422 });

console.log("\n--- 1. Assets: Revert, Reset, Enabled & File Headers ---");

// Revert to previous version
const revRes = await api("/manager/site-assets/landing.hero.image/revert", {
  method: "POST",
  token: mgr,
  body: {},
});
check("AST-19", "Revert to previous version -> 200", revRes, { status: 200 });

// Reset to default
const resetRes = await api("/manager/site-assets/landing.hero.image/reset", {
  method: "POST",
  token: mgr,
  body: {},
});
check("AST-20", "Reset to default -> 200", resetRes, { status: 200 });

// Check enabled = false reflects in public list
await api("/manager/site-assets/landing.hero.image", {
  method: "PATCH",
  token: mgr,
  body: { enabled: false },
});
const pubAfterDisable = await api("/site-assets");
const disabledItem = pubAfterDisable.data?.items?.find((x) => x.slot === "landing.hero.image");
check("AST-21", "PATCH enabled: false reflects in public list", pubAfterDisable, {
  status: 200,
  test: () => disabledItem?.enabled === false,
  why: "landing.hero.image enabled is false",
});

// Restore enabled = true
await api("/manager/site-assets/landing.hero.image", {
  method: "PATCH",
  token: mgr,
  body: { enabled: true },
});

// Test file endpoint headers
// First upload a fresh PNG to ensure bytes are stored
await api("/manager/site-assets/upload", {
  method: "POST",
  token: mgr,
  body: { slot: "landing.hero.image", data_base64: makePng().toString("base64") },
});
const fileRes = await api("/site-assets/landing.hero.image/file");
check("AST-22", "File endpoint returns Content-Type and nosniff", fileRes, {
  status: 200,
  test: (r) =>
    r.headers["content-type"] === "image/png" &&
    r.headers["x-content-type-options"] === "nosniff",
  why: "Content-Type is image/png and X-Content-Type-Options is nosniff",
});

// Audit logged
const auditRes = await api("/audit", { token: mgr });
check("AST-23", "Asset operations generate audit log", auditRes, {
  status: 200,
  test: (r) => (r.data?.items ?? []).some((a) => a.action === "replace_asset" || a.action === "revert_asset" || a.action === "patch_asset"),
  why: "Audit log contains replace_asset, revert_asset, or patch_asset",
});

// Reset hero image back to default cleanly
await api("/manager/site-assets/landing.hero.image/reset", {
  method: "POST",
  token: mgr,
  body: {},
});


// ---------------------------------------------------------------------------
// 2. COURTS TESTS
// ---------------------------------------------------------------------------
console.log("\n--- 2. Courts: CRUD, Validation, RBAC & Protection ---");

// Auto-generated code
const createAuto = await api("/manager/courts", {
  method: "POST",
  token: mgr,
  body: { sport: "badminton", display_name: "Auto Court" },
});
check("CRT-01", "Create court with auto-generated code -> 201", createAuto, {
  status: 201,
  test: (r) => /^CL-\d{2,3}$/.test(r.data?.court?.court_code),
  why: `court_code ${createAuto.data?.court?.court_code} matches ^CL-\\d{2,3}$`,
});
const newCourtId = createAuto.data?.court?.id;
const newCourtCode = createAuto.data?.court?.court_code;

// Duplicate code -> 409
const dupCode = await api("/manager/courts", {
  method: "POST",
  token: mgr,
  body: { sport: "badminton", court_code: "CL-01" },
});
check("CRT-02", "Duplicate court code -> 409", dupCode, { status: 409 });

// Invalid code format -> 422
const badCode = await api("/manager/courts", {
  method: "POST",
  token: mgr,
  body: { sport: "badminton", court_code: "badminton-1" },
});
check("CRT-03", "Invalid court code format -> 422", badCode, { status: 422 });

// Non-manager role -> 403
for (const { role, token } of nonManagers) {
  const rCreate = await api("/manager/courts", { method: "POST", token, body: { sport: "badminton" } });
  check(`CRT-04-${role}`, `POST /v1/manager/courts as ${role} -> 403`, rCreate, { status: 403 });

  const rList = await api("/manager/courts", { token });
  check(`CRT-05-${role}`, `GET /v1/manager/courts as ${role} -> 403`, rList, { status: 403 });

  const rRetire = await api(`/manager/courts/${newCourtId}/retire`, { method: "POST", token });
  check(`CRT-06-${role}`, `POST /v1/manager/courts/:id/retire as ${role} -> 403`, rRetire, { status: 403 });

  const rRestore = await api(`/manager/courts/${newCourtId}/restore`, { method: "POST", token });
  check(`CRT-07-${role}`, `POST /v1/manager/courts/:id/restore as ${role} -> 403`, rRestore, { status: 403 });
}

// Block sport change when future occupancies exist (F6: PATCH /v1/manager/courts/:id)
const chgSportBlocked = await api(`/manager/courts/${IDS.courtCL01}`, {
  method: "PATCH",
  token: mgr,
  body: { sport: "basketball" },
});
check("CRT-08", "PATCH /v1/manager/courts/:id change sport with future occupancies -> 409", chgSportBlocked, {
  status: 409,
  test: (r) => r.status === 409 && typeof r.data?.message === "string" && r.data.message.length > 0,
  why: "PATCH /v1/manager/courts/:id returns 409 with clear message",
});

// Retire blocked when future bookings/classes exist
const retireBlocked = await api(`/manager/courts/${IDS.courtCL01}/retire`, {
  method: "POST",
  token: mgr,
  body: {},
});
check("CRT-09", "Retire court with future occupancies -> 409 with blockers", retireBlocked, {
  status: 409,
  test: (r) => Array.isArray(r.data?.blockers) && r.data.blockers.length > 0,
  why: "blockers array is non-empty",
});

// Retire clean court -> 200
const retireClean = await api(`/manager/courts/${newCourtId}/retire`, {
  method: "POST",
  token: mgr,
  body: {},
});
check("CRT-10", "Retire clean court without occupancies -> 200", retireClean, {
  status: 200,
  test: (r) => r.data?.court?.retired_at !== null && r.data?.court?.status === "closed",
  why: "court.retired_at is set and status is closed",
});

// Retired court cannot be held (BR-06)
const holdRetired = await api("/bookings", {
  method: "POST",
  token: mem,
  idem: true,
  body: {
    court_id: newCourtId,
    start_at: "2026-10-20T10:00:00+07:00",
    end_at: "2026-10-20T11:00:00+07:00",
  },
});
check("CRT-11", "Hold booking on retired court -> BR-06 (422)", holdRetired, {
  status: 422,
  br: "BR-06",
});

// GET /v1/courts excludes retired court
const pubCourts = await api("/courts");
check("CRT-12", "GET /v1/courts excludes retired courts", pubCourts, {
  status: 200,
  test: (r) => !(r.data?.items ?? []).some((c) => c.id === newCourtId || c.court_code === newCourtCode),
  why: `court ${newCourtCode} is absent from /v1/courts`,
});

// Restore court
const restoreRes = await api(`/manager/courts/${newCourtId}/restore`, {
  method: "POST",
  token: mgr,
});
check("CRT-13", "Restore court -> 200 and court is ready", restoreRes, {
  status: 200,
  test: (r) => r.data?.court?.retired_at === null && r.data?.court?.status === "ready",
  why: "retired_at is null and status is ready",
});

// Confirm restored court is back in GET /v1/courts
const pubCourtsAfter = await api("/courts");
check("CRT-14", "GET /v1/courts includes restored court", pubCourtsAfter, {
  status: 200,
  test: (r) => (r.data?.items ?? []).some((c) => c.id === newCourtId),
  why: `court ${newCourtCode} is present again in /v1/courts`,
});

// Protect last court of sport with active plans
// BC-01 (volleyball) is the only volleyball court in seed
const retireLastBc = await api(`/manager/courts/${IDS.courtBC01}/retire`, {
  method: "POST",
  token: mgr,
  body: {},
});
check("CRT-15", "Retire last court of sport with active plans -> 409", retireLastBc, {
  status: 409,
});

// PATCH court with only status preserves backward compatibility
const patchStatus = await api(`/courts/${IDS.courtCL05}`, {
  method: "PATCH",
  token: mgr,
  body: { status: "maintenance" },
});
check("CRT-16", "PATCH /v1/courts/:id with only status works", patchStatus, {
  status: 200,
  test: (r) => r.data?.court?.status === "maintenance",
  why: "court status is updated to maintenance",
});
// Revert CL-05 back to ready
await api(`/courts/${IDS.courtCL05}`, {
  method: "PATCH",
  token: mgr,
  body: { status: "ready" },
});

// CRT-17: Retire clean court -> absent from desk occupancy, catalog, booking; Restore -> reappears (F4)
const retireCourtForF4 = await api(`/manager/courts/${newCourtId}/retire`, {
  method: "POST",
  token: mgr,
  body: {},
});
const occWhenRetired = await api("/reports/occupancy", { token: mgr });
const catWhenRetired = await api("/courts");
const bookWhenRetired = await api("/bookings", {
  method: "POST",
  token: mem,
  idem: true,
  body: {
    court_id: newCourtId,
    start_at: "2026-10-21T10:00:00+07:00",
    end_at: "2026-10-21T11:00:00+07:00",
  },
});
const restoreCourtForF4 = await api(`/manager/courts/${newCourtId}/restore`, {
  method: "POST",
  token: mgr,
});
const occWhenRestored = await api("/reports/occupancy", { token: mgr });
const catWhenRestored = await api("/courts");

const crt17Result = {
  status: 200,
  data: {
    retireStatus: retireCourtForF4.status,
    occRetiredHasIt: (occWhenRetired.data?.items ?? []).some((c) => c.court_id === newCourtId),
    catRetiredHasIt: (catWhenRetired.data?.items ?? []).some((c) => c.id === newCourtId),
    bookStatus: bookWhenRetired.status,
    restoreStatus: restoreCourtForF4.status,
    occRestoredHasIt: (occWhenRestored.data?.items ?? []).some((c) => c.court_id === newCourtId),
    catRestoredHasIt: (catWhenRestored.data?.items ?? []).some((c) => c.id === newCourtId),
  },
};

check("CRT-17", "Retire court hides it from desk occupancy, catalog, booking; Restore brings it back", crt17Result, {
  status: 200,
  test: (r) =>
    r.data.retireStatus === 200 &&
    !r.data.occRetiredHasIt &&
    !r.data.catRetiredHasIt &&
    r.data.bookStatus === 422 &&
    r.data.restoreStatus === 200 &&
    r.data.occRestoredHasIt &&
    r.data.catRestoredHasIt,
  why: "retired court is omitted from desk occupancy, catalog, and booking returns 422; restored court reappears in both",
});


// ---------------------------------------------------------------------------
// 3. STAFF TESTS
// ---------------------------------------------------------------------------
console.log("\n--- 3. Staff: Creation, Validation & Roles ---");

// Happy path: receptionist
const createRec = await api("/staff", {
  method: "POST",
  token: mgr,
  body: {
    full_name: "Test Staff Receptionist",
    phone: "0999000101",
    role: "receptionist",
  },
});
check("STF-01", "Create receptionist staff -> 201 with temp_password", createRec, {
  status: 201,
  test: (r) => Boolean(r.data?.staff?.id && r.data?.temp_password),
  why: "returns staff.id and temp_password",
});

// Happy path: coach with sports
const createCoach = await api("/staff", {
  method: "POST",
  token: mgr,
  body: {
    full_name: "Test Staff Coach",
    phone: "0999000102",
    role: "coach",
    sports: ["badminton", "basketball"],
  },
});
check("STF-02", "Create coach staff with sports -> 201 with temp_password and slot", createCoach, {
  status: 201,
  test: (r) => Boolean(r.data?.staff?.id && r.data?.temp_password),
  why: "returns staff.id and temp_password",
});

// Verify coach slot was registered in site_assets
const coachSlot = `coach.${createCoach.data?.staff?.id}`;
const mgrAssetsAfterCoach = await api("/manager/site-assets", { token: mgr });
check("STF-03", "Coach creation registers coach.<user.id> slot in site_assets", mgrAssetsAfterCoach, {
  status: 200,
  test: (r) => (r.data?.items ?? []).some((item) => item.slot === coachSlot),
  why: `slot ${coachSlot} exists in manager site-assets`,
});

// Duplicate phone -> BR-01 (422)
const dupPhone = await api("/staff", {
  method: "POST",
  token: mgr,
  body: {
    full_name: "Duplicate Phone Staff",
    phone: "0999000101",
    role: "receptionist",
  },
});
check("STF-04", "Create staff with duplicate phone -> 422 (BR-01)", dupPhone, {
  status: 422,
  br: "BR-01",
  test: (r) => r.data?.field === "phone",
  why: "error field is 'phone'",
});

// Coach without sports -> 400
const coachNoSports = await api("/staff", {
  method: "POST",
  token: mgr,
  body: {
    full_name: "Coach Without Sports",
    phone: "0999000103",
    role: "coach",
  },
});
check("STF-05", "Create coach without sports -> 400", coachNoSports, {
  status: 400,
  test: (r) => r.data?.field === "sports",
  why: "error field is 'sports'",
});

// Non-manager role -> 403
for (const { role, token } of nonManagers) {
  const rStaff = await api("/staff", {
    method: "POST",
    token,
    body: {
      full_name: "Unauthorized Staff",
      phone: `099900019${role.length}`,
      role: "receptionist",
    },
  });
  check(`STF-06-${role}`, `POST /v1/staff as ${role} -> 403`, rStaff, { status: 403 });
}

summary();
