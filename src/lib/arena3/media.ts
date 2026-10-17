export type MediaSlotKind = "image" | "video";
export type MediaAspectRatio = "16:9" | "4:5" | "1:1" | "3:4";
export type MediaSlotGroup =
  | "landing"
  | "auth"
  | "banner"
  | "sport"
  | "coach"
  | "brand";

export type MediaSlotDef = {
  slot: string;
  kind: MediaSlotKind;
  group: MediaSlotGroup;
  labelEn: string;
  labelVi: string;
  locationEn: string;
  locationVi: string;
  aspect: MediaAspectRatio;
};

export const MEDIA_REGISTRY: MediaSlotDef[] = [
  // Landing
  {
    slot: "landing.hero.image",
    kind: "image",
    group: "landing",
    labelEn: "Hero background / poster",
    labelVi: "Ảnh nền / poster đầu trang",
    locationEn: "Home Hero section",
    locationVi: "Mục đầu trang chủ",
    aspect: "16:9",
  },
  {
    slot: "landing.hero.video",
    kind: "video",
    group: "landing",
    labelEn: "Hero background video",
    labelVi: "Video nền đầu trang",
    locationEn: "Home Hero section",
    locationVi: "Mục đầu trang chủ",
    aspect: "16:9",
  },
  {
    slot: "landing.courts.badminton",
    kind: "image",
    group: "landing",
    labelEn: "Badminton court card",
    labelVi: "Thẻ sân cầu lông",
    locationEn: "Home Courts section",
    locationVi: "Mục sân đấu trang chủ",
    aspect: "16:9",
  },
  {
    slot: "landing.courts.basketball",
    kind: "image",
    group: "landing",
    labelEn: "Basketball court card",
    labelVi: "Thẻ sân bóng rổ",
    locationEn: "Home Courts section",
    locationVi: "Mục sân đấu trang chủ",
    aspect: "16:9",
  },
  {
    slot: "landing.courts.volleyball",
    kind: "image",
    group: "landing",
    labelEn: "Volleyball court card",
    labelVi: "Thẻ sân bóng chuyền",
    locationEn: "Home Courts section",
    locationVi: "Mục sân đấu trang chủ",
    aspect: "16:9",
  },
  {
    slot: "landing.facilities.badminton",
    kind: "image",
    group: "landing",
    labelEn: "Badminton facility",
    labelVi: "Cơ sở vật chất cầu lông",
    locationEn: "Home Facilities section",
    locationVi: "Mục cơ sở vật chất trang chủ",
    aspect: "16:9",
  },
  {
    slot: "landing.facilities.basketball",
    kind: "image",
    group: "landing",
    labelEn: "Basketball facility",
    labelVi: "Cơ sở vật chất bóng rổ",
    locationEn: "Home Facilities section",
    locationVi: "Mục cơ sở vật chất trang chủ",
    aspect: "16:9",
  },
  {
    slot: "landing.facilities.volleyball",
    kind: "image",
    group: "landing",
    labelEn: "Volleyball facility",
    labelVi: "Cơ sở vật chất bóng chuyền",
    locationEn: "Home Facilities section",
    locationVi: "Mục cơ sở vật chất trang chủ",
    aspect: "16:9",
  },
  {
    slot: "landing.facilities.reception",
    kind: "image",
    group: "landing",
    labelEn: "Reception desk",
    labelVi: "Quầy lễ tân",
    locationEn: "Home Facilities section",
    locationVi: "Mục cơ sở vật chất trang chủ",
    aspect: "16:9",
  },
  {
    slot: "landing.facilities.hall",
    kind: "image",
    group: "landing",
    labelEn: "Main hall overview",
    labelVi: "Toàn cảnh cụm sân",
    locationEn: "Home Facilities section",
    locationVi: "Mục cơ sở vật chất trang chủ",
    aspect: "16:9",
  },
  {
    slot: "landing.pricing.image",
    kind: "image",
    group: "landing",
    labelEn: "Court detail (pricing)",
    labelVi: "Chi tiết mặt sân (bảng giá)",
    locationEn: "Home Pricing section",
    locationVi: "Mục bảng giá trang chủ",
    aspect: "16:9",
  },
  {
    slot: "landing.pricing.video",
    kind: "video",
    group: "landing",
    labelEn: "Smash action video",
    labelVi: "Video đập bóng (bảng giá)",
    locationEn: "Home Pricing section",
    locationVi: "Mục bảng giá trang chủ",
    aspect: "16:9",
  },
  {
    slot: "landing.closing",
    kind: "image",
    group: "landing",
    labelEn: "Frontage at dusk",
    labelVi: "Mặt tiền trung tâm lúc hoàng hôn",
    locationEn: "Home Closing section",
    locationVi: "Mục cuối trang chủ",
    aspect: "16:9",
  },

  // Auth
  {
    slot: "auth.login.image",
    kind: "image",
    group: "auth",
    labelEn: "Sign-in side photo",
    labelVi: "Ảnh bên cạnh đăng nhập",
    locationEn: "Sign-in page",
    locationVi: "Trang đăng nhập",
    aspect: "4:5",
  },
  {
    slot: "auth.login.video",
    kind: "video",
    group: "auth",
    labelEn: "Sign-in video background",
    labelVi: "Video nền đăng nhập",
    locationEn: "Sign-in page",
    locationVi: "Trang đăng nhập",
    aspect: "16:9",
  },
  {
    slot: "auth.register.image",
    kind: "image",
    group: "auth",
    labelEn: "Register athlete photo",
    labelVi: "Ảnh vận động viên đăng ký",
    locationEn: "Register page",
    locationVi: "Trang đăng ký",
    aspect: "4:5",
  },

  // Banner
  {
    slot: "banner.book",
    kind: "image",
    group: "banner",
    labelEn: "Booking banner",
    labelVi: "Banner đặt sân",
    locationEn: "Court booking page",
    locationVi: "Trang đặt sân",
    aspect: "16:9",
  },
  {
    slot: "banner.classes",
    kind: "image",
    group: "banner",
    labelEn: "Classes banner",
    labelVi: "Banner lớp học",
    locationEn: "Classes page",
    locationVi: "Trang lớp học",
    aspect: "16:9",
  },
  {
    slot: "banner.train",
    kind: "image",
    group: "banner",
    labelEn: "Training banner",
    labelVi: "Banner tập luyện",
    locationEn: "Training page",
    locationVi: "Trang tập luyện",
    aspect: "16:9",
  },
  {
    slot: "banner.coach",
    kind: "image",
    group: "banner",
    labelEn: "Coach banner",
    labelVi: "Banner huấn luyện viên",
    locationEn: "Coach schedule",
    locationVi: "Lịch huấn luyện viên",
    aspect: "16:9",
  },
  {
    slot: "banner.gate",
    kind: "image",
    group: "banner",
    labelEn: "Gate check-in banner",
    labelVi: "Banner cổng soát vé",
    locationEn: "Reception check-in gate",
    locationVi: "Cổng check-in lễ tân",
    aspect: "16:9",
  },
  {
    slot: "banner.manager",
    kind: "image",
    group: "banner",
    labelEn: "Manager overview banner",
    labelVi: "Banner tổng quan quản lý",
    locationEn: "Manager dashboard",
    locationVi: "Bảng điều khiển quản lý",
    aspect: "16:9",
  },

  // Sport
  {
    slot: "sport.badminton",
    kind: "image",
    group: "sport",
    labelEn: "Badminton sport photo",
    labelVi: "Ảnh môn cầu lông",
    locationEn: "Plans & booking: Badminton",
    locationVi: "Gói tập & đặt sân: Cầu lông",
    aspect: "16:9",
  },
  {
    slot: "sport.basketball",
    kind: "image",
    group: "sport",
    labelEn: "Basketball sport photo",
    labelVi: "Ảnh môn bóng rổ",
    locationEn: "Plans & booking: Basketball",
    locationVi: "Gói tập & đặt sân: Bóng rổ",
    aspect: "16:9",
  },
  {
    slot: "sport.volleyball",
    kind: "image",
    group: "sport",
    labelEn: "Volleyball sport photo",
    labelVi: "Ảnh môn bóng chuyền",
    locationEn: "Plans & booking: Volleyball",
    locationVi: "Gói tập & đặt sân: Bóng chuyền",
    aspect: "16:9",
  },
  {
    slot: "sport.all",
    kind: "image",
    group: "sport",
    labelEn: "All-sports photo",
    labelVi: "Ảnh đa môn thể thao",
    locationEn: "Plans & booking: All sports",
    locationVi: "Gói tập & đặt sân: Đa môn",
    aspect: "16:9",
  },


  // Coaches (seeded demo coaches)
  {
    slot: "coach.00000000-0000-0000-0000-000000000011",
    kind: "image",
    group: "coach",
    labelEn: "Coach Nguyen Minh Khoa",
    labelVi: "HLV Nguyễn Minh Khoa",
    locationEn: "Coaches section & classes",
    locationVi: "Mục HLV & thông tin lớp học",
    aspect: "1:1",
  },
  {
    slot: "coach.00000000-0000-0000-0000-000000000012",
    kind: "image",
    group: "coach",
    labelEn: "Coach Tran Thi Lan",
    labelVi: "HLV Trần Thị Lan",
    locationEn: "Coaches section & classes",
    locationVi: "Mục HLV & thông tin lớp học",
    aspect: "1:1",
  },
  {
    slot: "coach.00000000-0000-0000-0000-000000000013",
    kind: "image",
    group: "coach",
    labelEn: "Coach Pham Duc Anh",
    labelVi: "HLV Phạm Đức Anh",
    locationEn: "Coaches section & classes",
    locationVi: "Mục HLV & thông tin lớp học",
    aspect: "1:1",
  },
  {
    slot: "coach.00000000-0000-0000-0000-000000000014",
    kind: "image",
    group: "coach",
    labelEn: "Coach Le Quoc Viet",
    labelVi: "HLV Lê Quốc Việt",
    locationEn: "Coaches section & classes",
    locationVi: "Mục HLV & thông tin lớp học",
    aspect: "1:1",
  },
  {
    slot: "coach.00000000-0000-0000-0000-000000000003",
    kind: "image",
    group: "coach",
    labelEn: "Coach Minh Quan",
    labelVi: "HLV Minh Quân",
    locationEn: "Coaches section & classes",
    locationVi: "Mục HLV & thông tin lớp học",
    aspect: "1:1",
  },
];

export function findSlotDef(slot: string): MediaSlotDef | undefined {
  if (slot.startsWith("coach.")) {
    const existing = MEDIA_REGISTRY.find((r) => r.slot === slot);
    if (existing) return existing;
    return {
      slot,
      kind: "image",
      group: "coach",
      labelEn: "Coach Avatar",
      labelVi: "Ảnh đại diện HLV",
      locationEn: "Coaches section & classes",
      locationVi: "Mục HLV & thông tin lớp học",
      aspect: "1:1",
    };
  }
  return MEDIA_REGISTRY.find((r) => r.slot === slot);
}

export function sportPhoto(sport: string): string {
  if (sport === "basketball") return "sport.basketball";
  if (sport === "volleyball") return "sport.volleyball";
  if (sport === "all") return "sport.all";
  return "sport.badminton";
}
