// The fork's coaching additions through the server: a routine written with rep ranges, progression
// rules, increments and supersets, and a body-measurement check-in. Same stand-in api as
// write-tools.test.js; the rules themselves are tested in frontend/src/lib/routine-write.test.js
// and measurement-write.test.js.
import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import http from 'node:http'
import { createRoutineTool, updateRoutineTool } from '../src/routine-tools.js'
import { logMeasurementTool } from '../src/measurement-tools.js'
import { _resetWriteWindow } from '../src/write-tools.js'
import { toolAllowed } from '../src/server.js'

const TOKEN = 'tok.secret-value'
let api
function stubApi(doc) {
  const s = { doc: structuredClone(doc), rev: 3, puts: [] }
  const server = http.createServer(async (req, res) => {
    const send = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)) }
    if (req.headers.authorization !== 'Bearer ' + TOKEN) return send(401, { error: 'not signed in' })
    if (req.url === '/api/me') return send(200, { user: { id: 'u1', name: 'Sam' } })
    if (req.url === '/api/data' && req.method === 'GET') return send(200, { state: s.doc, rev: s.rev })
    if (req.url === '/api/data' && req.method === 'PUT') {
      let raw = ''
      for await (const c of req) raw += c
      const body = JSON.parse(raw)
      s.puts.push(body)
      if (body.baseRev !== s.rev) return send(409, { error: 'conflict', rev: s.rev, state: s.doc })
      s.doc = body.state
      s.rev++
      return send(200, { ok: true, rev: s.rev })
    }
    send(404, { error: 'not found' })
  })
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => {
    s.server = server
    s.env = { OPENGYM_URL: `http://127.0.0.1:${server.address().port}`, OPENGYM_TOKEN: TOKEN }
    resolve(s)
  }))
}
afterEach(() => api?.server.close())
beforeEach(() => _resetWriteWindow())

const DOC = () => ({ unit: 'kg', workouts: [], routines: [], customEx: [], exWeights: {}, measurements: [], _wid: 'w-abc', _ts: 1 })

describe('a coached routine', () => {
  beforeEach(async () => { api = await stubApi(DOC()) })

  test('rep range, rule, step and a named superset land in the plan', async () => {
    const r = await createRoutineTool.handler({ name: 'Session A', progression: 'double', weekdays: ['wednesday'], exercises: [
      { exercise: 'squat', sets: 3, reps: 12, reps_min: 8, weight: 30, increment: 2.5 },
      { exercise: 'dumbbell curl', reps: 15, reps_min: 10, superset: 'Arm pair', superset_rest_sec: 75 },
      { exercise: 'bench press', reps: 15, reps_min: 10, superset: 'Arm pair' },
    ] }, { env: api.env })
    expect(r.saved).toBe(true)
    const saved = api.doc.routines[0]
    expect(saved.prog).toBe('double')
    expect(saved.ex[0]).toMatchObject({ reps: 12, repsMin: 8, inc: 2.5, weight: 30 })
    expect(saved.ex[1].sg).toBe(saved.ex[2].sg)
    expect(saved.ex[1]).toMatchObject({ sgName: 'Arm pair', sgRest: 75 })
    expect(api.doc.week[3]).toEqual([saved.id])
    // The answer reads back the way get_routine does.
    expect(r.routine.exercises[0]).toMatchObject({ reps: 12, reps_min: 8, increment: 2.5, policy: 'double' })
    expect(r.routine.exercises[1]).toMatchObject({ superset_name: 'Arm pair', superset_rest_sec: 75 })
  })

  test('an edit that only changes the routine\'s rule is a change', async () => {
    const made = await createRoutineTool.handler({ name: 'B', exercises: [{ exercise: 'squat' }] }, { env: api.env })
    const r = await updateRoutineTool.handler({ routine_id: api.doc.routines[0].id, progression: 'steady' }, { env: api.env })
    expect(made.saved && r.saved).toBe(true)
    expect(api.doc.routines[0].prog).toBe('steady')
  })

  test('a problem saves nothing', async () => {
    const r = await createRoutineTool.handler({ name: 'C', exercises: [{ exercise: 'squat', reps: 8, reps_min: 10 }] }, { env: api.env })
    expect(r.saved).toBe(false)
    expect(r.problems[0].field).toBe('exercises[0].reps_min')
    expect(api.puts).toHaveLength(0)
  })
})

describe('log_measurement', () => {
  beforeEach(async () => { api = await stubApi({ ...DOC(), measurements: [{ d: '2026-11-02', t: 1, waist: 95, hips: 104 }], measurementEnabled: ['waist', 'hips'] }) })

  test('a check-in merges into its day and switches its fields on', async () => {
    const r = await logMeasurementTool.handler({ date: '2026-11-02', values: { waist: 94.2, upperArmRight: 34 } }, { env: api.env })
    expect(r.saved).toBe(true)
    expect(r.switched_on).toEqual(['upperArmRight'])
    expect(api.doc.measurements).toHaveLength(1)
    expect(api.doc.measurements[0]).toMatchObject({ waist: 94.2, hips: 104, upperArmRight: 34 })
    expect(api.doc.measurementEnabled).toContain('upperArmRight')
    expect(r.readings.find(f => f.key === 'waist').latest).toEqual({ date: '2026-11-02', value: 94.2 })
  })

  test('dry run shows it and saves nothing', async () => {
    const r = await logMeasurementTool.handler({ values: { waist: 93 }, dry_run: true }, { env: api.env })
    expect(r).toMatchObject({ saved: false, dry_run: true })
    expect(api.puts).toHaveLength(0)
  })

  test('a reading from the future is refused', async () => {
    const r = await logMeasurementTool.handler({ date: '2999-01-01', values: { waist: 93 } }, { env: api.env })
    expect(r.saved).toBe(false)
    expect(r.problems[0].field).toBe('date')
  })
})

describe('scopes', () => {
  test('measurements need their own category', () => {
    expect(toolAllowed('get_measurements', { measurements: 'view' })).toBe(true)
    expect(toolAllowed('log_measurement', { measurements: 'view' })).toBe(false)
    expect(toolAllowed('log_measurement', { measurements: 'apply' })).toBe(true)
    expect(toolAllowed('get_measurements', { workouts: 'apply' })).toBe(false)
  })
})
