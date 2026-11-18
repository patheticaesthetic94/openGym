/* Body measurements: get_measurements reads the check-ins (waist, arms, blood pressure…) the way
   the Measurements screen shows them, and log_measurement adds one, saved through the openGym api
   like a routine (routine-tools.js writePlan: a paired session or a scoped token that holds
   Measurements at "Change directly"). The rules are frontend/src/lib/measurement-write.js. */
import { z } from 'zod'
import { getState } from './state.js'
import { isoDate, todayIso, noState } from './tools.js'
import { writePlan } from './routine-tools.js'
import { logMeasurement, measurementReadings, MEASUREMENT_KEY_LIST } from '../../frontend/src/lib/measurement-write.js'

const keyEnum = z.enum(MEASUREMENT_KEY_LIST)

export const getMeasurements = {
  name: 'get_measurements',
  description: [
    'Body measurements over time: waist, hips, chest, arms, thighs, calves, body fat, blood pressure and resting pulse, field by field with the first and latest reading in the window, the change between them and the readings themselves, in the profile\'s display unit (cm or in; % for body fat, mmHg and bpm for blood pressure and pulse). Check-in notes come with them.',
    'Use it with get_bodyweight to judge fat loss: a waist going down while the weight holds still is progress.',
  ].join(' '),
  schema: {
    keys: z.array(keyEnum).max(30).optional().describe('Only these fields (waist, upperArmRight, bpSys…). Default: every field with a reading.'),
    days: z.number().int().min(0).max(3650).optional().describe('Only the last N days. 0 or omitted: all.'),
  },
  handler: ({ keys, days } = {}) => {
    const S = getState()
    if (!S) return noState()
    return measurementReadings(S, { keys: keys || null, days: days || 0 })
  },
}

export const logMeasurementTool = {
  name: 'log_measurement',
  description: [
    'Log a body-measurement check-in, e.g. "waist 92.5 cm and right arm 34 cm this morning" or "blood pressure 128/82, pulse 64". It merges into that day\'s check-in (other fields of the day stay) and syncs to every device.',
    'Lengths are in `length_unit` (cm unless said) and stored in cm; body fat in %, blood pressure in mmHg, pulse in bpm. A field switched off in the app is switched on so the reading shows.',
    'Call with dry_run: true first when you interpreted anything, show it, and save once the user agrees.',
  ].join(' '),
  schema: {
    date: isoDate().optional().describe('YYYY-MM-DD of the check-in; defaults to today. Not in the future.'),
    values: z.record(keyEnum, z.number()).describe('The readings by field: { "waist": 92.5, "upperArmRight": 34, "bpSys": 128, "bpDia": 82, "pulse": 64 }.'),
    length_unit: z.enum(['cm', 'in']).optional(),
    note: z.string().max(500).optional().describe('The check-in\'s note ("after the holidays").'),
    dry_run: z.boolean().optional(),
  },
  handler: async (p, { env = process.env, fetchImpl } = {}) => {
    const today = todayIso()
    const input = { ...p, date: p.date || today }
    return writePlan({
      env, fetchImpl, dryRun: p.dry_run === true,
      change: S => { const r = logMeasurement(S, input, { today }); return r.problems ? r : { ...r, what: `measurements for ${input.date}` } },
      view: (S, out) => ({
        date: input.date,
        logged: Object.keys(p.values || {}),
        ...(out.switched_on?.length ? { switched_on: out.switched_on } : {}),
        readings: measurementReadings(S, { keys: Object.keys(p.values || {}), days: 0, limit: 5 }).fields,
      }),
    })
  },
}

export const MEASUREMENT_TOOLS = [getMeasurements, logMeasurementTool]
