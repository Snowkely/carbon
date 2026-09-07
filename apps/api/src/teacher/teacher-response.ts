import type { ScoreAdjustmentStreamVersion } from "@carbon/contracts";

export function bigintToSafeNumber(value: bigint, fieldName: string): ScoreAdjustmentStreamVersion {
  const converted = Number(value);
  if (!Number.isSafeInteger(converted) || converted < 0) {
    throw new RangeError(`${fieldName} cannot be represented as a safe non-negative JSON number`);
  }
  return converted;
}

export function scoreAdjustmentStreamResponse<T extends { version: bigint }>(
  stream: T
): Omit<T, "version"> & { version: ScoreAdjustmentStreamVersion } {
  return {
    ...stream,
    version: bigintToSafeNumber(stream.version, "ScoreAdjustmentStream.version")
  };
}
