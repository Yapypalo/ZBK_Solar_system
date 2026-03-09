import type { SpacecraftExportPayload, SpacecraftRecord } from "../types";

const EXPORT_VERSION = "1.0.2";

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

function toPayload(records: SpacecraftRecord[]): SpacecraftExportPayload {
  return {
    version: EXPORT_VERSION,
    exportedAtIso: new Date().toISOString(),
    missions: records,
  };
}

export function exportSpacecraftJson(records: SpacecraftRecord[]): string {
  return JSON.stringify(toPayload(records), null, 2);
}

export function parseSpacecraftJson(raw: string): SpacecraftRecord[] {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Invalid JSON file.");
  }

  if (Array.isArray(parsed)) {
    const missions = parsed.filter(isSpacecraftRecord);
    if (missions.length === 0 && parsed.length > 0) {
      throw new Error("No valid mission records found in legacy array.");
    }
    return missions;
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Unsupported import format.");
  }

  const payload = parsed as Partial<SpacecraftExportPayload>;
  if (!Array.isArray(payload.missions)) {
    throw new Error("Import payload does not contain missions array.");
  }

  const missions = payload.missions.filter(isSpacecraftRecord);
  if (missions.length === 0 && payload.missions.length > 0) {
    throw new Error("No valid mission records found in payload.");
  }
  return missions;
}

export function mergeSpacecraftById(
  current: SpacecraftRecord[],
  incoming: SpacecraftRecord[],
): SpacecraftRecord[] {
  const merged = [...current];
  const indexById = new Map<string, number>();
  merged.forEach((record, index) => {
    indexById.set(record.id, index);
  });

  incoming.forEach((record) => {
    const existingIndex = indexById.get(record.id);
    if (typeof existingIndex === "number") {
      merged[existingIndex] = record;
      return;
    }
    indexById.set(record.id, merged.length);
    merged.push(record);
  });

  return merged;
}

