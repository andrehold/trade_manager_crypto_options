// src/features/import/missing.ts
import type { ImportPayload } from '../../lib/import';
import { payloadSchema } from '../../lib/import';

type IssuePath = ReadonlyArray<PropertyKey>;

/** Convert a Zod path like ["legs", 0, "expiry"] to "legs[0].expiry" */
function pathToString(path: IssuePath): string {
  if (!path.length) return "";
  let out = "";
  for (let i = 0; i < path.length; i++) {
    const seg = path[i];
    if (typeof seg === "number") {
      out += `[${seg}]`;
      continue;
    }

    const asString =
      typeof seg === "string"
        ? seg
        : seg.description ?? seg.toString();

    out += i === 0 ? asString : `.${asString}`;
  }
  return out;
}

/** Safe nested getter following a Zod issue.path */
function getValueByPath(obj: unknown, path: IssuePath) {
  return path.reduce<unknown>((acc, seg) => {
    if (acc == null) return acc;
    if (typeof acc !== "object" && typeof acc !== "function") return undefined;
    return (acc as Record<PropertyKey, unknown>)[seg];
  }, obj);
}

/** Treat undefined, null, "", or NaN as "missing" */
function isMissingValue(v: any) {
  if (v === undefined || v === null) return true;
  if (typeof v === "string" && v.trim() === "") return true;
  if (typeof v === "number" && Number.isNaN(v)) return true;
  return false;
}

/** DB-critical fields we always want present (complements Zod) */
const REQUIRED_POSITION_KEYS: Array<keyof ImportPayload["position"]> = [
  "program_id",
  "underlier",
  "strategy_code",
  "strategy_name",
  "options_structure",
  "construction",
  "risk_defined",
  "lifecycle",
  "entry_ts",
  "execution_route",
  "net_fill",
];

const REQUIRED_LEG_KEYS: Array<keyof ImportPayload["legs"][number]> = [
  "leg_seq",
  "side",
  "option_type",
  "expiry",
  "strike",
  "qty",
  "price",
];

const REQUIRED_FILL_KEYS: Array<keyof NonNullable<ImportPayload["fills"]>[number]> = [
  "ts",
  "qty",
  "price",
];

/**
 * Returns a sorted list of missing field paths (e.g., "position.execution_route", "legs[0].expiry")
 * - Uses your Zod schema (payloadSchema) to detect required/empty cases
 * - Adds a fallback pass for DB-critical keys + NaN/blank strings
 * - Intentionally does NOT flag format errors (e.g., regex/enum) as "missing"
 */
export function computeMissing(payload: Partial<ImportPayload>): string[] {
  const missing = new Set<string>();

  // 1) Schema-driven detection of missing/empty values
  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const key = pathToString(issue.path);

      switch (issue.code) {
        case "invalid_type": {
          // Consider missing only if Zod received 'undefined' or 'null'
          const input = issue.input;
          if ((input === undefined || input === null) && key) {
            missing.add(key);
          }
          break;
        }

        case "too_small": {
          // Strings/arrays with min requirements — treat empty as missing
          const current = getValueByPath(payload, issue.path);
          if (
            issue.origin === "string" &&
            (current === "" || current === undefined || current === null)
          ) {
            if (key) missing.add(key);
          }
          if (
            issue.origin === "array" &&
            Array.isArray(current) &&
            current.length === 0
          ) {
            const containerKey = pathToString(issue.path);
            if (containerKey) missing.add(containerKey);
          }
          break;
        }

        // Ignore invalid_string/invalid_enum_value/etc. — they’re present but malformed, not missing.
        default:
          break;
      }
    }
  }

  // 2) Fallback pass for DB-critical fields (catches NaN/blank that Zod may not label "missing")
  if (payload.position) {
    for (const k of REQUIRED_POSITION_KEYS) {
      const v = payload.position[k];
      if (isMissingValue(v)) missing.add(`position.${String(k)}`);
    }
    if (
      payload.position.lifecycle === 'close' &&
      isMissingValue(payload.position.close_target_structure_id)
    ) {
      missing.add('position.close_target_structure_id');
    }
  } else {
    for (const k of REQUIRED_POSITION_KEYS) missing.add(`position.${String(k)}`);
  }

  if (Array.isArray(payload.legs)) {
    payload.legs.forEach((leg, i) => {
      for (const k of REQUIRED_LEG_KEYS) {
        const v = leg?.[k];
        if (isMissingValue(v)) missing.add(`legs[${i}].${String(k)}`);
      }
    });
    if (payload.legs.length === 0) missing.add("legs");
  } else {
    missing.add("legs");
  }

  // fills are optional overall; only validate provided ones
  if (Array.isArray(payload.fills)) {
    payload.fills.forEach((fill, i) => {
      for (const k of REQUIRED_FILL_KEYS) {
        const v = fill?.[k];
        if (isMissingValue(v)) missing.add(`fills[${i}].${String(k)}`);
      }
    });
  }

  return Array.from(missing).sort();
}
