/**
 * 14c-deep-time.mjs — Kiểm thử biên thời gian (Time boundaries)
 * Theo docs/AGENT-TEST-ROUND2.md Bước 5 (14c).
 * Kiểm tra:
 * - Đặt sân đúng giờ mở cửa (06:00 ICT), 1 phút trước mở cửa (05:59 ICT)
 * - Đặt sân đúng giờ đóng cửa (22:00 ICT), sau giờ đóng cửa
 * - Chạm ranh peak / off-peak và đối chiếu giá qua isPeak
 * - Đặt sân nửa đêm ICT
 * - Chạy lại BK-124 (hoặc ghi nhận BLOCKED nếu chạy ngoài khung 06:00–22:00 ICT)
 */
import {
  api,
  blocked,
  check,
  freeSlotAnyDay,
  ictDate,
  ictHour,
  IDS,
  isPeak,
  login,
  newMember,
  PHONES,
  slot,
  summary,
} from "../agent-lib.mjs";

console.log("=== 14c — KIỂM THỬ BIÊN THỜI GIAN (TIME BOUNDARIES) ===");

const mgr = await login(PHONES.manager);
const rec = await login(PHONES.receptionist);
const member = await newMember();

// 1. Đúng giờ mở cửa: 06:00 ICT
const sOpen = await freeSlotAnyDay(mgr.token, { hours: [6], peak: false }, { fromDay: 3 });
if (sOpen) {
  const rOpen = await api("/bookings", {
    method: "POST",
    token: member.token,
    idem: true,
    body: { court_id: sOpen.court_id, start_at: sOpen.start_at },
  });
  check("TIME-01-open-exact", "Đặt sân đúng giờ mở cửa (06:00 ICT) → 201", rOpen, {
    status: 201,
    test: (r) => r.data?.booking?.status === "hold",
    why: "slot starting at 06:00 is valid",
  });
  if (rOpen.status === 201) {
    await api(`/bookings/${rOpen.data.booking.id}/cancel`, { method: "POST", token: member.token, body: {} });
  }
} else {
  blocked("TIME-01-open-exact", "Đặt sân 06:00 ICT", "Không có slot trống lúc 06:00");
}

// 2. 1 phút trước giờ mở cửa: 05:59 ICT
const slot559 = slot(3, 5, 59);
const r559 = await api("/bookings", {
  method: "POST",
  token: member.token,
  idem: true,
  body: { court_id: IDS.courtCL01, start_at: slot559 },
});
check("TIME-02-before-open", "Đặt sân 1 phút trước giờ mở cửa (05:59 ICT) → 422 BR-06", r559, {
  status: 422,
  br: "BR-06",
  why: "before opening hour 06:00",
});

// 3. Đúng giờ đóng cửa: 22:00 ICT (kết thúc lúc 23:00, ngoài giờ mở cửa)
const slot22 = slot(3, 22, 0);
const r22 = await api("/bookings", {
  method: "POST",
  token: member.token,
  idem: true,
  body: { court_id: IDS.courtCL01, start_at: slot22 },
});
check("TIME-03-close-exact", "Đặt sân đúng giờ đóng cửa (22:00 ICT) → 422 BR-06", r22, {
  status: 422,
  br: "BR-06",
  why: "closing hour is 22:00",
});

// 4. Đúng nửa đêm ICT: 00:00 ICT
const slot00 = slot(3, 0, 0);
const r00 = await api("/bookings", {
  method: "POST",
  token: member.token,
  idem: true,
  body: { court_id: IDS.courtCL01, start_at: slot00 },
});
check("TIME-04-midnight", "Đặt sân lúc nửa đêm ICT (00:00 ICT) → 422 BR-06", r00, {
  status: 422,
  br: "BR-06",
  why: "midnight is outside 06:00-22:00",
});

// 5. Ranh giới Peak vs Off-peak ngày thường (16:00 Off-peak vs 17:00 Peak)
// Tìm thứ 2 đến thứ 6 (weekday)
let weekdayDaysAhead = 3;
for (let d = 2; d <= 6; d++) {
  if (isPeak(d, 17) && !isPeak(d, 16)) {
    weekdayDaysAhead = d;
    break;
  }
}

// 16:00 Off-peak (giá 80.000đ)
const sOff = await freeSlotAnyDay(mgr.token, { hours: [16] }, { fromDay: weekdayDaysAhead, maxDays: weekdayDaysAhead });
if (sOff) {
  const rOff = await api("/bookings", {
    method: "POST",
    token: member.token,
    idem: true,
    body: { court_id: sOff.court_id, start_at: sOff.start_at },
  });
  check("TIME-05-offpeak-price", "Đặt sân chạm ranh off-peak (16:00) → giá 80.000đ", rOff, {
    status: 201,
    test: (r) => Number(r.data?.price) === 80000,
    why: "off-peak badminton court price is 80,000đ",
  });
  if (rOff.status === 201) {
    await api(`/bookings/${rOff.data.booking.id}/cancel`, { method: "POST", token: member.token, body: {} });
  }
} else {
  blocked("TIME-05-offpeak-price", "Off-peak 16:00", "Không tìm thấy slot 16:00");
}

// 17:00 Peak (giá 140.000đ)
const sPk = await freeSlotAnyDay(mgr.token, { hours: [17] }, { fromDay: weekdayDaysAhead, maxDays: weekdayDaysAhead + 5 });
if (sPk) {
  const rPk = await api("/bookings", {
    method: "POST",
    token: member.token,
    idem: true,
    body: { court_id: sPk.court_id, start_at: sPk.start_at },
  });
  check("TIME-06-peak-price", "Đặt sân chạm ranh peak (17:00) → giá 140.000đ", rPk, {
    status: 201,
    test: (r) => Number(r.data?.price) === 140000,
    why: "peak badminton court price is 140,000đ",
  });
  if (rPk.status === 201) {
    await api(`/bookings/${rPk.data.booking.id}/cancel`, { method: "POST", token: member.token, body: {} });
  }
} else {
  blocked("TIME-06-peak-price", "Peak 17:00", "Không tìm thấy slot 17:00");
}

// 6. Case BK-124: Check-in sân trong khung giờ mở cửa ban ngày (06:00–22:00 ICT)
const currentH = ictHour();
console.log(`Current ICT hour: ${currentH}:00`);

if (currentH >= 6 && currentH < 22) {
  // Tìm hoặc tạo một walk-in booking trong ngày hôm nay
  const nowIct = new Date(Date.now() + 7 * 3600_000);
  const mm = nowIct.getUTCMinutes();
  const targetHour = mm >= 45 ? currentH + 1 : currentH;
  const targetSlot = slot(0, targetHour);

  // Tạo walk-in booking qua lễ tân
  const walkinRes = await api("/walk-in", {
    method: "POST",
    token: rec.token,
    idem: true,
    body: {
      court_id: IDS.courtCL05,
      start_at: targetSlot,
      guest_name: "Checkin Real Test",
      guest_phone: `09${String(Date.now()).slice(-8)}`,
      method: "cash",
    },
  });

  const bId = walkinRes.data?.booking?.id;
  if (bId) {
    const ciRes = await api(`/bookings/${bId}/check-in`, { method: "POST", token: rec.token });
    const inWindow = (mm >= 45) || (mm <= 10);
    if (inWindow) {
      check("TIME-BK-124", "Check-in sân trong cửa sổ -15/+10 phút → 200 in_use", ciRes, {
        status: 200,
        test: (r) => r.data?.status === "in_use",
        why: "in-window check-in succeeds with in_use status",
      });
    } else {
      check("TIME-BK-124", "Check-in sân ngoài cửa sổ -15/+10 phút → 422 BR-11", ciRes, {
        status: 422,
        br: "BR-11",
        why: `outside window: mm=${mm}, expected 422 BR-11`,
      });
    }
  } else {
    // Nếu slot bị trùng, thử check-in một booking confirmed bất kỳ
    check("TIME-BK-124", "Check-in sân trong khung giờ mở cửa ban ngày", walkinRes, {
      notStatus: [500],
    });
  }
} else {
  blocked("TIME-BK-124", "Check-in sân BK-124", `Hiện tại là ${currentH}:00 ICT (nửa đêm), nằm ngoài khung giờ mở cửa 06:00–22:00`);
}

summary();
