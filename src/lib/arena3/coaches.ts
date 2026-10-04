import { media } from "./media";

export type CoachCard = {
  name: string;
  sport: string;
  title: string;
  blurb: string;
  creds: string[];
  photo: string;
};

/** Presentation copy for the seeded coaches — not a new table. */
export const COACHES: CoachCard[] = [
  {
    name: "Nguyễn Minh Khoa",
    sport: "badminton",
    title: "Head badminton coach",
    blurb:
      "Runs the beginner and advanced ladders. Footwork first, controlled smashes second — no shoulders burned out in week one.",
    creds: ["Beginner Mon/Wed/Fri 18:00", "Advanced Sat 08:00", "Courts CL-01 · CL-05"],
    photo: media.coachKhoa,
  },
  {
    name: "Trần Thị Lan",
    sport: "badminton",
    title: "Intermediate badminton coach",
    blurb:
      "Assists the beginner ladder, owns intermediate. Patient with players moving from casual rallies to a real training plan.",
    creds: ["Intermediate Tue/Thu 19:00", "Beginner assistant", "Court CL-03"],
    photo: media.coachLan,
  },
  {
    name: "Phạm Đức Anh",
    sport: "basketball",
    title: "Head basketball coach",
    blurb:
      "Beginner program on BR-01: footwork, release, reading the floor. Classes never sit on a sold slot.",
    creds: ["Beginner Mon/Wed 17:00", "Court BR-01", "Vertical · coordination"],
    photo: media.coachAnh,
  },
  {
    name: "Lê Quốc Việt",
    sport: "volleyball",
    title: "Head volleyball coach",
    blurb:
      "Intermediate on BC-01. Digs, serves and team reading — built for players moving off the sand into a structured side.",
    creds: ["Intermediate Sat 16:00", "Court BC-01", "Rotations · reflexes"],
    photo: media.coachViet,
  },
];
