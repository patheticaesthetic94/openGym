// A body-measurement check-in described rather than typed into the form ("waist 92.5 cm, right
// arm 34 cm, blood pressure 128/82"), for the MCP server's log_measurement tool, and the readings
// as get_measurements answers them. Pure and beside its test, like routine-write.js.
//
// It writes what the logging form writes: one entry per date in canonical units (cm, %, mmHg,
// bpm), a reading for that date merged into the day's entry field by field (an earlier reading of
// another field stays), `t` set to the edit time so sync keeps the newer day, and a field that was
// switched off in Settings switched on, so the reading shows in the app.
import {
  MEASUREMENT_FIELDS, MEASUREMENT_KEYS, DEFAULT_MEASUREMENT_KEYS, MEASUREMENT_NOTE_MAX,
  builtinUnit, inMeasurementRange, normalizeMeasurementEntry, measurementSeries, lengthUnitOf, measurementUnit,
} from './measurements.js'

const DATE = /^\d{4}-\d{2}-\d{2}$/
const FIELD = new Map(MEASUREMENT_FIELDS.map(f => [f.key, f]))
const clean = (v, n) => (typeof v === 'string' ? v.replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ').trim().slice(0, n) : '')

/** The measurement keys and what each reads as, for a tool's schema and its errors. */
export const MEASUREMENT_KEY_LIST = MEASUREMENT_KEYS

/**
 * A check-in into `S` (mutated). `input`: { date: 'YYYY-MM-DD', values: { waist: 92.5, … },
 * length_unit?: 'cm' | 'in', note? }. → { entry } or { problems } (S untouched).
 * `today` ('YYYY-MM-DD') bounds the date: a reading cannot be from the future.
 */
export function logMeasurement(S, input, { today, now = Date.now() } = {}) {
  const problems = []
  const d = String(input?.date || '')
  if (!DATE.test(d) || Number.isNaN(new Date(d + 'T12:00:00').getTime())) problems.push({ field: 'date', problem: 'a date as YYYY-MM-DD' })
  else if (today && d > today) problems.push({ field: 'date', problem: `not after today (${today})` })
  const lengthUnit = input?.length_unit === 'in' || input?.length_unit === 'cm' ? input.length_unit : 'cm'
  const values = input?.values && typeof input.values === 'object' ? input.values : {}
  const keys = Object.keys(values)
  if (!keys.length) problems.push({ field: 'values', problem: 'at least one reading, e.g. { "waist": 92.5 }' })
  const set = {}
  for (const k of keys) {
    if (!FIELD.has(k)) { problems.push({ field: `values.${k}`, problem: `not a measurement; one of: ${MEASUREMENT_KEYS.join(', ')}` }); continue }
    const v = Number(values[k])
    const fixed = builtinUnit(k)
    if (values[k] == null || values[k] === '' || !Number.isFinite(v)) { problems.push({ field: `values.${k}`, problem: 'a number' }); continue }
    if (fixed === '%' ? v < 0 || v > 100 : v <= 0) { problems.push({ field: `values.${k}`, problem: fixed === '%' ? '0 to 100' : 'above 0' }); continue }
    if (!inMeasurementRange(k, v)) { problems.push({ field: `values.${k}`, problem: 'not a reading a person can have' }); continue }
    // Lengths are stored in cm; body fat, blood pressure and pulse in their own fixed units.
    set[k] = fixed ? v : lengthUnit === 'in' ? v * 2.54 : v
  }
  const note = input?.note == null ? null : clean(input.note, MEASUREMENT_NOTE_MAX)
  if (problems.length) return { problems }

  const list = Array.isArray(S.measurements) ? [...S.measurements] : []
  const i = list.findIndex(e => e && e.d === d)
  const raw = { ...(i >= 0 ? list[i] : { d }), ...set, t: now, ...(note ? { note } : {}) }
  const entry = normalizeMeasurementEntry(raw, Array.isArray(S.customMeasurements) ? S.customMeasurements : [])
  if (i >= 0) list[i] = entry
  else list.push(entry)
  list.sort((a, b) => String(a?.d).localeCompare(String(b?.d)) || (a?.t || 0) - (b?.t || 0))
  S.measurements = list
  // A reading of a field the user switched off would be stored and never shown: switch it on.
  const enabled = Array.isArray(S.measurementEnabled) ? S.measurementEnabled : DEFAULT_MEASUREMENT_KEYS
  const missing = Object.keys(set).filter(k => !enabled.includes(k))
  if (missing.length || !Array.isArray(S.measurementEnabled)) S.measurementEnabled = [...enabled, ...missing]
  return { entry, switched_on: missing }
}

/**
 * The readings, field by field, in the profile's display unit: { unit, fields: [{ key, label,
 * unit, latest, first, change, readings }] } over the last `days` (0: all). Only fields with a
 * reading, unless `keys` names others.
 */
export function measurementReadings(S, { keys = null, days = 0, limit = 30, now = Date.now() } = {}) {
  const lengthUnit = lengthUnitOf(S)
  const want = keys && keys.length ? keys.filter(k => FIELD.has(k)) : MEASUREMENT_KEYS
  const fields = []
  for (const key of want) {
    const series = measurementSeries(S, key, days, now)
    if (!series.length && !(keys && keys.length)) continue
    const f = FIELD.get(key)
    const unit = measurementUnit(lengthUnit, f)
    const first = series[0] || null
    const latest = series[series.length - 1] || null
    fields.push({
      key, label: f.label, unit,
      latest: latest ? { date: latest.d, value: latest.y } : null,
      first: first ? { date: first.d, value: first.y } : null,
      change: first && latest && first !== latest ? Math.round((latest.y - first.y) * 10) / 10 : null,
      readings: series.slice(-limit).map(p => ({ date: p.d, value: p.y })),
    })
  }
  const notes = (Array.isArray(S.measurements) ? S.measurements : [])
    .filter(e => e && typeof e.note === 'string' && e.note && (!days || new Date(e.d + 'T12:00:00').getTime() >= now - days * 86400000))
    .map(e => ({ date: e.d, note: e.note }))
  return { length_unit: lengthUnit, fields, notes }
}
