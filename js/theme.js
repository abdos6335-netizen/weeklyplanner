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
  almarai: { label: 'Almarai', family: 'Almarai', stack: '"Inter","Almarai"', gf: 'Almarai:wght@400;700;800' },
  cairo: { label: 'Cairo', family: 'Cairo', stack: '"Cairo"', gf: 'Cairo:wght@400;600;700' },
  tajawal: { label: 'Tajawal', family: 'Tajawal', stack: '"Tajawal"', gf: 'Tajawal:wght@400;500;700' },
  ibm: { label: 'IBM Plex Arabic', family: 'IBM Plex Sans Arabic', stack: '"IBM Plex Sans Arabic"', gf: 'IBM+Plex+Sans+Arabic:wght@400;500;600' },
  inter: { label: 'Inter', family: 'Inter', stack: '"Inter","Almarai"', gf: 'Inter:wght@400;500;600;700' },
  system: { label: 'System', family: 'system-ui', stack: 'system-ui', gf: null },
};

const loadedFonts = new Set(['almarai', 'inter']); // محمّلان من index.html
export function ensureFont(id) {
  const f = FONTS[id];
  if (!f || !f.gf || loadedFonts.has(id)) return;
  loadedFonts.add(id);
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${f.gf}&display=swap`;
  document.head.appendChild(link);
}

// ------------------------------------------------------------------ الثيمات الجاهزة
export const PRESETS = {
  quiet: { accent: '#1a73e8', bg: { light: null, dark: null }, sat: 100 },
  paper: { accent: '#6b5b45', bg: { light: '#f4efe6', dark: '#211e1a' }, sat: 85 },
  midnight: { accent: '#8ab4f8', bg: { light: '#eef1f8', dark: '#0f1320' }, sat: 100 },
  forest: { accent: '#1e8e5a', bg: { light: '#eef4ee', dark: '#14201a' }, sat: 100 },
  sand: { accent: '#c2762b', bg: { light: '#f7f0e4', dark: '#241c14' }, sat: 100 },
  rose: { accent: '#d6457a', bg: { light: '#faf0f3', dark: '#251820' }, sat: 100 },
  ocean: { accent: '#0891b2', bg: { light: '#eaf5f8', dark: '#0e1e24' }, sat: 100 },
};

export const DEFAULT_THEME = {
  mode: 'auto',            // auto | light | dark
  preset: 'quiet',
  accent: '#1a73e8',
  bg: { light: null, dark: null },
  text: { light: null, dark: null },
  sat: 100,                // 0..150
  surface: 'tint',         // tint (بلون مغاير) | same (بنفس لون الخلفية)
  glass: true,
  blur: 16,                // 0..32
  icons: 'circle',         // circle | squircle | plain
  font: 'almarai',
  scale: 100,              // 90..120
};

const DEFAULT_BG = { light: '#f6f4ef', dark: '#1c1d21' };

export function mergeTheme(saved) {
  const t = { ...DEFAULT_THEME, ...(saved || {}) };
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

  const f = FONTS[theme.font] || FONTS.almarai;

  const glow1 = `hsl(${ah} ${Math.round(70 * k)}% ${dark ? 32 : 78}% / ${dark ? 0.45 : 0.55})`;
  const glow2 = `hsl(${(ah + 55) % 360} ${Math.round(65 * k)}% ${dark ? 30 : 82}% / ${dark ? 0.35 : 0.45})`;

  return {
    dark,
    mode,
    vars: {
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
    },
  };
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
