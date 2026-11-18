import { describe, test, expect } from 'vitest'
import { logMeasurement, measurementReadings } from './measurement-write.js'

const T0 = Date.UTC(2026, 10, 18, 9)

describe('logMeasurement', () => {
  test('a new day in canonical units, switched-off fields switched on', () => {
    const S = { unit: 'kg', measurements: [], measurementEnabled: ['waist'] }
    const r = logMeasurement(S, { date: '2026-11-16', values: { waist: 37, upperArmRight: 13.5, bpSys: 128, bpDia: 82 }, length_unit: 'in', note: 'morning' }, { today: '2026-11-18', now: T0 })
    expect(r.problems).toBeUndefined()
    expect(S.measurements).toHaveLength(1)
    expect(S.measurements[0]).toMatchObject({ d: '2026-11-16', t: T0, waist: 94, upperArmRight: 34.3, bpSys: 128, bpDia: 82, note: 'morning' })
    expect(S.measurementEnabled).toEqual(['waist', 'upperArmRight', 'bpSys', 'bpDia'])
    expect(r.switched_on).toEqual(['upperArmRight', 'bpSys', 'bpDia'])
  })
  test('a second reading on a day keeps the day\'s other fields', () => {
    const S = { measurements: [{ d: '2026-11-16', t: 1, waist: 94, hips: 104 }] }
    logMeasurement(S, { date: '2026-11-16', values: { waist: 93.5 } }, { now: T0 })
    expect(S.measurements).toHaveLength(1)
    expect(S.measurements[0]).toMatchObject({ waist: 93.5, hips: 104, t: T0 })
  })
  test('days stay in date order', () => {
    const S = { measurements: [{ d: '2026-11-20', t: 1, waist: 92 }] }
    logMeasurement(S, { date: '2026-11-13', values: { waist: 95 } }, { now: T0 })
    expect(S.measurements.map(e => e.d)).toEqual(['2026-11-13', '2026-11-20'])
  })
  test('every problem at once, and nothing changed', () => {
    const S = { measurements: [] }
    const r = logMeasurement(S, { date: '2026-12-01', values: { belly: 90, waist: -1, bpSys: 400, bodyFat: 120 } }, { today: '2026-11-18' })
    expect(r.problems.map(p => p.field)).toEqual(['date', 'values.belly', 'values.waist', 'values.bpSys', 'values.bodyFat'])
    expect(S.measurements).toEqual([])
    expect(logMeasurement(S, { date: '2026-11-18', values: {} }).problems[0].field).toBe('values')
  })
})

describe('measurementReadings', () => {
  const S = { unit: 'kg', measurements: [
    { d: '2026-10-05', t: 1, waist: 96, note: 'start' },
    { d: '2026-11-02', t: 2, waist: 94.5, upperArmRight: 34 },
    { d: '2026-11-16', t: 3, waist: 93.4 },
  ] }
  test('the fields with readings, first, latest and the change', () => {
    const r = measurementReadings(S, { now: T0 })
    expect(r.length_unit).toBe('cm')
    expect(r.fields.map(f => f.key)).toEqual(['waist', 'upperArmRight'])
    expect(r.fields[0]).toMatchObject({ unit: 'cm', first: { date: '2026-10-05', value: 96 }, latest: { date: '2026-11-16', value: 93.4 }, change: -2.6 })
    expect(r.fields[1].change).toBeNull()
    expect(r.notes).toEqual([{ date: '2026-10-05', note: 'start' }])
  })
  test('a window of days, and inches for a profile that measures in them', () => {
    const r = measurementReadings({ ...S, measureUnit: 'in' }, { days: 21, keys: ['waist'], now: T0 })
    expect(r.fields[0].readings.map(p => p.date)).toEqual(['2026-11-02', '2026-11-16'])
    expect(r.fields[0].unit).toBe('in')
    expect(r.fields[0].latest.value).toBe(36.8)
  })
})
