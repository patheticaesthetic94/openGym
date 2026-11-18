// A routine described rather than built in the editor ("squat 3 × 8 at 60 kg, plank 3 × 45 s,
// Mondays and Thursdays"), for the MCP server's create_routine, update_routine and delete_routine
// tools. Pure and beside its test, like log-workout.js, because it decides what lands in the plan.
//
// It builds what the routine editor would have built: an exercise starts the way picking it in the
// editor starts it (pickedExerciseConfig: the profile's own defaults, a hold as a hold, per side
// for a one-arm lift), and only what the description says is set on top. An edit keeps everything
// a slot already had that the description does not mention (rest, warm-ups, progression, notes),
// slot by slot, and a routine's place on the weekdays is changed only when weekdays are given.
// Names resolve like log_workout's (resolveExercise): a name the library spells twice, or one it
// does not have, comes back as a problem with candidates instead of a guess.
import { resolveExercise } from './log-workout.js'
import { pickedExerciseConfig, cleanupSg } from './history.js'
import { deleteRoutine } from './routines.js'
import { isCardio } from './exercises.js'
import { POLICIES_FOR } from './progression.js'

const LB_TO_KG = 0.45359237
export const ROUTINE_LIMITS = { maxExercises: 40, maxSets: 20, maxReps: 100, maxSec: 3600, maxRestSec: 900, maxKg: 2000, maxName: 80, maxNote: 280, maxIncKg: 50, maxSuperset: 40 }
// JS getDay() order, the state's own (S.week is keyed 0 Sunday … 6 Saturday).
export const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const clean = (v, n) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n) : '')

/** The weekday indexes a description names ('monday' or 1), or a problem. */
export function weekdaysOf(list) {
  if (!Array.isArray(list)) return { problem: 'weekdays must be a list' }
  const out = new Set()
  for (const d of list) {
    const i = typeof d === 'number' ? d : WEEKDAYS.indexOf(String(d).toLowerCase().trim())
    if (!Number.isInteger(i) || i < 0 || i > 6) return { problem: `not a weekday: ${JSON.stringify(d)}` }
    out.add(i)
  }
  return { days: [...out].sort() }
}

// One described exercise as a slot. `base` is the slot it edits (its settings stay), else a fresh
// pick. Weight is in `unit` and stored in the profile's.
function slotOf(S, ex, base, unit, at, problems) {
  const want = ex?.exercise
  let hit
  if (base && (want == null || want === base.id)) hit = { id: base.id }
  else {
    hit = resolveExercise(S, want)
    if (hit.problem) { problems.push({ field: at + '.exercise', input: want ?? null, problem: hit.problem, ...(hit.candidates ? { candidates: hit.candidates } : {}) }); return null }
  }
  const timed = ex?.seconds != null
  if (timed && ex?.reps != null) { problems.push({ field: at, problem: 'give reps or seconds, not both' }); return null }
  if (isCardio(hit.id) && (ex?.reps != null || timed)) { problems.push({ field: at, problem: 'a cardio exercise is planned in minutes in the app; leave reps and seconds out' }); return null }
  const slot = base && base.id === hit.id ? { ...base } : { id: hit.id, ...pickedExerciseConfig(hit.id, timed ? 'time' : undefined, S) }
  if (timed && slot.mode !== 'time') { slot.mode = 'time'; delete slot.reps; delete slot.repsMin }
  if (ex?.reps != null && slot.mode === 'time') { slot.mode = 'reps'; delete slot.sec }
  const check = (k, v, lo, hi) => {
    if (v == null) return undefined
    const n = num(v)
    if (n == null || n < lo || n > hi) { problems.push({ field: `${at}.${k}`, problem: `must be ${lo} to ${hi}` }); return undefined }
    return n
  }
  const sets = check('sets', ex?.sets, 1, ROUTINE_LIMITS.maxSets)
  if (sets != null) slot.sets = Math.round(sets)
  const reps = check('reps', ex?.reps, 1, ROUTINE_LIMITS.maxReps)
  if (reps != null) { slot.reps = Math.round(reps); if (slot.repsMin >= slot.reps) delete slot.repsMin }
  const sec = check('seconds', ex?.seconds, 1, ROUTINE_LIMITS.maxSec)
  if (sec != null) slot.sec = Math.round(sec)
  const rest = check('rest_sec', ex?.rest_sec, 0, ROUTINE_LIMITS.maxRestSec)
  if (rest != null) { if (rest > 0) slot.restSec = Math.round(rest); else delete slot.restSec }
  if (ex?.weight != null) {
    const w = num(ex.weight)
    const kg = w == null ? null : unit === 'lb' ? w * LB_TO_KG : w
    if (w == null || w < 0 || kg > ROUTINE_LIMITS.maxKg) problems.push({ field: `${at}.weight`, problem: `must be 0 to ${ROUTINE_LIMITS.maxKg} kg` })
    else {
      const profileUnit = S.unit === 'lb' ? 'lb' : 'kg'
      slot.weight = unit === profileUnit ? w : Math.round((unit === 'lb' ? w * LB_TO_KG : w / LB_TO_KG) * 10) / 10
    }
  }
  if (ex?.note != null) { const n = clean(ex.note, ROUTINE_LIMITS.maxNote); if (n) slot.note = n; else delete slot.note }
  const kind = isCardio(slot.id) ? 'cardio' : slot.mode === 'time' ? 'time' : 'reps'
  // A rep range (double, steady, triple progression): the top is `reps`, the bottom `repsMin`,
  // the way the editor stores "8–12". 0 takes the range away.
  const lo = check('reps_min', ex?.reps_min, 0, ROUTINE_LIMITS.maxReps)
  if (lo === 0) delete slot.repsMin
  else if (lo != null) {
    if (kind !== 'reps') problems.push({ field: `${at}.reps_min`, problem: 'a rep range is for a rep exercise' })
    else if (!(lo < (slot.reps || 0))) problems.push({ field: `${at}.reps_min`, problem: `must be below reps (${slot.reps || 0}), the top of the range` })
    else slot.repsMin = Math.round(lo)
  }
  // The ceiling a bodyweight exercise climbs to before a set is added instead (progression.js).
  const hi = check('reps_max', ex?.reps_max, 0, ROUTINE_LIMITS.maxReps)
  if (hi === 0) delete slot.repsMax
  else if (hi != null) {
    if (kind !== 'reps') problems.push({ field: `${at}.reps_max`, problem: 'a rep ceiling is for a rep exercise' })
    else slot.repsMax = Math.round(hi)
  }
  if (ex?.progression != null) {
    const p = String(ex.progression)
    if (p === 'default') delete slot.prog
    else if (!POLICIES_FOR[kind].includes(p)) problems.push({ field: `${at}.progression`, problem: `for this exercise one of: default, ${POLICIES_FOR[kind].join(', ')}` })
    else slot.prog = p
  }
  // The weight step progression adds, in `unit`, stored in the profile's. 0: the exercise's own.
  if (ex?.increment != null) {
    const w = num(ex.increment)
    const max = unit === 'lb' ? Math.round(ROUTINE_LIMITS.maxIncKg / LB_TO_KG) : ROUTINE_LIMITS.maxIncKg
    if (w == null || w < 0 || w > max) problems.push({ field: `${at}.increment`, problem: `must be 0 to ${max} ${unit}` })
    else if (w === 0) delete slot.inc
    else if (kind !== 'reps') problems.push({ field: `${at}.increment`, problem: 'a weight step is for a rep exercise' })
    else {
      const profileUnit = S.unit === 'lb' ? 'lb' : 'kg'
      slot.inc = unit === profileUnit ? w : Math.round((unit === 'lb' ? w * LB_TO_KG : w / LB_TO_KG) * 100) / 100
    }
  }
  return slot
}

// Supersets by label: exercises given the same `superset` label form one group, which the app
// shows under that name. They have to be next to each other, the way the app links them. An empty
// label takes the exercise out of its group; no label keeps whatever group the slot had.
function supersetsOf(list, slots, field, problems) {
  const tags = new Map()
  list.forEach((ex, i) => {
    const s = slots[i]
    if (!s) return
    if (ex?.superset == null) {
      if (ex?.superset_rest_sec != null) problems.push({ field: `${field}[${i}].superset_rest_sec`, problem: 'give the superset label with its rest' })
      return
    }
    const label = clean(ex.superset, ROUTINE_LIMITS.maxSuperset)
    delete s.sg; delete s.sgName; delete s.sgRest; delete s.sgCircuit
    if (!label) return
    if (!tags.has(label)) tags.set(label, 'mc' + Math.random().toString(36).slice(2, 8))
    s.sg = tags.get(label)
    s.sgName = label
    if (ex.superset_rest_sec != null) {
      const r = num(ex.superset_rest_sec)
      if (r == null || r < 0 || r > ROUTINE_LIMITS.maxRestSec) problems.push({ field: `${field}[${i}].superset_rest_sec`, problem: `must be 0 to ${ROUTINE_LIMITS.maxRestSec}` })
      else if (r > 0) s.sgRest = Math.round(r)
    }
  })
  for (const [label, tag] of tags) {
    const at = slots.map((s, i) => (s?.sg === tag ? i : -1)).filter(i => i >= 0)
    if (at.length < 2) problems.push({ field, problem: `superset "${label}" needs at least two exercises` })
    else if (at[at.length - 1] - at[0] !== at.length - 1) problems.push({ field, problem: `the exercises of superset "${label}" have to be next to each other` })
  }
}

// The slots a list of described exercises stands for. With `old` (an edit), each exercise named
// again takes the next unused slot of that exercise, so repeated slots keep their own settings.
function slotsOf(S, list, old, unit, field, problems) {
  if (!Array.isArray(list) || !list.length) { problems.push({ field, problem: 'at least one exercise' }); return [] }
  if (list.length > ROUTINE_LIMITS.maxExercises) { problems.push({ field, problem: `at most ${ROUTINE_LIMITS.maxExercises}` }); return [] }
  const used = new Set()
  const slots = list.map((ex, i) => {
    let base = null
    if (old) {
      const ref = ex?.exercise
      const id = ref == null ? null : (old.find((s, j) => !used.has(j) && s.id === ref) ? ref : resolveExercise(S, ref).id)
      const j = old.findIndex((s, k) => !used.has(k) && s.id === id)
      if (j >= 0) { used.add(j); base = old[j] }
    }
    return slotOf(S, ex, base, unit, `${field}[${i}]`, problems)
  })
  if (slots.every(Boolean)) supersetsOf(list, slots, field, problems)
  return slots.filter(Boolean)
}

// A routine-wide progression rule ('default' goes back to the profile's), or a problem.
function routineProgression(input, problems) {
  if (input?.progression == null) return undefined
  const p = String(input.progression)
  if (p === 'default') return null
  if (!POLICIES_FOR.reps.includes(p)) { problems.push({ field: 'progression', problem: `one of: default, ${POLICIES_FOR.reps.join(', ')}` }); return undefined }
  return p
}

function placeOnWeekdays(S, id, days) {
  S.week = S.week && typeof S.week === 'object' ? S.week : {}
  for (let d = 0; d < 7; d++) {
    const ids = [].concat(S.week[d] ?? []).filter(x => x != null && x !== '')
    const has = ids.includes(id)
    const want = days.includes(d)
    if (has === want) continue
    const next = want ? [...ids, id] : ids.filter(x => x !== id)
    if (next.length) S.week[d] = next; else delete S.week[d]
  }
}

/**
 * A new routine into `S` (mutated). `input`: { name, exercises: [{ exercise, sets?, reps? | seconds?,
 * reps_min?, reps_max?, weight?, increment?, progression?, rest_sec?, note?, superset?,
 * superset_rest_sec? }], weekdays?, unit?, progression? }. → { routine } or { problems } (S untouched).
 */
export function createRoutine(S, input, { id } = {}) {
  const problems = []
  const name = clean(input?.name, ROUTINE_LIMITS.maxName)
  if (!name) problems.push({ field: 'name', problem: 'a routine needs a name' })
  if ((S.routines || []).some(r => r && String(r.name || '').toLowerCase() === name.toLowerCase())) {
    problems.push({ field: 'name', problem: 'a routine with this name exists already; update it, or pick another name' })
  }
  const unit = input?.unit === 'lb' || input?.unit === 'kg' ? input.unit : S.unit === 'lb' ? 'lb' : 'kg'
  const ex = slotsOf(S, input?.exercises, null, unit, 'exercises', problems)
  const days = input?.weekdays == null ? { days: null } : weekdaysOf(input.weekdays)
  if (days.problem) problems.push({ field: 'weekdays', problem: days.problem })
  const prog = routineProgression(input, problems)
  if (problems.length) return { problems }
  const routine = { id: id || 'mr' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name, emoji: 'figureStrength', ...(prog ? { prog } : {}), ex }
  cleanupSg(routine.ex)
  S.routines = [...(S.routines || []), routine]
  if (days.days) placeOnWeekdays(S, routine.id, days.days)
  return { routine }
}

/**
 * An existing routine changed in `S` (mutated). `patch`: { name?, exercises? (the whole new list),
 * add_exercises? (appended), weekdays? (the days it is on, all of them), unit? }.
 */
export function updateRoutine(S, routineId, patch) {
  const i = (S.routines || []).findIndex(r => r && r.id === routineId)
  if (i < 0) return { problems: [{ field: 'routine_id', problem: 'no routine with this id; list_routines has them' }] }
  const old = S.routines[i]
  const problems = []
  const next = { ...old }
  if (patch?.name != null) {
    const name = clean(patch.name, ROUTINE_LIMITS.maxName)
    if (!name) problems.push({ field: 'name', problem: 'a routine needs a name' })
    else if (S.routines.some((r, j) => j !== i && r && String(r.name || '').toLowerCase() === name.toLowerCase())) problems.push({ field: 'name', problem: 'another routine has this name' })
    else next.name = name
  }
  const unit = patch?.unit === 'lb' || patch?.unit === 'kg' ? patch.unit : S.unit === 'lb' ? 'lb' : 'kg'
  const oldEx = Array.isArray(old.ex) ? old.ex : []
  if (patch?.exercises != null) next.ex = slotsOf(S, patch.exercises, oldEx, unit, 'exercises', problems)
  if (patch?.add_exercises != null) next.ex = [...(next.ex || oldEx), ...slotsOf(S, patch.add_exercises, null, unit, 'add_exercises', problems)]
  if ((next.ex || []).length > ROUTINE_LIMITS.maxExercises) problems.push({ field: 'exercises', problem: `at most ${ROUTINE_LIMITS.maxExercises}` })
  const days = patch?.weekdays == null ? { days: null } : weekdaysOf(patch.weekdays)
  if (days.problem) problems.push({ field: 'weekdays', problem: days.problem })
  const prog = routineProgression(patch, problems)
  if (prog === null) delete next.prog
  else if (prog) next.prog = prog
  if (problems.length) return { problems }
  if (next.ex !== old.ex) { next.ex = next.ex.map(s => ({ ...s })); cleanupSg(next.ex) }
  const routines = [...S.routines]
  routines[i] = next
  S.routines = routines
  if (days.days) placeOnWeekdays(S, routineId, days.days)
  return { routine: next }
}

/** A routine gone from `S` (mutated), off every weekday and date it was planned on. */
export function removeRoutine(S, routineId) {
  const r = (S.routines || []).find(x => x && x.id === routineId)
  if (!r) return { problems: [{ field: 'routine_id', problem: 'no routine with this id; list_routines has them' }] }
  S.routines = [...S.routines]
  S.week = { ...(S.week || {}) }
  S.dayPlan = { ...(S.dayPlan || {}) }
  const dropped = deleteRoutine(S, routineId)
  return { routine: r, dropped }
}

/** The weekdays a routine is planned on, as names. */
export const routineWeekdays = (S, id) => WEEKDAYS.filter((_, d) => [].concat(S?.week?.[d] ?? []).includes(id))
