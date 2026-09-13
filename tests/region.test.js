import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appointmentToUtc, hospitalToday, currency } from '../public/region.js';
test('Kenya appointments use EAT regardless of workstation timezone',()=>{
  assert.equal(appointmentToUtc('2026-09-14T09:30'),'2026-09-14T06:30:00.000Z');
  assert.equal(appointmentToUtc('2026-09-14T01:00'),'2026-09-13T22:00:00.000Z');
  assert.throws(()=>appointmentToUtc('2026-02-30T09:00'));
  assert.throws(()=>appointmentToUtc('2026-09-14T25:00'));
});
test('Kenya calendar date crosses midnight at UTC 21:00 and default currency is KES',()=>{
  assert.equal(hospitalToday(new Date('2026-09-13T21:30:00Z')),'2026-09-14');
  assert.equal(hospitalToday(new Date('2026-09-13T20:30:00Z')),'2026-09-13');
  assert.equal(currency,'KES');
});
