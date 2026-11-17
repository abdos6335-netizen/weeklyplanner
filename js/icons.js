// WeeklyPlanner — أيقونات SVG خطية بأطراف دائرية (متناسقة مع لغة الحواف المدورة).
// الحالة العادية: خط 1.6 — الحالة النشطة (filled=true): خط 2.
const R = (d) => `<path d="${d}"/>`;
const C = (x, y, r, extra = '') => `<circle cx="${x}" cy="${y}" r="${r}" ${extra}/>`;
const RC = (x, y, w, h, rx) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}"/>`;
const DOT = (x, y) => `<circle cx="${x}" cy="${y}" r="1.1" fill="currentColor" stroke="none"/>`;
const FOLDER = 'M3.5 8.5A2.5 2.5 0 016 6h3.3l2 2.2H18a2.5 2.5 0 012.5 2.5v6.8A2.5 2.5 0 0118 20H6a2.5 2.5 0 01-2.5-2.5z';
const CHECKC = C(12, 12, 8.5) + R('M8.5 12.5l2.5 2.5 4.5-5');
const USER = C(12, 8.5, 3.5) + R('M5 19.5c.8-3.6 3.8-5.5 7-5.5s6.2 1.9 7 5.5');
const CAL = RC(3.5, 5, 17, 15.5, 3.5) + R('M8 3v4M16 3v4M3.5 10h17');

const PATHS = {
  check: R('M5 12.5l4.5 4.5L19 7.5'),
  plus: R('M12 5v14M5 12h14'),
  tasks: CHECKC,
  today: CHECKC,
  dashboard: RC(3.5, 3.5, 7, 7, 2.5) + RC(13.5, 3.5, 7, 7, 2.5) + RC(3.5, 13.5, 7, 7, 2.5) + RC(13.5, 13.5, 7, 7, 2.5),
  meetings: RC(3.5, 5, 17, 15.5, 3.5) + R('M8 3v4M16 3v4M3.5 10h17M9 15l2 2 4-4'),
  'calendar-check': RC(3.5, 5, 17, 15.5, 3.5) + R('M8 3v4M16 3v4M3.5 10h17M9 15l2 2 4-4'),
  calendar: CAL,
  projects: R(FOLDER),
  folder: R(FOLDER),
  folderOpen: R('M3.5 17.5V7.8A2.5 2.5 0 016 5.5h3.3l2 2.2H17a2.5 2.5 0 012.5 2.5V11M3.6 17.8l2-6.2a2 2 0 011.9-1.4H20a1.4 1.4 0 011.3 1.9l-1.7 4.9A2.5 2.5 0 0117.3 19H6.1a2.5 2.5 0 01-2.5-1.2z'),
  finance: RC(3.5, 6, 17, 13.5, 3.5) + R('M20.5 11.2h-3.8a1.9 1.9 0 000 3.8h3.8M7 6V5.3A1.8 1.8 0 018.8 3.5H16'),
  settings: R('M4 8h8M17 8h3M4 16h3M12 16h8') + C(14.5, 8, 2.3) + C(9.5, 16, 2.3),
  chevL: R('M14.5 6.5L9 12l5.5 5.5'),
  chevR: R('M9.5 6.5L15 12l-5.5 5.5'),
  chevD: R('M6.5 9.5L12 15l5.5-5.5'),
  close: R('M6.5 6.5l11 11M17.5 6.5l-11 11'),
  trash: R('M4.5 7h15M9.5 7V5.3a1.3 1.3 0 011.3-1.3h2.4a1.3 1.3 0 011.3 1.3V7M6.5 7l.8 11.3A2 2 0 009.3 20.2h5.4a2 2 0 002-1.9L17.5 7M10 11v5M14 11v5'),
  flag: R('M6 20.5V4.5M6 5h10.3a.8.8 0 01.7 1.2L15 9l2 2.8a.8.8 0 01-.7 1.2H6'),
  clock: C(12, 12, 8.5) + R('M12 7.5V12l3 2'),
  play: R('M8.5 6.8v10.4a.9.9 0 001.4.8l8-5.2a.9.9 0 000-1.5l-8-5.2a.9.9 0 00-1.4.7z'),
  logout: R('M13.5 4.5H17A2.5 2.5 0 0119.5 7v10a2.5 2.5 0 01-2.5 2.5h-3.5M9.5 8L5.5 12l4 4M5.5 12H15'),
  download: R('M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19.5h14'),
  upload: R('M12 15V4M7.5 8.5L12 4l4.5 4.5M5 19.5h14'),
  globe: C(12, 12, 8.5) + R('M3.5 12h17M12 3.5c2.4 2.3 3.6 5.1 3.6 8.5s-1.2 6.2-3.6 8.5c-2.4-2.3-3.6-5.1-3.6-8.5S9.6 5.8 12 3.5z'),
  palette: R('M12 3.5a8.5 8.5 0 100 17c1.3 0 2-.8 2-1.8 0-1.5-1.3-1.7-1.3-3 0-1 .8-1.7 1.9-1.7h1.9a3.5 3.5 0 003.5-3.5C20.5 6.9 16.7 3.5 12 3.5z') + DOT(7.8, 11.5) + DOT(10, 7.6) + DOT(14.4, 7.6),
  type: R('M5.5 7.5V5.5h13v2M12 5.5V19M9 19h6'),
  user: USER,
  userRound: USER,
  cloud: R('M7.5 18.5A4.5 4.5 0 016.7 9.6a5.6 5.6 0 0110.7-.6 4.8 4.8 0 01-.4 9.5z'),
  device: RC(7, 3, 10, 18, 3) + R('M11 17.8h2'),
  sun: C(12, 12, 3.8) + R('M12 3.5v1.8M12 18.7v1.8M3.5 12h1.8M18.7 12h1.8M6 6l1.3 1.3M16.7 16.7L18 18M18 6l-1.3 1.3M7.3 16.7L6 18'),
  moon: R('M19.5 14.2A8 8 0 019.8 4.5a8 8 0 109.7 9.7z'),
  auto: C(12, 12, 8.5) + '<path d="M12 3.5a8.5 8.5 0 010 17z" fill="currentColor"/>',
  info: C(12, 12, 8.5) + R('M12 11v5') + DOT(12, 8.2),
  layers: R('M12 4l8.5 4.3L12 12.6 3.5 8.3z M3.8 12.3L12 16.5l8.2-4.2M3.8 16.2L12 20.4l8.2-4.2'),
  mic: RC(9, 3.5, 6, 11, 3) + R('M5.5 11.5a6.5 6.5 0 0013 0M12 18v2.5'),
  printer: R('M7 9V5a1 1 0 011-1h8a1 1 0 011 1v4') + RC(3.5, 9, 17, 8, 3) + R('M7 14.5h10V19a1 1 0 01-1 1H8a1 1 0 01-1-1z'),
  alert: R('M10.6 5.3a1.6 1.6 0 012.8 0l6.6 11.4a1.6 1.6 0 01-1.4 2.3H5.4A1.6 1.6 0 014 16.7zM12 10v3.5') + DOT(12, 16.2),
  late: C(12, 12, 8.5) + R('M12 8v4.5') + DOT(12, 15.8),
  sparkles: R('M11 4.5l1.6 4.4 4.4 1.6-4.4 1.6L11 16.5l-1.6-4.4L5 10.5l4.4-1.6zM18.5 3.5v3M17 5h3M17.5 16.5v3M16 18h3'),
  move: R('M12 3.5v17M3.5 12h17M9.5 6L12 3.5 14.5 6M9.5 18l2.5 2.5 2.5-2.5M6 9.5L3.5 12 6 14.5M18 9.5l2.5 2.5-2.5 2.5'),
  feather: R('M19.5 4.5c-7 0-12 3.5-13 10.5L4.5 19.5M6.5 15h8M10 11h7'),
  'minus-circle': C(12, 12, 8.5) + R('M8.5 12h7'),
  more: DOT(5.5, 12).replace('1.1', '1.5') + DOT(12, 12).replace('1.1', '1.5') + DOT(18.5, 12).replace('1.1', '1.5'),
  search: C(11, 11, 6.5) + R('M20 20l-4.2-4.2'),
  wait: R('M7 3.5h10M7 20.5h10M7.5 3.5c0 4 4.5 5 4.5 8.5s-4.5 4.5-4.5 8.5M16.5 3.5c0 4-4.5 5-4.5 8.5s4.5 4.5 4.5 8.5'),
  review: R('M6.5 16.5V11a5.5 5.5 0 0111 0v5.5l1.4 2H5.1zM10 20.5a2 2 0 004 0'),
  recent: R('M4 12a8 8 0 108-8 8 8 0 00-5.7 2.4L4 9M4 4.5V9h4.5M12 8v4l2.5 1.5'),
  archive: RC(3.5, 4.5, 17, 4.5, 2) + R('M5 9v8.5A2.5 2.5 0 007.5 20h9a2.5 2.5 0 002.5-2.5V9M10 13h4'),
  sidebar: RC(3.5, 4.5, 17, 15, 4) + R('M9.5 4.5v15'),
  asterisk: R('M12 4.5v15M5.5 8.2l13 7.6M18.5 8.2l-13 7.6'),
  arrowUp: R('M12 19.5V5M6.5 10.5L12 5l5.5 5.5'),
  arrowR: R('M5 12h14M13.5 6.5L19 12l-5.5 5.5'),
};

function body(name) {
  return PATHS[name] || PATHS.info;
}

function svg(name, size, filled, cls) {
  const s = Number(size) || 22;
  const sw = filled ? 2 : 1.6;
  return `<svg class="${cls}" style="font-size:${s}px" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body(name)}</svg>`;
}

/** أيقونة بدون دائرة أو خلفية. */
export function icon(name, size = 22, filled = false) {
  return svg(name, size, filled, 'ic');
}

/** التوافق مع الاستدعاءات القديمة. */
export function badge(name, size = 22, _hue, filled = false) {
  return svg(name, size, filled, 'ic badge');
}

export const hueOf = () => 215;
