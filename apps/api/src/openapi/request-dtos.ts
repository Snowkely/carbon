import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { AccountType, ScoreTargetLevel, WorkshopRole } from "@prisma/client";

export class RegisterDto {
  @ApiProperty({ type: String, example: "student.demo", minLength: 3, maxLength: 80 })
  username!: string;

  @ApiProperty({ type: String, example: "example-password", minLength: 8, maxLength: 128, writeOnly: true })
  password!: string;

  @ApiProperty({ type: String, enum: AccountType, example: AccountType.STUDENT })
  accountType!: AccountType;
}

export class LoginDto {
  @ApiProperty({ type: String, example: "teacher.demo", minLength: 3, maxLength: 80 })
  username!: string;

  @ApiProperty({ type: String, example: "example-password", minLength: 8, maxLength: 128, writeOnly: true })
  password!: string;
}

export class RefreshTokenDto {
  @ApiProperty({ type: String, example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." })
  refreshToken!: string;
}

export class LogoutDto {
  @ApiPropertyOptional({ type: String, example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." })
  refreshToken?: string;
}

export class StudentProfileDto {
  @ApiProperty({ type: String, example: "Alex", minLength: 1, maxLength: 150 })
  name!: string;

  @ApiProperty({ type: String, example: "S001", minLength: 1, maxLength: 100 })
  studentId!: string;

  @ApiProperty({ type: String, example: "11111111-1111-4111-8111-111111111111", format: "uuid" })
  schoolId!: string;

  @ApiProperty({ type: String, example: "22222222-2222-4222-8222-222222222222", format: "uuid" })
  classId!: string;
}

export class ValueChainNodeDto {
  @ApiProperty({ type: String, example: "M1-N01" })
  nodeId!: string;
}

export class ReflectionDto {
  @ApiProperty({ type: String, example: "Ownership and operational control determine the reporting scope.", minLength: 1, maxLength: 4000 })
  response!: string;
}

export class AnswerSubmissionDto {
  clientSubmissionId!: string;

  answer!: unknown;

  timeSpentMs!: number;
}

export class FeedbackResponseDto {
  @ApiProperty({ type: String, enum: ["FB-Q01", "FB-Q02", "FB-Q03", "FB-Q04"], example: "FB-Q01" })
  questionStableId!: "FB-Q01" | "FB-Q02" | "FB-Q03" | "FB-Q04";

  @ApiPropertyOptional({ type: String, example: "Excellent", maxLength: 300 })
  selectedOption?: string;

  @ApiPropertyOptional({ type: String, example: "Understanding practical compliance decisions", maxLength: 2000 })
  otherText?: string;

  @ApiPropertyOptional({ type: String, example: "More time for the trading activity.", maxLength: 4000 })
  textResponse?: string;
}

export class FeedbackSubmissionDto {
  @ApiProperty({
    type: () => [FeedbackResponseDto],
    minItems: 4,
    maxItems: 4,
    example: [
      { questionStableId: "FB-Q01", selectedOption: "Excellent" },
      { questionStableId: "FB-Q02", selectedOption: "Other", otherText: "Understanding practical compliance decisions" },
      { questionStableId: "FB-Q03", selectedOption: "Definitely yes" },
      { questionStableId: "FB-Q04", textResponse: "More time for the trading activity." }
    ]
  })
  responses!: FeedbackResponseDto[];
}

export class CreateWorkshopDto {
  @ApiProperty({ type: String, example: "GreenThread Workshop" })
  name!: string;

  @ApiProperty({ type: String, example: "44444444-4444-4444-8444-444444444444", format: "uuid" })
  contentVersionId!: string;

  @ApiProperty({ type: String, example: "11111111-1111-4111-8111-111111111111", format: "uuid" })
  schoolId!: string;

  @ApiPropertyOptional({
    description: "Controlled classes in the school. Omit or send an empty array for a whole-school audience.",
    example: ["22222222-2222-4222-8222-222222222222"],
    type: [String],
    format: "uuid"
  })
  classIds?: string[];
}

export class UpdateWorkshopDto {
  @ApiProperty({ type: String, example: "GreenThread Workshop — Group A" })
  name!: string;
}

export class SetWorkshopTeacherDto {
  @ApiProperty({ type: String, example: "teacher.demo" })
  username!: string;

  @ApiProperty({ type: String, enum: WorkshopRole, example: WorkshopRole.INSTRUCTOR })
  role!: WorkshopRole;
}

export class CreateSessionDto {
  @ApiPropertyOptional({ type: String, example: "2026-09-10T09:00:00.000Z", format: "date-time" })
  scheduledAt?: string;
}

export class ScoreAdjustmentDto {
  @ApiProperty({ type: String, enum: ScoreTargetLevel, example: ScoreTargetLevel.QUESTION })
  targetLevel!: ScoreTargetLevel;

  @ApiProperty({ type: String, example: "55555555-5555-4555-8555-555555555555", format: "uuid" })
  targetId!: string;

  @ApiProperty({ type: Number, example: 80, minimum: 0, description: "Must not exceed the target's applicable maximum score." })
  adjustedScore!: number;

  @ApiProperty({ type: String, example: "Manual review confirmed partial credit." })
  reason!: string;

  @ApiProperty({
    description: "Currently effective adjustment ID, or null for the first adjustment. Always supply this field.",
    example: null,
    format: "uuid",
    nullable: true,
    type: String
  })
  expectedSupersedesAdjustmentId!: string | null;
}
