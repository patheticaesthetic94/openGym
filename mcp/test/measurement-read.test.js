import { describe, test, expect } from 'vitest'
import { _seedStateForTests } from '../src/state.js'
import { getMeasurements } from '../src/measurement-tools.js'

describe('get_measurements', () => {
  test('the fields with readings, their change and the notes', () => {
    _seedStateForTests({ unit: 'kg', measurements: [
      { d: '2026-10-05', t: 1, waist: 96, note: 'start' },
      { d: '2026-11-16', t: 2, waist: 93.4, bpSys: 128, bpDia: 82 },
    ] })
    const r = getMeasurements.handler({})
    expect(r.fields.map(f => f.key)).toEqual(['waist', 'bpSys', 'bpDia'])
    expect(r.fields[0]).toMatchObject({ unit: 'cm', change: -2.6 })
    expect(r.fields[1].unit).toBe('mmHg')
    expect(r.notes).toEqual([{ date: '2026-10-05', note: 'start' }])
  })
})
