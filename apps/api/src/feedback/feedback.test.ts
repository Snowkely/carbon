import { HttpException } from "@nestjs/common";
import { AccountType, FeedbackQuestionType, WorkshopRole } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { FeedbackService } from "./feedback";

const student = { userId: "student-1", username: "student.alex", accountType: AccountType.STUDENT };
const teacher = { userId: "teacher-1", username: "teacher.demo", accountType: AccountType.TEACHER };
const questions = [
  { id: "q1", stableId: "FB-Q01", questionType: FeedbackQuestionType.SINGLE_CHOICE, prompt: "Rate", displayOrder: 1, options: ["Excellent", "Good"], validationConfig: {} },
  { id: "q2", stableId: "FB-Q02", questionType: FeedbackQuestionType.SINGLE_CHOICE, prompt: "Value", displayOrder: 2, options: ["Understanding how carbon markets work", "Other"], validationConfig: {} },
  { id: "q3", stableId: "FB-Q03", questionType: FeedbackQuestionType.SINGLE_CHOICE, prompt: "Recommend", displayOrder: 3, options: ["Definitely yes", "Not sure"], validationConfig: {} },
  { id: "q4", stableId: "FB-Q04", questionType: FeedbackQuestionType.OPEN_TEXT, prompt: "Improve", displayOrder: 4, options: null, validationConfig: {} }
];
const input = { responses: [
  { questionStableId: "FB-Q01", selectedOption: "Excellent" },
  { questionStableId: "FB-Q02", selectedOption: "Other", otherText: "More market rounds" },
  { questionStableId: "FB-Q03", selectedOption: "Definitely yes" },
  { questionStableId: "FB-Q04", textResponse: "More time." }
] };

describe("Feedback service", () => {
  it("snapshots the published form version without touching scoring state", async () => {
    const createSubmission = vi.fn().mockResolvedValue({ id: "submission-1", submittedAt: new Date("2026-09-04T00:00:00Z") });
    const createResponses = vi.fn().mockResolvedValue({ count: 4 });
    const scoreMutation = vi.fn();
    const prisma: any = {
      workshopParticipant: { findUnique: vi.fn().mockResolvedValue({ id: "participant-1", session: { workshopId: "workshop-1" } }) },
      feedbackForm: { findFirst: vi.fn().mockResolvedValue({ id: "form-1", stableId: "POST_WORKSHOP_FEEDBACK", version: 3, questions }) },
      missionAttempt: { update: scoreMutation }, attempt: { update: scoreMutation }, questionResult: { update: scoreMutation },
      $transaction: vi.fn(async (callback: any) => callback({ feedbackSubmission: { create: createSubmission }, feedbackResponse: { createMany: createResponses } }))
    };
    const result = await new FeedbackService(prisma).submit(student, "session-1", input);
    expect(result).toMatchObject({ id: "submission-1", feedbackFormId: "form-1", feedbackFormVersion: 3 });
    expect(createSubmission).toHaveBeenCalledWith({ data: { feedbackFormId: "form-1", studentId: "student-1", workshopId: "workshop-1", sessionId: "session-1" } });
    expect(createResponses.mock.calls[0]![0].data).toHaveLength(4);
    expect(scoreMutation).not.toHaveBeenCalled();
  });

  it("rejects options not present in the published form version", async () => {
    const prisma: any = {
      workshopParticipant: { findUnique: vi.fn().mockResolvedValue({ id: "participant-1", session: { workshopId: "workshop-1" } }) },
      feedbackForm: { findFirst: vi.fn().mockResolvedValue({ id: "form-1", stableId: "POST_WORKSHOP_FEEDBACK", version: 1, questions }) }
    };
    await expect(new FeedbackService(prisma).submit(student, "session-1", { ...input, responses: input.responses.map((response) => response.questionStableId === "FB-Q01" ? { questionStableId: "FB-Q01", selectedOption: "Unknown" } : response) })).rejects.toSatisfy((error: unknown) => Boolean((error as HttpException).getResponse()) && (error as HttpException).getStatus() === 400);
  });

  it("denies raw Feedback access to VIEWER", async () => {
    const prisma: any = {
      workshopSession: { findUnique: vi.fn().mockResolvedValue({ id: "session-1", workshopId: "workshop-1" }) },
      workshopTeacher: { findUnique: vi.fn().mockResolvedValue({ role: WorkshopRole.VIEWER }) }
    };
    await expect(new FeedbackService(prisma).raw(teacher, "session-1")).rejects.toSatisfy((error: unknown) => (error as HttpException).getStatus() === 403);
  });
});
