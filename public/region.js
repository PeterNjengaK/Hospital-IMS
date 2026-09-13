export const locale = 'en-KE';
export const timeZone = 'Africa/Nairobi';
export const currency = 'KES';
export function hospitalToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year:'numeric', month:'2-digit', day:'2-digit' }).formatToParts(now);
  const get = type => parts.find(p => p.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
export function appointmentToUtc(value) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw Error('Enter a valid appointment time in EAT.');
  // Kenya uses UTC+03:00 without seasonal clock changes.
  const result = new Date(`${value}:00+03:00`);
  if (!Number.isFinite(result.getTime()) || new Date(result.getTime()+10800000).toISOString().slice(0,16) !== value) throw Error('Enter a valid appointment time in EAT.');
  return result.toISOString();
}
