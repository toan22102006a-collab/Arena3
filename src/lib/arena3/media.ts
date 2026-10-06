export const media = {
  hall: "/media/hall.jpg",
  hallCourts: "/media/hall-courts.jpg",
  hallVideo: "/media/hall.mp4",
  badminton: "/media/badminton-smash.jpg",
  badmintonCourt: "/media/badminton-court.jpg",
  badmintonAction: "/media/badminton-action.jpg",
  badmintonVideo: "/media/badminton.mp4",
  basketball: "/media/basketball-action.jpg",
  basketballCourt: "/media/basketball.jpg",
  volleyball: "/media/volleyball-action.jpg",
  volleyballCourt: "/media/volleyball.jpg",
  reception: "/media/reception.jpg",
  receptionStill: "/media/reception-still.jpg",
  receptionVideo: "/media/reception.mp4",
  exterior: "/media/exterior.jpg",
  courtDetail: "/media/court-detail.jpg",
  athlete: "/media/athlete.jpg",
  smash: "/media/smash.mp4",
  lounge: "/media/lounge.jpg",
  racket: "/media/racket.jpg",
  coachKhoa: "/media/coach-khoa.jpg",
  coachLan: "/media/coach-lan.jpg",
  coachAnh: "/media/coach-anh.jpg",
  coachViet: "/media/coach-viet.jpg",
  coachWhistle: "/media/coach-whistle.jpg",
  coachDrill: "/media/coach-drill.jpg",
  classGroup: "/media/class-group.jpg",
  trainProgress: "/media/train-progress.jpg",
  deskGate: "/media/desk-gate.jpg",
  memberCard: "/media/member-card.jpg",
  emptyCourt: "/media/empty-court.jpg",
  wellness: "/media/wellness.jpg",
} as const;

export function sportPhoto(sport: string): string {
  if (sport === "basketball") return media.basketball;
  if (sport === "volleyball") return media.volleyball;
  if (sport === "all") return media.hallCourts;
  return media.badminton;
}
