import { describe, test, expect } from 'vitest'
import { createRoutine, updateRoutine, removeRoutine, weekdaysOf, routineWeekdays } from './routine-write.js'

const base = () => ({
  unit: 'kg',
  routines: [{ id: 'r1', name: 'Push', emoji: 'figureStrength', ex: [
    { id: '0025', sets: 4, reps: 6, weight: 80, mode: 'reps', restSec: 180, prog: 'double', warmups: [{ pct: 50, r: 8 }] },
    { id: '0025', sets: 2, reps: 12, weight: 60, mode: 'reps', note: 'back-off' },
  ] }],
  week: { 1: 'r1', 4: ['r1', 'x2'] },
  dayPlan: { '2026-11-10': 'r1', '2026-11-11': 'x2' },
})

describe('createRoutine', () => {
  test('what the editor would build, plus what was said', () => {
    const S = base()
    const r = createRoutine(S, { name: 'Legs', exercises: [{ exercise: 'squat', sets: 5, reps: 5, weight: 100, rest_sec: 150 }, { exercise: 'plank', seconds: 60 }], weekdays: ['tuesday', 5] }, { id: 'n1' })
    expect(r.problems).toBeUndefined()
    expect(r.routine).toEqual({ id: 'n1', name: 'Legs', emoji: 'figureStrength', ex: [
      { id: '0043', sets: 5, reps: 5, weight: 100, mode: 'reps', restSec: 150 },
      { id: '0463', sets: 3, sec: 60, weight: 0, mode: 'time', bodyweight: true },
    ] })
    expect(S.routines).toHaveLength(2)
    expect(S.week).toEqual({ 1: 'r1', 2: ['n1'], 4: ['r1', 'x2'], 5: ['n1'] })
  })
  test('weights in the other unit are stored in the profile\'s', () => {
    const S = { ...base(), unit: 'kg' }
    const r = createRoutine(S, { name: 'X', unit: 'lb', exercises: [{ exercise: 'squat', weight: 225 }] })
    expect(r.routine.ex[0].weight).toBe(102.1)
  })
  test('every problem at once, and nothing changed', () => {
    const S = base()
    const before = JSON.stringify(S)
    const r = createRoutine(S, { name: 'Push', exercises: [{ exercise: 'lever chest press' }, { exercise: 'squat', reps: 5, seconds: 30 }, { exercise: 'squat', sets: 99 }], weekdays: ['someday'] })
    expect(r.routine).toBeUndefined()
    expect(r.problems.map(p => p.field)).toEqual(['name', 'exercises[0].exercise', 'exercises[1]', 'exercises[2].sets', 'weekdays'])
    expect(r.problems[1].candidates.length).toBeGreaterThan(1)
    expect(JSON.stringify(S)).toBe(before)
  })
  test('cardio takes no reps or seconds', () => {
    expect(createRoutine(base(), { name: 'C', exercises: [{ exercise: 'treadmill', reps: 10 }] }).problems[0].problem).toMatch(/minutes/)
    expect(createRoutine(base(), { name: 'C', exercises: [{ exercise: 'treadmill' }] }).routine.ex[0]).toMatchObject({ id: '3666', min: 20 })
  })
})

describe('updateRoutine', () => {
  test('keeps what a slot had that the edit does not mention, slot by slot', () => {
    const S = base()
    const r = updateRoutine(S, 'r1', { exercises: [{ exercise: '0025', sets: 5 }, { exercise: 'bench press', reps: 15 }, { exercise: 'dumbbell curl' }] })
    expect(r.problems).toBeUndefined()
    expect(r.routine.ex[0]).toEqual({ id: '0025', sets: 5, reps: 6, weight: 80, mode: 'reps', restSec: 180, prog: 'double', warmups: [{ pct: 50, r: 8 }] })
    expect(r.routine.ex[1]).toEqual({ id: '0025', sets: 2, reps: 15, weight: 60, mode: 'reps', note: 'back-off' })
    expect(r.routine.ex[2]).toMatchObject({ id: '0294', sets: 3, reps: 10 })
    expect(r.routine.emoji).toBe('figureStrength')
    expect(S.week).toEqual(base().week, 'weekdays untouched without weekdays')
  })
  test('rename, append, and move to other weekdays', () => {
    const S = base()
    const r = updateRoutine(S, 'r1', { name: 'Push heavy', add_exercises: [{ exercise: 'plank' }], weekdays: ['wednesday'] })
    expect(r.routine.name).toBe('Push heavy')
    expect(r.routine.ex.map(e => e.id)).toEqual(['0025', '0025', '0463'])
    expect(S.week).toEqual({ 3: ['r1'], 4: ['x2'] })
    expect(routineWeekdays(S, 'r1')).toEqual(['wednesday'])
  })
  test('an unknown routine, a taken name', () => {
    expect(updateRoutine(base(), 'nope', { name: 'A' }).problems[0].field).toBe('routine_id')
    const S = base(); S.routines.push({ id: 'r2', name: 'Pull', ex: [] })
    expect(updateRoutine(S, 'r1', { name: 'pull' }).problems[0].problem).toMatch(/another routine/)
  })
})

describe('removeRoutine', () => {
  test('off every weekday and date, the other routines stay', () => {
    const S = base()
    const r = removeRoutine(S, 'r1')
    expect(r.routine.name).toBe('Push')
    expect(S.routines).toEqual([])
    expect(S.week).toEqual({ 4: ['x2'] })
    expect(S.dayPlan).toEqual({ '2026-11-11': 'x2' })
    expect(removeRoutine(S, 'r1').problems).toBeTruthy()
  })
})

test('weekdaysOf', () => {
  expect(weekdaysOf(['Monday', 0, 'monday'])).toEqual({ days: [0, 1] })
  expect(weekdaysOf([7]).problem).toBeTruthy()
  expect(weekdaysOf('monday').problem).toBeTruthy()
})

describe('rep ranges, progression, increments and supersets', () => {
  test('a double-progression slot with its range, step and rule', () => {
    const S = base()
    const r = createRoutine(S, { name: 'A', progression: 'double', exercises: [
      { exercise: 'squat', sets: 3, reps: 12, reps_min: 8, weight: 30, increment: 2.5, progression: 'double' },
    ] }, { id: 'n1' })
    expect(r.problems).toBeUndefined()
    expect(r.routine.prog).toBe('double')
    expect(r.routine.ex[0]).toMatchObject({ id: '0043', reps: 12, repsMin: 8, inc: 2.5, prog: 'double' })
  })
  test('a range needs its bottom below the top, and a rule the mode can take', () => {
    const r = createRoutine(base(), { name: 'B', exercises: [
      { exercise: 'squat', reps: 8, reps_min: 8 },
      { exercise: 'plank', seconds: 60, progression: 'double' },
      { exercise: 'squat', progression: 'sideways' },
    ] })
    expect(r.problems.map(p => p.field)).toEqual(['exercises[0].reps_min', 'exercises[1].progression', 'exercises[2].progression'])
  })
  test('0 and default take a setting away; an edit keeps what it does not mention', () => {
    const S = base()
    const r = updateRoutine(S, 'r1', { progression: 'steady', exercises: [{ exercise: '0025', reps_min: 4, increment: 5 }, { exercise: '0025', progression: 'default' }] })
    expect(r.problems).toBeUndefined()
    expect(r.routine.prog).toBe('steady')
    expect(r.routine.ex[0]).toMatchObject({ reps: 6, repsMin: 4, inc: 5, prog: 'double', restSec: 180 })
    expect(r.routine.ex[1].prog).toBeUndefined()
    const r2 = updateRoutine(S, 'r1', { progression: 'default', exercises: [{ exercise: '0025', reps_min: 0, increment: 0 }, { exercise: '0025' }] })
    expect(r2.routine.prog).toBeUndefined()
    expect(r2.routine.ex[0].repsMin).toBeUndefined()
    expect(r2.routine.ex[0].inc).toBeUndefined()
  })
  test('an increment in pounds is stored in the profile\'s kilograms', () => {
    const r = createRoutine(base(), { name: 'C', unit: 'lb', exercises: [{ exercise: 'squat', increment: 5 }] })
    expect(r.routine.ex[0].inc).toBe(2.27)
  })
  test('the same label links neighbours into one named superset with its rest', () => {
    const r = createRoutine(base(), { name: 'Arms', exercises: [
      { exercise: 'squat' },
      { exercise: 'dumbbell curl', superset: 'Arm pair', superset_rest_sec: 75 },
      { exercise: 'bench press', superset: 'Arm pair' },
    ] })
    expect(r.problems).toBeUndefined()
    const [a, b, c] = r.routine.ex
    expect(a.sg).toBeUndefined()
    expect(b.sg).toBeTruthy()
    expect(c.sg).toBe(b.sg)
    expect(b).toMatchObject({ sgName: 'Arm pair', sgRest: 75 })
    expect(c).toMatchObject({ sgName: 'Arm pair', sgRest: 75 })
  })
  test('a superset of one, or one split by another exercise, is refused', () => {
    expect(createRoutine(base(), { name: 'D', exercises: [{ exercise: 'squat', superset: 'x' }, { exercise: 'plank' }] }).problems[0].problem).toMatch(/at least two/)
    expect(createRoutine(base(), { name: 'E', exercises: [{ exercise: 'squat', superset: 'x' }, { exercise: 'plank' }, { exercise: 'bench press', superset: 'x' }] }).problems[0].problem).toMatch(/next to each other/)
  })
  test('an empty label takes an exercise out of its superset; no label keeps it', () => {
    const S = base()
    S.routines[0].ex = S.routines[0].ex.map(e => ({ ...e, sg: 'g1', sgName: 'Pair' }))
    const keep = updateRoutine(structuredClone(S), 'r1', { exercises: [{ exercise: '0025', sets: 2 }, { exercise: '0025' }] })
    expect(keep.routine.ex.map(e => e.sg)).toEqual(['g1', 'g1'])
    const out = updateRoutine(S, 'r1', { exercises: [{ exercise: '0025', superset: '' }, { exercise: '0025' }] })
    expect(out.routine.ex.map(e => e.sg)).toEqual([undefined, undefined])
    expect(out.routine.ex[1].sgName).toBeUndefined()
  })
})

describe('distance', () => {
  test('a carry is planned in metres; reps exercises refuse a distance', () => {
    const r = createRoutine(base(), { name: 'Carry', exercises: [{ exercise: 'farmers walk', sets: 3, meters: 35, weight: 20 }] })
    expect(r.problems).toBeUndefined()
    expect(r.routine.ex[0]).toMatchObject({ mode: 'distance', m: 35, weight: 20, sets: 3 })
    expect(createRoutine(base(), { name: 'X', exercises: [{ exercise: 'squat', meters: 20 }] }).problems[0].field).toBe('exercises[0].meters')
  })
})
