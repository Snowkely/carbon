import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseAvailable = Boolean(process.env.DATABASE_URL);
const prisma = databaseAvailable ? new PrismaClient() : null;

type StreamFixture = {
  id: string;
  currentAdjustmentId: string;
  adjustment: {
    id: string;
    adjustedByTeacherId: string;
    originalSystemScore: unknown;
    adjustedScore: unknown;
  };
};

let streams: [StreamFixture, StreamFixture];

describe.skipIf(!databaseAvailable)("ScoreAdjustment same-stream database integrity", () => {
  beforeAll(async () => {
    const candidates = await prisma!.scoreAdjustmentStream.findMany({
      where: { currentAdjustmentId: { not: null }, adjustments: { some: {} } },
      include: { currentAdjustment: true },
      take: 2
    });
    if (candidates.length < 2 || !candidates[0]!.currentAdjustment || !candidates[1]!.currentAdjustment) {
      throw new Error("ScoreAdjustment integrity tests require two populated streams");
    }
    const fixture = (stream: typeof candidates[number]): StreamFixture => ({
      id: stream.id,
      currentAdjustmentId: stream.currentAdjustmentId!,
      adjustment: stream.currentAdjustment!
    });
    streams = [fixture(candidates[0]!), fixture(candidates[1]!)];
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("allows a valid same-stream append and current-pointer update", async () => {
    await expect(prisma!.$transaction(async (tx) => {
      const source = streams[0];
      const created = await tx.scoreAdjustment.create({
        data: {
          streamId: source.id,
          supersedesAdjustmentId: source.currentAdjustmentId,
          originalSystemScore: Number(source.adjustment.originalSystemScore),
          adjustedScore: Number(source.adjustment.adjustedScore),
          reason: "Integrity test transaction rollback",
          adjustedByTeacherId: source.adjustment.adjustedByTeacherId
        }
      });
      await tx.scoreAdjustmentStream.update({
        where: { id: source.id },
        data: { currentAdjustmentId: created.id, version: { increment: 1 } }
      });
      const stored = await tx.scoreAdjustment.findUniqueOrThrow({ where: { id: created.id } });
      expect(stored.streamId).toBe(source.id);
      expect(stored.supersedesAdjustmentId).toBe(source.currentAdjustmentId);
      throw new Error("ROLLBACK_INTEGRITY_TEST");
    })).rejects.toThrow("ROLLBACK_INTEGRITY_TEST");
  });

  it("rejects a cross-stream supersedes relation at the database boundary", async () => {
    const source = streams[0];
    const foreign = streams[1];
    await expect(prisma!.scoreAdjustment.create({
      data: {
        streamId: source.id,
        supersedesAdjustmentId: foreign.adjustment.id,
        originalSystemScore: Number(source.adjustment.originalSystemScore),
        adjustedScore: Number(source.adjustment.adjustedScore),
        reason: "Must be rejected",
        adjustedByTeacherId: source.adjustment.adjustedByTeacherId
      }
    })).rejects.toMatchObject({ code: "P2003" });
  });

  it("rejects a cross-stream current pointer at the database boundary", async () => {
    await expect(prisma!.scoreAdjustmentStream.update({
      where: { id: streams[0].id },
      data: { currentAdjustmentId: streams[1].adjustment.id }
    })).rejects.toMatchObject({ code: "P2003" });
  });

  it("keeps historical adjustments readable and confined to their stream", async () => {
    const stream = await prisma!.scoreAdjustmentStream.findUniqueOrThrow({
      where: { id: streams[0].id },
      include: { currentAdjustment: true, adjustments: { orderBy: { createdAt: "asc" } } }
    });
    expect(stream.adjustments.length).toBeGreaterThan(0);
    expect(stream.adjustments.every((adjustment) => adjustment.streamId === stream.id)).toBe(true);
    expect(stream.currentAdjustment?.streamId).toBe(stream.id);
  });

  it("has only the composite pointer constraints installed", async () => {
    const constraints = await prisma!.$queryRaw<Array<{ conname: string; definition: string }>>`
      SELECT conname, pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE conname IN (
        'score_adjustment_supersedes_same_stream_fkey',
        'score_adjustment_current_same_stream_fkey',
        'score_adjustment_supersedes_adjustment_id_fkey',
        'score_adjustment_stream_current_adjustment_id_fkey'
      )
      ORDER BY conname
    `;
    expect(constraints).toEqual([
      expect.objectContaining({
        conname: "score_adjustment_current_same_stream_fkey",
        definition: expect.stringContaining("FOREIGN KEY (current_adjustment_id, id)")
      }),
      expect.objectContaining({
        conname: "score_adjustment_supersedes_same_stream_fkey",
        definition: expect.stringContaining("FOREIGN KEY (supersedes_adjustment_id, stream_id)")
      })
    ]);
  });

  it("keeps existing workshops, sessions, attempts and adjustments readable", async () => {
    const counts = await Promise.all([
      prisma!.workshop.count(),
      prisma!.workshopSession.count(),
      prisma!.attempt.count(),
      prisma!.scoreAdjustmentStream.count(),
      prisma!.scoreAdjustment.count()
    ]);
    expect(counts.every((count) => count > 0)).toBe(true);
  });
});
