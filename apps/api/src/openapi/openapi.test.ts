import { Module, type INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from "@nestjs/swagger";
import type { OperationObject, ReferenceObject, SchemaObject } from "@nestjs/swagger/dist/interfaces/open-api-spec.interface";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AuthController, AuthService } from "../auth/auth";
import { FeedbackService, StudentFeedbackController, TeacherFeedbackController } from "../feedback/feedback";
import { StudentController, StudentService } from "../student/student";
import { TeacherController, TeacherService } from "../teacher/teacher";

@Module({
  controllers: [AuthController, StudentController, StudentFeedbackController, TeacherController, TeacherFeedbackController],
  providers: [
    { provide: AuthService, useValue: {} },
    { provide: StudentService, useValue: {} },
    { provide: FeedbackService, useValue: {} },
    { provide: TeacherService, useValue: {} }
  ]
})
class OpenApiTestModule {}

const operationAt = (document: OpenAPIObject, path: string, method: "post" | "put" | "patch"): OperationObject => {
  const operation = document.paths[path]?.[method];
  expect(operation, `${method.toUpperCase()} ${path} is missing`).toBeDefined();
  return operation!;
};

const requestSchemaAt = (document: OpenAPIObject, path: string, method: "post" | "put" | "patch"): SchemaObject => {
  const requestBody = operationAt(document, path, method).requestBody;
  expect(requestBody, `${method.toUpperCase()} ${path} has no requestBody`).toBeDefined();
  expect("$ref" in requestBody! ? undefined : requestBody!.content["application/json"]).toBeDefined();
  const schema = "$ref" in requestBody! ? undefined : requestBody!.content["application/json"]?.schema;
  expect(schema).toBeDefined();
  if ("$ref" in schema!) {
    const name = (schema as ReferenceObject).$ref.split("/").at(-1)!;
    const resolved = document.components?.schemas?.[name];
    expect(resolved, `Referenced schema ${name} is missing`).toBeDefined();
    expect("$ref" in resolved! ? undefined : resolved).toBeDefined();
    return resolved as SchemaObject;
  }
  return schema as SchemaObject;
};

describe("Phase 1 OpenAPI request bodies", () => {
  let app: INestApplication;
  let document: OpenAPIObject;

  beforeAll(async () => {
    app = await NestFactory.create(OpenApiTestModule, { logger: false });
    app.setGlobalPrefix("v1");
    const config = new DocumentBuilder().setTitle("Carbon Trader I API").setVersion("1.0").addBearerAuth().build();
    document = SwaggerModule.createDocument(app, config);
  });

  afterAll(async () => {
    await app.close();
  });

  it("documents auth request bodies with their required fields", () => {
    expect(requestSchemaAt(document, "/v1/auth/login", "post").required).toEqual(expect.arrayContaining(["username", "password"]));
    expect(requestSchemaAt(document, "/v1/auth/register", "post").required).toEqual(expect.arrayContaining(["username", "password", "accountType"]));
    expect(requestSchemaAt(document, "/v1/auth/refresh", "post").properties).toHaveProperty("refreshToken");
    expect(requestSchemaAt(document, "/v1/auth/logout", "post").properties).toHaveProperty("refreshToken");
  });

  it("documents the student profile and gameplay request bodies", () => {
    expect(requestSchemaAt(document, "/v1/student/profile", "put").required).toEqual(expect.arrayContaining(["name", "studentId", "schoolId", "classId"]));
    expect(requestSchemaAt(document, "/v1/student/mission-attempts/{missionAttemptId}/value-chain/nodes", "post").properties).toHaveProperty("nodeId");
    expect(requestSchemaAt(document, "/v1/student/mission-attempts/{missionAttemptId}/reflection", "post").properties).toHaveProperty("response");

    const submission = requestSchemaAt(document, "/v1/student/mission-attempts/{missionAttemptId}/questions/{questionTemplateId}/submissions", "post");
    expect(submission.required).toEqual(expect.arrayContaining(["clientSubmissionId", "answer", "timeSpentMs"]));
    expect(submission.properties?.answer).toMatchObject({ nullable: true });
    expect((submission.properties?.answer as SchemaObject).oneOf).toHaveLength(5);
  });

  it("documents feedback as a four-response array", () => {
    const feedback = requestSchemaAt(document, "/v1/student/sessions/{sessionId}/feedback", "post");
    expect(feedback.required).toContain("responses");
    expect(feedback.properties?.responses).toMatchObject({ type: "array", minItems: 4, maxItems: 4 });
  });

  it("documents every teacher mutation body", () => {
    expect(requestSchemaAt(document, "/v1/teacher/workshops", "post").required).toEqual(expect.arrayContaining(["name", "contentVersionId", "schoolId"]));
    expect(requestSchemaAt(document, "/v1/teacher/workshops/{workshopId}", "patch").properties).toHaveProperty("name");
    expect(requestSchemaAt(document, "/v1/teacher/workshops/{workshopId}/teachers", "put").required).toEqual(expect.arrayContaining(["username", "role"]));
    expect(requestSchemaAt(document, "/v1/teacher/workshops/{workshopId}/sessions", "post").properties).toHaveProperty("scheduledAt");

    const adjustment = requestSchemaAt(document, "/v1/teacher/score-adjustments", "post");
    expect(adjustment.required).toEqual(expect.arrayContaining(["targetLevel", "targetId", "adjustedScore", "reason", "expectedSupersedesAdjustmentId"]));
  });
});
