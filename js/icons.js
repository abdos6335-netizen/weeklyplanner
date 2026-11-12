// WeeklyPlanner — Phosphor Icons: Light (خط رفيع) للحالة العادية وRegular للحالة النشطة.
const PHOSPHOR = {
  check: 'check', plus: 'plus', tasks: 'check-square-offset',
  dashboard: 'squares-four', meetings: 'calendar-check',
  projects: 'folder-simple', finance: 'wallet', settings: 'sliders-horizontal',
  chevL: 'caret-left', chevR: 'caret-right', chevD: 'caret-down',
  close: 'x', trash: 'trash', calendar: 'calendar-blank',
  flag: 'flag', clock: 'clock', play: 'play', logout: 'sign-out',
  download: 'download-simple', upload: 'upload-simple', globe: 'globe',
  palette: 'palette', type: 'text-t', user: 'user-circle',
  cloud: 'cloud', device: 'device-mobile', sun: 'sun', moon: 'moon',
  auto: 'circle-half', info: 'info', layers: 'stack',
  mic: 'microphone', printer: 'printer', alert: 'warning',
  sparkles: 'sparkle', move: 'arrows-out-cardinal', feather: 'feather',
  'minus-circle': 'minus-circle', more: 'dots-three', today: 'check-circle',
  search: 'magnifying-glass', folder: 'folder', folderOpen: 'folder-open', late: 'warning-circle', wait: 'hourglass-medium', review: 'bell-simple',
  recent: 'clock-counter-clockwise', archive: 'archive', sidebar: 'sidebar-simple', asterisk: 'asterisk-simple', arrowUp: 'arrow-up', arrowR: 'arrow-right', userRound: 'user-circle',
};

function phosphorName(name) {
  return PHOSPHOR[name] || PHOSPHOR.info;
}

/** أيقونة Phosphor بدون دائرة أو خلفية. */
export function icon(name, size = 22, filled = false) {
  const weight = filled ? 'ph' : 'ph-light';
  return `<i class="${weight} ph-${phosphorName(name)} ic" style="font-size:${Number(size) || 22}px" aria-hidden="true"></i>`;
}

/** التوافق مع الاستدعاءات القديمة: badge أصبحت أيقونة مستقلة بلا شارة دائرية. */
export function badge(name, size = 22, _hue, filled = false) {
  const weight = filled ? 'ph' : 'ph-light';
  return `<i class="${weight} ph-${phosphorName(name)} ic badge" style="font-size:${Number(size) || 22}px" aria-hidden="true"></i>`;
}

export const hueOf = () => 215;
