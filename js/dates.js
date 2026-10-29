// أدوات التواريخ — كل التواريخ تُخزَّن كنص "YYYY-MM-DD" بالتوقيت المحلي للجهاز.

export const pad = (n) => String(n).padStart(2, '0');

export const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export const parse = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};

export const addDays = (s, n) => {
  const d = parse(s);
  d.setDate(d.getDate() + n);
  return iso(d);
};

export const todayISO = () => iso(new Date());

/** بداية الأسبوع (startDay: 0=الأحد ... 6=السبت) للتاريخ s */
export function weekStartOf(s, startDay) {
  const d = parse(s);
  const diff = (d.getDay() - startDay + 7) % 7;
  d.setDate(d.getDate() - diff);
  return iso(d);
}

export const weekDays = (ws) => Array.from({ length: 7 }, (_, i) => addDays(ws, i));

export function fmt(s, locale, opts) {
  return new Intl.DateTimeFormat(locale, opts).format(parse(s));
}

export function isValidISO(s) {
  // نتحقق بالرجوع للنص نفسه حتى نرفض تواريخ مثل 2099-99-99 التي يقبلها Date بالتقريب
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && iso(parse(s)) === s;
}
