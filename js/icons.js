// أيقونات SVG بسماكة موحدة وأطراف دائرية. كل أيقونة لها لونها المميز (hue) داخل شارة دائرية.

const P = {
  check: '<path d="M6 12.5l4 4 8-9"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  tasks: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.7 2.7L16 9.5"/>',
  projects: '<path d="M3.5 8.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
  finance: '<circle cx="12" cy="12" r="9"/><path d="M14.6 9.4c-.5-.8-1.4-1.2-2.6-1.2-1.6 0-2.7.8-2.7 2 0 2.8 5.4 1.3 5.4 4 0 1.2-1.1 2-2.8 2-1.3 0-2.3-.5-2.9-1.3M12 6.5v1.7m0 7.6v1.7"/>',
  settings: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  chevL: '<path d="M15 6l-6 6 6 6"/>',
  chevR: '<path d="M9 6l6 6-6 6"/>',
  chevD: '<path d="M6 9l6 6 6-6"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  trash: '<path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12M10 11v5M14 11v5"/>',
  calendar: '<rect x="4" y="5.5" width="16" height="14" rx="3.5"/><path d="M4 10h16M8.5 3.5v3M15.5 3.5v3"/>',
  flag: '<path d="M6 20V5M6 5h10l-2 3.5 2 3.5H6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 2"/>',
  play: '<path d="M9.5 7.5l7 4.5-7 4.5z"/>',
  logout: '<path d="M10 5H7a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h3M14 8l4 4-4 4M18 12H9"/>',
  download: '<path d="M12 4v10M8 10.5l4 4 4-4M5 19h14"/>',
  upload: '<path d="M12 15V5M8 8.5l4-4 4 4M5 19h14"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.6 2.6 2.6 15.4 0 18M12 3c-2.6 2.6-2.6 15.4 0 18"/>',
  palette: '<path d="M12 3a9 9 0 1 0 0 18c1.2 0 1.8-.8 1.8-1.6 0-1.4-1-1.5-1-2.6 0-.9.7-1.5 1.6-1.5H17a4 4 0 0 0 4-4C21 6.7 17 3 12 3z"/><circle cx="7.5" cy="11" r=".8"/><circle cx="10" cy="7.5" r=".8"/><circle cx="15" cy="7.5" r=".8"/>',
  type: '<path d="M5 7V5h14v2M12 5v14M9 19h6"/>',
  user: '<circle cx="12" cy="9" r="3.5"/><path d="M5 20c.8-3.5 3.8-5.5 7-5.5s6.2 2 7 5.5"/>',
  cloud: '<path d="M7 18a4 4 0 0 1-.5-8A5.5 5.5 0 0 1 17 8.5 4.8 4.8 0 0 1 17 18z"/>',
  device: '<rect x="7" y="3.5" width="10" height="17" rx="3.5"/><path d="M11 17.5h2"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6L7 7M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/>',
  auto: '<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8v.01"/>',
  layers: '<path d="M12 4l8 4.5-8 4.5-8-4.5z"/><path d="M4 12.5l8 4.5 8-4.5"/>',
  mic: '<rect x="9" y="3.5" width="6" height="11" rx="3"/><path d="M6 11.5a6 6 0 0 0 12 0M12 17.5V20"/>',
  printer: '<path d="M7 8V3.5h10V8M7 17H4.5V9.5h15V17H17M7 14h10v6.5H7z"/><path d="M16.5 11.5h.01"/>',
  alert: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5M12 16v.01"/>',
};

// لون مميز لكل أيقونة (درجة اللون hue)
const HUE = {
  tasks: 215, projects: 35, finance: 150, settings: 268, palette: 330, type: 195,
  globe: 175, user: 250, cloud: 205, info: 220, layers: 300, mic: 355, download: 150,
  upload: 35, logout: 5, sun: 40, moon: 245, auto: 215, device: 215, calendar: 215,
  flag: 5, clock: 40, trash: 5, plus: 215, check: 150, play: 215, alert: 5,
};

export function icon(name, size = 22) {
  const body = P[name] || P.info;
  return `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

/** شارة أيقونة (دائرية افتراضيًا — الشكل يتحكم فيه إعداد "شكل الأيقونات") */
export function badge(name, size = 22, hue) {
  const h = hue ?? HUE[name] ?? 215;
  return `<span class="badge" style="--h:${h}">${icon(name, size)}</span>`;
}

export const hueOf = (name) => HUE[name] ?? 215;
