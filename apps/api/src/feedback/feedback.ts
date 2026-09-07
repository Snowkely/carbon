import { Body, Controller, Get, Injectable, Param, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiBody, ApiForbiddenResponse, ApiTags, ApiUnauthorizedResponse } from "@nestjs/swagger";
import { AccountType, FeedbackFormStatus, FeedbackQuestionType, Prisma, WorkshopRole } from "@prisma/client";
import { feedbackSubmissionSchema } from "@carbon/contracts";
import { AuthUser, CurrentUser, JwtAuthGuard } from "../common/auth";
import { apiError } from "../common/api-error";
import { PrismaService } from "../common/prisma.service";
import { FeedbackSubmissionDto } from "../openapi/request-dtos";

const FEEDBACK_ROLES: WorkshopRole[] = [WorkshopRole.OWNER, WorkshopRole.INSTRUCTOR];

@Injectable()
export class FeedbackService {
  constructor(private readonly prisma: PrismaService) {}

  private async studentParticipant(user: AuthUser, sessionId: string) {
    if (user.accountType !== AccountType.STUDENT) apiError(403, "FORBIDDEN", "Student account required");
    const participant = await this.prisma.workshopParticipant.findUnique({
      where: { sessionId_studentId: { sessionId, studentId: user.userId } },
      include: { session: true }
    });
    if (!participant) apiError(403, "FORBIDDEN", "Student does not participate in this session");
    return participant;
  }

  private async publishedForm() {
    const form = await this.prisma.feedbackForm.findFirst({
      where: { status: FeedbackFormStatus.PUBLISHED },
      orderBy: [{ publishedAt: "desc" }, { version: "desc" }],
      include: { questions: { orderBy: { displayOrder: "asc" } } }
    });
    if (!form) apiError(503, "FEEDBACK_FORM_UNAVAILABLE", "No published Feedback form is available");
    return form;
  }

  async form(user: AuthUser, sessionId: string) {
    await this.studentParticipant(user, sessionId);
    const form = await this.publishedForm();
    const existing = await this.prisma.feedbackSubmission.findUnique({
      where: { feedbackFormId_studentId_sessionId: { feedbackFormId: form.id, studentId: user.userId, sessionId } },
      include: { responses: true }
    });
    return {
      id: form.id,
      stableId: form.stableId,
      version: form.version,
      questions: form.questions.map((question) => ({
        id: question.id,
        stableId: question.stableId,
        type: question.questionType,
        prompt: question.prompt,
        options: question.options,
        validation: question.validationConfig
      })),
      submission: existing ? { id: existing.id, submittedAt: existing.submittedAt, responses: existing.responses } : null
    };
  }

  async submit(user: AuthUser, sessionId: string, input: unknown) {
    const participant = await this.studentParticipant(user, sessionId);
    const parsed = feedbackSubmissionSchema.safeParse(input);
    if (!parsed.success) apiError(400, "VALIDATION_ERROR", "Feedback responses are invalid", { issues: parsed.error.issues });
    const form = await this.publishedForm();
    if (form.questions.length !== 4) apiError(503, "FEEDBACK_FORM_INVALID", "Published Feedback form is incomplete");
    const questionByStableId = new Map(form.questions.map((question) => [question.stableId, question]));
    const rows = parsed.data.responses.map((response) => {
      const question = questionByStableId.get(response.questionStableId);
      if (!question) apiError(400, "FEEDBACK_QUESTION_VERSION_MISMATCH", "Feedback response does not belong to the published form");
      if (question.questionType === FeedbackQuestionType.SINGLE_CHOICE) {
        const allowed = Array.isArray(question.options) ? question.options.map(String) : [];
        if (!response.selectedOption || !allowed.includes(response.selectedOption)) apiError(400, "INVALID_FEEDBACK_OPTION", "Selected Feedback option is not allowed", { questionStableId: question.stableId });
      } else if (response.selectedOption) {
        apiError(400, "INVALID_FEEDBACK_RESPONSE", "Open text Feedback cannot contain a selected option", { questionStableId: question.stableId });
      }
      return {
        feedbackQuestionId: question.id,
        feedbackFormId: form.id,
        selectedOption: response.selectedOption ?? null,
        otherText: response.otherText?.trim() || null,
        textResponse: response.textResponse?.trim() || null
      };
    });
    try {
      return await this.prisma.$transaction(async (tx) => {
        const submission = await tx.feedbackSubmission.create({
          data: { feedbackFormId: form.id, studentId: user.userId, workshopId: participant.session.workshopId, sessionId }
        });
        await tx.feedbackResponse.createMany({ data: rows.map((row) => ({ ...row, submissionId: submission.id })) });
        return { id: submission.id, feedbackFormId: form.id, feedbackFormVersion: form.version, submittedAt: submission.submittedAt };
      });
    } catch (error) {
      if ((error as { code?: string }).code === "P2002") apiError(409, "FEEDBACK_ALREADY_SUBMITTED", "Feedback was already submitted for this Session and form version");
      throw error;
    }
  }

  private async teacherSession(user: AuthUser, sessionId: string) {
    if (user.accountType !== AccountType.TEACHER) apiError(403, "FORBIDDEN", "Teacher account required");
    const session = await this.prisma.workshopSession.findUnique({ where: { id: sessionId } });
    if (!session) apiError(404, "SESSION_NOT_FOUND", "Session not found");
    const membership = await this.prisma.workshopTeacher.findUnique({ where: { workshopId_teacherId: { workshopId: session.workshopId, teacherId: user.userId } } });
    if (!membership || !FEEDBACK_ROLES.includes(membership.role)) apiError(403, "FORBIDDEN", "Feedback access requires OWNER or INSTRUCTOR role");
    return session;
  }

  async raw(user: AuthUser, sessionId: string) {
    await this.teacherSession(user, sessionId);
    return this.prisma.feedbackSubmission.findMany({
      where: { sessionId },
      orderBy: { submittedAt: "desc" },
      include: {
        feedbackForm: { select: { stableId: true, version: true } },
        student: { select: { name: true, studentId: true } },
        responses: { include: { question: { select: { stableId: true, prompt: true, displayOrder: true } } }, orderBy: { question: { displayOrder: "asc" } } }
      }
    });
  }

  async summary(user: AuthUser, sessionId: string) {
    await this.teacherSession(user, sessionId);
    const submissions = await this.prisma.feedbackSubmission.findMany({
      where: { sessionId },
      include: { feedbackForm: true, responses: { include: { question: true } } },
      orderBy: { submittedAt: "desc" }
    });
    const distributions: Record<string, { prompt: string; options: Record<string, number> }> = {};
    const otherResponses: string[] = [];
    const suggestions: string[] = [];
    for (const submission of submissions) {
      for (const response of submission.responses) {
        const stableId = response.question.stableId;
        if (response.question.questionType === FeedbackQuestionType.SINGLE_CHOICE) {
          if (!distributions[stableId]) {
            const options = Array.isArray(response.question.options) ? response.question.options.map(String) : [];
            distributions[stableId] = { prompt: response.question.prompt, options: Object.fromEntries(options.map((option) => [option, 0])) };
          }
          if (response.selectedOption) distributions[stableId]!.options[response.selectedOption] = (distributions[stableId]!.options[response.selectedOption] ?? 0) + 1;
          if (response.otherText) otherResponses.push(response.otherText);
        } else if (response.textResponse) suggestions.push(response.textResponse);
      }
    }
    return {
      submissionCount: submissions.length,
      formVersions: [...new Set(submissions.map((submission) => `${submission.feedbackForm.stableId}@${submission.feedbackForm.version}`))],
      distributions,
      otherResponses,
      suggestions
    };
  }
}

@Controller("student")
@UseGuards(JwtAuthGuard)
@ApiTags("Feedback")
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: "Authentication required" })
@ApiForbiddenResponse({ description: "Student session access required" })
export class StudentFeedbackController {
  constructor(private readonly service: FeedbackService) {}
  @Get("sessions/:sessionId/feedback-form") form(@CurrentUser() user: AuthUser, @Param("sessionId") sessionId: string) { return this.service.form(user, sessionId); }
  @Post("sessions/:sessionId/feedback") @ApiBody({ type: FeedbackSubmissionDto }) submit(@CurrentUser() user: AuthUser, @Param("sessionId") sessionId: string, @Body() body: FeedbackSubmissionDto) { return this.service.submit(user, sessionId, body); }
}

@Controller("teacher")
@UseGuards(JwtAuthGuard)
@ApiTags("Feedback")
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: "Authentication required" })
@ApiForbiddenResponse({ description: "Workshop teacher access required" })
export class TeacherFeedbackController {
  constructor(private readonly service: FeedbackService) {}
  @Get("sessions/:sessionId/feedback") raw(@CurrentUser() user: AuthUser, @Param("sessionId") sessionId: string) { return this.service.raw(user, sessionId); }
  @Get("sessions/:sessionId/feedback/summary") summary(@CurrentUser() user: AuthUser, @Param("sessionId") sessionId: string) { return this.service.summary(user, sessionId); }
}
