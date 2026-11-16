// محرك الثيم: يحسب كل ألوان التطبيق من بضعة اختيارات (خلفية، تمييز، خطوط، تشبع، نمط الأسطح)
// ويكتبها كمتغيرات CSS على <html>.

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));

export function hexToRgb(hex) {
  let h = hex.replace('#', '');
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const rgbToHex = (r, g, b) => '#' + [r, g, b].map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('');

export function hexToHsl(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return [h, s, l];
}

export function hslToHex(h, s, l) {
  h = ((h % 360) + 360) % 360;
  s = clamp(s); l = clamp(l);
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return rgbToHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
}

export function luminance(hex) {
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function mix(a, b, t) {
  const A = hexToRgb(a), B = hexToRgb(b);
  return rgbToHex(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t);
}

// ------------------------------------------------------------------ الخطوط
export const FONTS = {
  // الإنجليزي Inter (مطابق للتصميم المرجعي)، والعربي حسب الاختيار.
  ibm: { label: 'IBM Plex Sans Arabic', family: 'IBM Plex Sans Arabic', stack: '"Inter","IBM Plex Sans Arabic"', gf: 'IBM+Plex+Sans+Arabic:wght@400;500;600' },
  alexandria: { label: 'Alexandria', family: 'Alexandria', stack: '"Inter","Alexandria"', gf: 'Alexandria:wght@300;400;500;600' },
  readex: { label: 'Readex Pro', family: 'Readex Pro', stack: '"Inter","Readex Pro"', gf: 'Readex+Pro:wght@300;400;500;600' },
  noto: { label: 'Noto Sans Arabic', family: 'Noto Sans Arabic', stack: '"Inter","Noto Sans Arabic"', gf: 'Noto+Sans+Arabic:wght@300;400;500;600' },
  almarai: { label: 'Almarai', family: 'Almarai', stack: '"Inter","Almarai"', gf: 'Almarai:wght@300;400;700' },
  cairo: { label: 'Cairo', family: 'Cairo', stack: '"Inter","Cairo"', gf: 'Cairo:wght@300;400;500;600' },
  tajawal: { label: 'Tajawal', family: 'Tajawal', stack: '"Inter","Tajawal"', gf: 'Tajawal:wght@300;400;500;700' },
  system: { label: 'System', family: 'system-ui', stack: '"Inter",system-ui', gf: null },
};
// أسماء قديمة محفوظة عند المستخدمين
const FONT_ALIASES = { editorial: 'ibm', inter: 'ibm' };
export const fontKey = (id) => FONTS[id] ? id : (FONT_ALIASES[id] || 'ibm');

const loadedFonts = new Set(['ibm']); // IBM Plex Sans Arabic وInter محمّلان من index.html
export function ensureFont(id) {
  const f = FONTS[fontKey(id)];
  if (!f || !f.gf || loadedFonts.has(id)) return;
  loadedFonts.add(id);
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${f.gf}&display=swap`;
  document.head.appendChild(link);
}

// ------------------------------------------------------------------ الثيمات الجاهزة
export const PRESETS = {
  // الثيمات الجديدة (v6): ألوان هادئة بدرجات رمادية دافئة/باردة، كلها لها نسخة فاتحة وداكنة
  // glass: ثيم مطابق للتصميم المرجعي (زجاجي مضيء، شريط فحمي، ظلال ناعمة، تظليل أخضر باهت للنشط)
  glass: { accent: '#302e32', bg: { light: '#e3e3e4', dark: '#1b1b1d' }, sat: 100 },
  soft: { accent: '#2c2c30', bg: { light: '#e8e8ea', dark: '#19191b' }, sat: 100 },
  sage: { accent: '#3f5a4a', bg: { light: '#dfe6df', dark: '#161c18' }, sat: 100 },
  sand: { accent: '#6b5a43', bg: { light: '#ebe4d8', dark: '#1d1a15' }, sat: 100 },
  slate: { accent: '#38465c', bg: { light: '#dde2ea', dark: '#15181e' }, sat: 100 },
  rose: { accent: '#7a3b4f', bg: { light: '#ede2e5', dark: '#1c1518' }, sat: 100 },
  ocean: { accent: '#1f5f73', bg: { light: '#dbe8ec', dark: '#121b1e' }, sat: 100 },
  // قديمة (محفوظة عند مستخدمين سابقين)
  monochrome: { accent: '#5b5b60', bg: { light: '#f4f4f5', dark: '#171719' }, sat: 0 },
  quiet: { accent: '#1a73e8', bg: { light: null, dark: null }, sat: 100 },
  paper: { accent: '#6b5b45', bg: { light: '#f4efe6', dark: '#211e1a' }, sat: 85 },
  midnight: { accent: '#8ab4f8', bg: { light: '#eef1f8', dark: '#0f1320' }, sat: 100 },
  forest: { accent: '#1e8e5a', bg: { light: '#eef4ee', dark: '#14201a' }, sat: 100 },
};

export const DEFAULT_THEME = {
  v: 7,                    // إصدار نظام التصميم (الأقدم يُعاد لافتراضيات v6 مع الاحتفاظ بالمود والتكبير)
  mode: 'auto',            // auto | light | dark
  preset: 'glass',
  accent: '#302e32',
  bg: { light: '#e3e3e4', dark: '#1b1b1d' },
  text: { light: null, dark: null },
  sat: 100,                // 0..150
  surface: 'tint',         // tint (بلون مغاير) | same (بنفس لون الخلفية)
  glass: true,
  blur: 16,                // 0..32
  icons: 'plain',          // Phosphor icons بدون خلفية أو إطار
  font: 'ibm',
  scale: 100,              // 90..120
};

const DEFAULT_BG = { light: '#f6f4ef', dark: '#1c1d21' };

export function mergeTheme(input) {
  let saved = input;
  if (saved && saved.v !== 7) {
    saved = {};
    for (const k of ['mode', 'scale', 'font']) if (input[k] !== undefined) saved[k] = input[k];
  }
  const t = { ...DEFAULT_THEME, ...(saved || {}), v: 7 };
  t.bg = { ...DEFAULT_THEME.bg, ...((saved && saved.bg) || {}) };
  t.text = { ...DEFAULT_THEME.text, ...((saved && saved.text) || {}) };
  return t;
}

export function effectiveMode(theme) {
  if (theme.mode === 'light' || theme.mode === 'dark') return theme.mode;
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** الألوان الفعلية المعروضة لمنتقيات الألوان في الإعدادات */
export function shownColors(theme) {
  const mode = effectiveMode(theme);
  const bg = theme.bg[mode] || DEFAULT_BG[mode];
  const dark = luminance(bg) < 0.4;
  const [bh, bs] = hexToHsl(bg);
  const autoText = dark ? hslToHex(bh, clamp(bs * 0.25), 0.93) : hslToHex(bh, clamp(bs * 0.6, 0, 0.35), 0.11);
  return { mode, bg, text: theme.text[mode] || autoText, accent: theme.accent };
}


// أسطح ثيم glass المطابق للمرجع (قيم مُقدّرة من الصورة بعد إزالة طبقة التعتيم الرمادية عنها)
const GLASS = {
  light: {
    '--bg': '#e3e3e4', '--page-bg': 'linear-gradient(180deg,#e7e7e8 0%,#dcdcdd 60%,#d2d2d4 100%)',
    '--sidebar': '#ececed', '--panel': '#ebebec', '--surface': '#f0f1f0', '--surface-2': '#e4e5e4',
    '--text': '#161618', '--text-2': '#86868b', '--line': 'rgba(0,0,0,.085)',
    '--rail': '#2e2c30', '--rail-ink': '#ffffff', '--rail-dim': 'rgba(255,255,255,.66)', '--rail-on': 'linear-gradient(180deg,#5a595d,#48474b)',
    '--rail-shell': '#ececed',
    '--item-on': 'linear-gradient(90deg,#fcfefd 0%,#f1f6f3 100%)',
    '--item-on-line': 'rgba(255,255,255,.95)',
    '--badge': 'rgba(0,0,0,.055)', '--badge-ink': '#8b8b90', '--badge-on': '#ffffff', '--badge-on-ink': '#6e6e73',
    '--search': '#e2e2e3', '--tree-sel': '#dededf', '--tree-line': 'rgba(255,255,255,.7)',
    '--card': 'linear-gradient(135deg,#f5f7f6 0%,#eaedeb 100%)', '--rim': 'rgba(255,255,255,.9)',
    '--good': '#1f9c70', '--good-soft': 'rgba(52,190,140,.17)',
    '--raise': '0 1px 0 rgba(255,255,255,.95) inset, 0 12px 28px -12px rgba(20,20,26,.25), 0 2px 5px rgba(20,20,26,.08)',
    '--inset': 'inset 0 2px 5px rgba(20,20,26,.11), 0 1px 0 rgba(255,255,255,.85)',
    '--shell-shadow': '0 18px 40px -16px rgba(20,20,26,.32), 0 1px 0 rgba(255,255,255,.9) inset',
  },
  dark: {
    '--bg': '#1b1b1d', '--page-bg': 'linear-gradient(180deg,#202022 0%,#18181a 100%)',
    '--sidebar': '#262628', '--panel': '#232325', '--surface': '#2a2a2d', '--surface-2': '#303033',
    '--text': '#f2f2f4', '--text-2': '#9a9aa0', '--line': 'rgba(255,255,255,.08)',
    '--rail': '#0f0f11', '--rail-ink': '#ffffff', '--rail-dim': 'rgba(255,255,255,.6)', '--rail-on': 'linear-gradient(180deg,#3d3d41,#2f2f33)',
    '--rail-shell': '#262628',
    '--item-on': 'linear-gradient(90deg,rgba(255,255,255,.10),rgba(255,255,255,.055))',
    '--item-on-line': 'rgba(255,255,255,.12)',
    '--badge': 'rgba(255,255,255,.07)', '--badge-ink': '#a0a0a6', '--badge-on': 'rgba(255,255,255,.14)', '--badge-on-ink': '#d8d8dc',
    '--search': '#1e1e20', '--tree-sel': '#303033', '--tree-line': 'rgba(255,255,255,.06)',
    '--card': 'linear-gradient(135deg,#2e2f30 0%,#272829 100%)', '--rim': 'rgba(255,255,255,.12)',
    '--good': '#5fd3a0', '--good-soft': 'rgba(95,211,160,.16)',
    '--raise': '0 1px 0 rgba(255,255,255,.07) inset, 0 14px 30px -12px rgba(0,0,0,.65), 0 2px 5px rgba(0,0,0,.4)',
    '--inset': 'inset 0 2px 6px rgba(0,0,0,.5), 0 1px 0 rgba(255,255,255,.05)',
    '--shell-shadow': '0 18px 40px -16px rgba(0,0,0,.7), 0 1px 0 rgba(255,255,255,.06) inset',
  },
};

// ------------------------------------------------------------------ البناء
export function buildVars(theme) {
  const mode = effectiveMode(theme);
  const k = clamp(theme.sat, 0, 150) / 100;
  const satHex = (hex) => { const [h, s, l] = hexToHsl(hex); return hslToHex(h, clamp(s * k), l); };

  const bg = satHex(theme.bg[mode] || DEFAULT_BG[mode]);
  const dark = luminance(bg) < 0.4;
  const [bh, bs, bl] = hexToHsl(bg);
  const accent = satHex(theme.accent);
  const [ah] = hexToHsl(accent);

  const text = theme.text[mode] || (dark
    ? hslToHex(bh, clamp(bs * 0.25), 0.93)
    : hslToHex(bh, clamp(bs * 0.6, 0, 0.35), 0.11));
  const text2 = mix(text, bg, dark ? 0.38 : 0.45);

  let surface, surface2;
  if (theme.surface === 'same') {
    surface = hslToHex(bh, bs, clamp(bl + (dark ? 0.03 : 0.025)));
    surface2 = hslToHex(bh, bs, clamp(bl + (dark ? 0.08 : -0.04)));
  } else {
    surface = mix(hslToHex(bh, bs, clamp(bl + (dark ? 0.04 : 0.035))), accent, dark ? 0.09 : 0.06);
    surface2 = mix(hslToHex(bh, bs, clamp(bl + (dark ? 0.09 : -0.02))), accent, dark ? 0.16 : 0.11);
  }

  const onAccent = luminance(accent) > 0.45 ? '#14161a' : '#ffffff';
  const accentText = dark ? mix(accent, '#ffffff', 0.25) : mix(accent, '#000000', 0.12);
  const accentSoft = mix(bg, accent, dark ? 0.22 : 0.14);

  const primary = theme.surface === 'same' ? accentSoft : accent;
  const primaryText = theme.surface === 'same' ? accentText : onAccent;

  const f = FONTS[fontKey(theme.font)];

  // أسطح التصميم الجديد: لوحات مرفوعة وغائرة + شريط داكن للأيقونات
  const tone = (l, sk = 1) => hslToHex(bh, clamp(bs * sk), clamp(l));
  const sidebar = dark ? tone(bl + 0.045) : tone(bl + 0.04);
  const panel = dark ? tone(bl + 0.028) : tone(bl + 0.022);
  const rail = dark ? hslToHex(bh, clamp(bs * 0.5, 0, 0.2), 0.2) : hslToHex(bh, clamp(bs * 0.6, 0, 0.18), 0.15);
  const raise = dark
    ? '0 1px 0 rgba(255,255,255,.06) inset, 0 10px 24px -8px rgba(0,0,0,.6), 0 1px 2px rgba(0,0,0,.4)'
    : '0 1px 0 rgba(255,255,255,.75) inset, 0 8px 20px -6px rgba(24,24,32,.17), 0 1px 3px rgba(24,24,32,.10)';
  const inset = dark
    ? 'inset 0 2px 6px rgba(0,0,0,.45), inset 0 -1px 0 rgba(255,255,255,.04)'
    : 'inset 0 2px 5px rgba(24,24,32,.10), inset 0 -1px 0 rgba(255,255,255,.65)';
  const good = dark ? '#5fd3a0' : '#23895f';
  const goodSoft = dark ? 'rgba(95,211,160,.16)' : 'rgba(47,158,114,.16)';

  const glow1 = `hsl(${ah} ${Math.round(70 * k)}% ${dark ? 32 : 78}% / ${dark ? 0.45 : 0.55})`;
  const glow2 = `hsl(${(ah + 55) % 360} ${Math.round(65 * k)}% ${dark ? 30 : 82}% / ${dark ? 0.35 : 0.45})`;

  const generic = {
    '--page-bg': `linear-gradient(165deg, ${bg}, ${mix(bg, dark ? '#000000' : '#000000', 0.08)})`,
    '--rail-shell': sidebar,
    '--item-on': dark ? `linear-gradient(90deg, ${mix(sidebar, '#ffffff', 0.1)}, ${mix(sidebar, '#ffffff', 0.05)})` : `linear-gradient(90deg, ${mix(sidebar, '#ffffff', 0.7)}, ${mix(sidebar, '#ffffff', 0.45)})`,
    '--item-on-line': dark ? 'rgba(255,255,255,.12)' : 'rgba(255,255,255,.9)',
    '--badge': dark ? 'rgba(255,255,255,.07)' : 'rgba(0,0,0,.055)', '--badge-ink': text2, '--badge-on': dark ? 'rgba(255,255,255,.14)' : '#ffffff', '--badge-on-ink': text2,
    '--search': mix(sidebar, dark ? '#000000' : '#000000', dark ? 0.2 : 0.045),
    '--tree-sel': mix(sidebar, dark ? '#ffffff' : '#000000', dark ? 0.1 : 0.06), '--tree-line': dark ? 'rgba(255,255,255,.06)' : 'rgba(255,255,255,.7)',
    '--card': sidebar, '--rim': dark ? 'rgba(255,255,255,.12)' : 'rgba(255,255,255,.9)',
    '--shell-shadow': raise,
  };
  const glassSet = theme.preset === 'glass' ? GLASS[dark ? 'dark' : 'light'] : null;
  const out = {
      '--bg': bg,
      '--surface': surface,
      '--surface-2': surface2,
      '--text': text,
      '--text-2': text2,
      '--accent': accent,
      '--accent-text': accentText,
      '--accent-soft': accentSoft,
      '--on-accent': onAccent,
      '--primary': primary,
      '--primary-text': primaryText,
      '--btn': theme.surface === 'same' ? surface2 : surface,
      '--btn-ring': mix(bg, text, dark ? 0.22 : 0.16),
      '--glow-1': glow1,
      '--glow-2': glow2,
      '--blur': theme.glass ? `${clamp(theme.blur, 0, 32)}px` : '0px',
      '--surface-pct': theme.glass ? '66%' : '100%',
      '--satk': String(k),
      '--ic-l': dark ? '72%' : '38%',
      '--icon-radius': theme.icons === 'squircle' ? '30%' : '50%',
      '--icon-bg-a': theme.icons === 'plain' ? '0' : (dark ? '0.2' : '0.14'),
      '--scale': String(clamp(theme.scale, 90, 120) / 100),
      '--font': `${f.stack}, system-ui, sans-serif`,
      '--sidebar': sidebar,
      '--panel': panel,
      '--rail': rail,
      '--rail-ink': '#f3f3f5',
      '--rail-dim': 'rgba(255,255,255,.58)',
      '--rail-on': 'rgba(255,255,255,.15)',
      '--raise': raise,
      '--inset': inset,
      '--good': good,
      '--good-soft': goodSoft,
      '--line': mix(bg, text, dark ? 0.14 : 0.12),
  };
  return { dark, mode, vars: { ...out, ...generic, ...(glassSet || {}) } };
}

export function applyTheme(rawTheme) {
  const theme = mergeTheme(rawTheme);
  ensureFont(theme.font);
  const { vars, dark } = buildVars(theme);
  const root = document.documentElement;
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  root.dataset.dark = dark ? '1' : '0';
  root.dataset.glass = theme.glass ? '1' : '0';
  root.dataset.icons = theme.icons;
  root.style.colorScheme = dark ? 'dark' : 'light';
  let meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) { meta = document.createElement('meta'); meta.name = 'theme-color'; document.head.appendChild(meta); }
  meta.content = vars['--bg'];
  return theme;
}

export function watchSystemMode(cb) {
  if (!window.matchMedia) return;
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', cb);
}
