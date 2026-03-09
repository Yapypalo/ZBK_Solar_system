import type { SpacecraftRecord } from "../types";

export const SPACECRAFT_STORAGE_KEY = "zbk_spacecraft_v1";

function isSpacecraftRecord(value: unknown): value is SpacecraftRecord {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<SpacecraftRecord>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.name === "string" &&
    typeof candidate.createdAtIso === "string" &&
    typeof candidate.seed === "number" &&
    typeof candidate.importance === "number" &&
    (candidate.kind === "orbiter" || candidate.kind === "transfer") &&
    Array.isArray(candidate.links) &&
    !!candidate.orbit
  );
}

export function loadSpacecraftRecords(): SpacecraftRecord[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(SPACECRAFT_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(isSpacecraftRecord);
  } catch {
    return [];
  }
}

export function saveSpacecraftRecords(records: SpacecraftRecord[]): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(SPACECRAFT_STORAGE_KEY, JSON.stringify(records));
}

export function upsertSpacecraftRecord(
  records: SpacecraftRecord[],
  record: SpacecraftRecord,
): SpacecraftRecord[] {
  const existingIndex = records.findIndex((item) => item.id === record.id);
  if (existingIndex < 0) {
    return [...records, record];
  }
  const next = [...records];
  next[existingIndex] = record;
  return next;
}
