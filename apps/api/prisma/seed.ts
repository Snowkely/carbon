import { PrismaClient, Prisma, AccountType, ContentStatus, FeedbackFormStatus, FeedbackQuestionType, QuestionType, AnswerMode, SourceType } from "@prisma/client";
import argon2 from "argon2";
import { createHash } from "node:crypto";

const prisma = new PrismaClient();
const sha = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

const cards = [
  ["M1-Q02", "M1-C01", "Natural gas burned in GreenThread-owned warehouse / 公司仓库天然气锅炉", "Scope 1", "Owned/controlled stationary combustion."],
  ["M1-Q03", "M1-C02", "Fuel used by company-owned delivery van / 自有配送车辆柴油", "Scope 1", "Owned mobile combustion."],
  ["M1-Q04", "M1-C03", "Electricity purchased for HQ or store / 门店或总部购买电力", "Scope 2", "Purchased electricity."],
  ["M1-Q05", "M1-C04", "Purchased district heat for HQ / 总部购买区域供热", "Scope 2", "Purchased heat."],
  ["M1-Q06", "M1-C05", "Cotton grown by independent farm / 独立农场种植棉花", "Scope 3", "Upstream purchased goods."],
  ["M1-Q07", "M1-C06", "Supplier factory natural gas for dyeing / 供应商染整厂天然气", "Scope 3", "Supplier emission outside GreenThread boundary."],
  ["M1-Q08", "M1-C07", "Contracted garment factory assembly / 外包服装厂组装", "Scope 3", "Contracted manufacturing in value chain."],
  ["M1-Q09", "M1-C08", "Third-party ocean freight / 第三方海运运输", "Scope 3", "Third-party transportation."],
  ["M1-Q10", "M1-C09", "Employee flight to supplier / 员工飞行拜访供应商", "Scope 3", "Business travel."],
  ["M1-Q11", "M1-C10", "Employee commuting / 员工通勤", "Scope 3", "Employee commuting."],
  ["M1-Q12", "M1-C11", "Customer washing/drying sold T-shirt / 消费者洗涤烘干售出T恤", "Scope 3", "Use of sold products."],
  ["M1-Q13", "M1-C12", "End-of-life treatment of sold T-shirt / 售出T恤废弃处理", "Scope 3", "End-of-life of sold products."]
] as const;

async function main() {
  const school = await prisma.school.upsert({
    where: { code: "CARBON-DEMO" },
    update: {},
    create: { code: "CARBON-DEMO", name: "Carbon Learning Academy" }
  });

  const classNames = ["Class A", "Class B", "Teachers Demo"];
  const classes = [];
  for (const name of classNames) {
    classes.push(await prisma.schoolClass.upsert({
      where: { schoolId_name: { schoolId: school.id, name } }, update: {}, create: { schoolId: school.id, name }
    }));
  }

  const passwordHash = await argon2.hash("Carbon123!", { type: argon2.argon2id });
  const teacher = await prisma.userAccount.upsert({
    where: { username: "teacher.demo" }, update: {},
    create: { username: "teacher.demo", passwordHash, accountType: AccountType.TEACHER }
  });
  await prisma.teacherProfile.upsert({
    where: { userId: teacher.id }, update: {}, create: { userId: teacher.id, schoolId: school.id, name: "Demo Teacher" }
  });

  for (const [index, username] of ["student.alex", "student.ben"].entries()) {
    const user = await prisma.userAccount.upsert({
      where: { username }, update: {}, create: { username, passwordHash, accountType: AccountType.STUDENT }
    });
    await prisma.studentProfile.upsert({
      where: { userId: user.id }, update: {},
      create: { userId: user.id, schoolId: school.id, classId: classes[0]!.id, studentId: `S100${index + 1}`, name: index === 0 ? "Alex Chen" : "Ben Lee" }
    });
  }

  const versionPayload = { code: "v5.0-phase1-final", missions: 6, scoring: "final-frozen-2026-09-04" };
  await prisma.gameContentVersion.updateMany({ where: { status: ContentStatus.PUBLISHED, versionCode: { not: versionPayload.code } }, data: { status: ContentStatus.ARCHIVED } });
  const contentVersion = await prisma.gameContentVersion.upsert({
    where: { versionCode: versionPayload.code }, update: {},
    create: { versionCode: versionPayload.code, status: ContentStatus.PUBLISHED, schemaVersion: "1.0", checksum: sha(versionPayload), publishedAt: new Date() }
  });

  const source = await prisma.contentSource.upsert({
    where: { id: "00000000-0000-4000-8000-000000000001" }, update: {},
    create: { id: "00000000-0000-4000-8000-000000000001", sourceType: SourceType.REAL_WORLD, name: "GHG Protocol Corporate Standard", url: "https://ghgprotocol.org/corporate-standard" }
  });

  const missionTitles = [
    ["M1", "排放从哪里来？", "Where Does Carbon Come From?"],
    ["M2", "计算碳足迹", "Build the Carbon Footprint"],
    ["M3", "碳定价拼图", "Carbon Pricing Puzzle"],
    ["M4", "构建 ETS", "Build an ETS"],
    ["M5", "你的第一次交易", "Your First Carbon Trade"],
    ["M6", "碳市场挑战", "Carbon Market Challenge"]
  ] as const;
  const missions = new Map<string, { id: string }>();
  for (const [index, [stableId, titleCn, titleEn]] of missionTitles.entries()) {
    const mission = await prisma.missionTemplate.upsert({
      where: { contentVersionId_stableId: { contentVersionId: contentVersion.id, stableId } }, update: {},
      create: { contentVersionId: contentVersion.id, stableId, sequenceNo: index + 1, titleCn, titleEn, displayConfig: stableId === "M6" ? { phase: "LOCKED_PLACEHOLDER", futureScoring: { roundWeights: { R1: 0.5, R2: 0.25, R3: 0.25 }, gameplayAvailable: false } } : { phase: stableId === "M1" ? "IMPLEMENTED" : "LOCKED_PLACEHOLDER" } }
    });
    missions.set(stableId, mission);
  }

  const m1 = missions.get("M1")!;
  const screenDefinitions = [
    ["M1-S01", "任务开始", "Mission Start"],
    ["M1-S02", "价值链地图", "Value Chain Map"],
    ["M1-S03", "Scope 判断镜", "Scope Lens"],
    ["M1-S04", "Round A", "Round A"],
    ["M1-S05", "Round B", "Round B"],
    ["M1-S06", "边界挑战", "Boundary Challenge"],
    ["M1-S07", "现实核对与反思", "Reality Check & Reflection"]
  ] as const;
  const screens = new Map<string, { id: string }>();
  for (const [index, [stableId, titleCn, titleEn]] of screenDefinitions.entries()) {
    const screen = await prisma.missionScreenTemplate.upsert({
      where: { missionTemplateId_stableId: { missionTemplateId: m1.id, stableId } }, update: {},
      create: { contentVersionId: contentVersion.id, missionTemplateId: m1.id, stableId, sequenceNo: index + 1, displayConfig: { titleCn, titleEn }, inputConfig: stableId === "M1-S02" ? { nodesRequired: 4, nodeIds: ["Raw materials", "Dyeing", "Assembly", "Logistics", "Retail", "Use phase", "End of life"] } : {}, progressionRuleRef: stableId === "M1-S02" ? "VIEWED_NODES_GTE_4" : null }
    });
    screens.set(stableId, screen);
  }

  const commonHints = { hint: "Use the Scope Lens: ownership/control first, then purchased energy, then the wider value chain." };
  const createQuestion = async (data: { stableId: string; screen: string; type: QuestionType; prompt: string; answer: unknown; baseScore: number; explanation: string; options?: unknown }) => {
    await prisma.questionTemplate.upsert({
      where: { contentVersionId_stableId: { contentVersionId: contentVersion.id, stableId: data.stableId } }, update: {},
      create: {
        contentVersionId: contentVersion.id, missionTemplateId: m1.id, screenTemplateId: screens.get(data.screen)!.id,
        stableId: data.stableId, questionType: data.type, answerMode: AnswerMode.EXACT, promptCn: data.prompt, promptEn: data.prompt,
        options: (data.options ?? (data.type === QuestionType.SC ? ["Scope 1", "Scope 2", "Scope 3"] : { destinations: ["Scope 1", "Scope 2", "Scope 3"] })) as Prisma.InputJsonValue,
        answerRule: { mode: "EXACT", answer: data.answer } as Prisma.InputJsonValue, baseScore: data.baseScore, hintConfig: commonHints,
        feedbackConfig: { correct: "Correct — the reporting boundary is decisive.", wrong: data.explanation, explanation: data.explanation }, sourceId: source.id, isSimulation: false
      }
    });
  };

  await createQuestion({ stableId: "M1-Q01", screen: "M1-S03", type: QuestionType.SC, prompt: "GreenThread-owned warehouse burns natural gas. Which Scope?", answer: "Scope 1", baseScore: 5, explanation: "Purchased fuel burned by an owned source is Scope 1." });
  for (const [index, [questionId, , prompt, answer, explanation]] of cards.entries()) {
    await createQuestion({ stableId: questionId, screen: index < 6 ? "M1-S04" : "M1-S05", type: QuestionType.DRAG, prompt, answer, baseScore: 6, explanation });
  }
  await createQuestion({ stableId: "M1-Q14", screen: "M1-S06", type: QuestionType.SC, prompt: "Third-party logistics before / after GreenThread buys and operates the trucks", answer: { before: "Scope 3", after: "Scope 1" }, baseScore: 8, explanation: "Organizational control changes the Scope.", options: [{ label: "Scope 3 → Scope 1", value: { before: "Scope 3", after: "Scope 1" } }, { label: "Scope 1 → Scope 3", value: { before: "Scope 1", after: "Scope 3" } }] });
  await createQuestion({ stableId: "M1-Q15", screen: "M1-S06", type: QuestionType.SC, prompt: "Purchased electricity in an owned warehouse", answer: "Scope 2", baseScore: 5, explanation: "Building ownership does not make purchased electricity Scope 1." });
  await createQuestion({ stableId: "M1-Q16", screen: "M1-S06", type: QuestionType.SC, prompt: "Independent dyeing mill burns gas: for the mill / for GreenThread", answer: { mill: "Scope 1", greenThread: "Scope 3" }, baseScore: 8, explanation: "The reporting entity changes the classification.", options: [{ label: "Mill Scope 1 / GreenThread Scope 3", value: { mill: "Scope 1", greenThread: "Scope 3" } }, { label: "Both Scope 1", value: { mill: "Scope 1", greenThread: "Scope 1" } }] });

  const gameConfig = { weights: { M1: 0.15, M2: 0.15, M3: 0.15, M4: 0.15, M5: 0.2, M6: 0.2 }, bands: [[90, "Carbon Market Navigator"], [80, "Carbon Trader"], [70, "Carbon Explorer"], [60, "Carbon Learner"], [0, "Review recommended before Level II"]] };
  await prisma.gameScoringConfig.upsert({
    where: { contentVersionId: contentVersion.id }, update: {},
    create: { contentVersionId: contentVersion.id, policySchemaVersion: "1.0", scoreScaleMin: 0, scoreScaleMax: 100, missionWeights: gameConfig.weights, levelBands: gameConfig.bands, roundingMode: "HALF_UP", decimalPlaces: 2, checksum: sha(gameConfig), publishedAt: new Date() }
  });

  const m1Scoring = {
    components: [
      { stableId: "SCAN", weightPoints: 8, normalization: "DIRECT", contributions: [{ sourceType: "ACTIVITY_COMPLETION", sourceRef: "M1-S02", rawMax: 3 }, { sourceType: "QUESTION_RESULT", sourceRef: "M1-Q01", rawMax: 5 }] },
      { stableId: "CARDS", weightPoints: 72, normalization: "DIRECT", contributions: cards.map(([questionId]) => ({ sourceType: "QUESTION_RESULT", sourceRef: questionId, rawMax: 6 })) },
      { stableId: "BOUNDARY", weightPoints: 10, normalization: "PROPORTIONAL", contributions: [{ sourceType: "QUESTION_RESULT", sourceRef: "M1-Q14", rawMax: 8 }, { sourceType: "QUESTION_RESULT", sourceRef: "M1-Q15", rawMax: 5 }, { sourceType: "QUESTION_RESULT", sourceRef: "M1-Q16", rawMax: 8 }] },
      { stableId: "REASONING_ASSISTANCE", weightPoints: 10, normalization: "DIRECT", contributions: [{ sourceType: "ACTIVITY_COMPLETION", sourceRef: "M1-S07", rawMax: 2 }, { sourceType: "BONUS_RULE", sourceRef: "M1_ASSISTANCE", rawMax: 8 }] }
    ],
    retry: { maxIndependentAttempts: 3, factors: [1, 0.9, 0.8], selection: "FIRST_CORRECT" },
    assistance: { noHint: 8, hintUsed: 6, reveal: 0 }, reveal: { afterFailures: 3, factor: 0.5 },
    completion: { minimumScore: null, required: ["M1-S02", "M1-Q01", "M1-Q02..M1-Q13", "M1-Q14..M1-Q16", "M1-S07"] }
  };
  await prisma.missionScoringConfig.upsert({
    where: { contentVersionId_missionTemplateId: { contentVersionId: contentVersion.id, missionTemplateId: m1.id } }, update: {},
    create: { contentVersionId: contentVersion.id, missionTemplateId: m1.id, policySchemaVersion: "1.0", componentDefinitions: m1Scoring.components, retryPolicy: m1Scoring.retry, assistancePolicy: m1Scoring.assistance, revealPolicy: m1Scoring.reveal, completionPolicy: m1Scoring.completion, adjustmentBounds: { question: "0..v5BaseScore", mission: [0, 100], finalTotal: [0, 100] }, roundingMode: "HALF_UP", decimalPlaces: 2, checksum: sha(m1Scoring), publishedAt: new Date() }
  });

  const m6 = missions.get("M6")!;
  const m6Scoring = {
    components: [
      { stableId: "R1", weightPoints: 50, normalization: "PROPORTIONAL", contributions: [], mappingStatus: "DEFERRED_OUTSIDE_PHASE_1" },
      { stableId: "R2", weightPoints: 25, normalization: "PROPORTIONAL", contributions: [], mappingStatus: "DEFERRED_OUTSIDE_PHASE_1" },
      { stableId: "R3", weightPoints: 25, normalization: "PROPORTIONAL", contributions: [], mappingStatus: "DEFERRED_OUTSIDE_PHASE_1" }
    ],
    retry: { status: "UNRESOLVED_FUTURE_STRATEGY_POLICY" }, assistance: { status: "UNRESOLVED_FUTURE_POLICY" }, reveal: { status: "NOT_APPLICABLE_PHASE_1" }, completion: { status: "GAMEPLAY_DEFERRED" }
  };
  await prisma.missionScoringConfig.upsert({
    where: { contentVersionId_missionTemplateId: { contentVersionId: contentVersion.id, missionTemplateId: m6.id } }, update: {},
    create: { contentVersionId: contentVersion.id, missionTemplateId: m6.id, policySchemaVersion: "1.0", componentDefinitions: m6Scoring.components, retryPolicy: m6Scoring.retry, assistancePolicy: m6Scoring.assistance, revealPolicy: m6Scoring.reveal, completionPolicy: m6Scoring.completion, adjustmentBounds: { mission: [0, 100] }, roundingMode: "HALF_UP", decimalPlaces: 2, checksum: sha(m6Scoring), publishedAt: new Date() }
  });

  const feedbackForm = await prisma.feedbackForm.upsert({
    where: { stableId_version: { stableId: "POST_WORKSHOP_FEEDBACK", version: 1 } },
    update: {},
    create: { stableId: "POST_WORKSHOP_FEEDBACK", version: 1, status: FeedbackFormStatus.PUBLISHED, publishedAt: new Date() }
  });
  const feedbackQuestions = [
    { stableId: "FB-Q01", questionType: FeedbackQuestionType.SINGLE_CHOICE, prompt: "How would you rate your overall experience with the Carbon Trader learning activity?", options: ["Excellent", "Very good", "Good", "Fair", "Poor"], validationConfig: { required: true } },
    { stableId: "FB-Q02", questionType: FeedbackQuestionType.SINGLE_CHOICE, prompt: "What was the most valuable part of the Carbon Trader learning activity for you?", options: ["Understanding how carbon markets work", "Making strategic business decisions", "Negotiating and interacting with other players", "Understanding the trade-offs between carbon reduction, cost, and compliance", "Experiencing sustainability learning in a more interactive way", "Other"], validationConfig: { required: true, otherOption: "Other", otherTextRequired: true } },
    { stableId: "FB-Q03", questionType: FeedbackQuestionType.SINGLE_CHOICE, prompt: "Would you be interested in participating in similar sustainability game-based learning activities in the future?", options: ["Definitely yes", "Probably yes", "Not sure", "Probably not", "Definitely not"], validationConfig: { required: true } },
    { stableId: "FB-Q04", questionType: FeedbackQuestionType.OPEN_TEXT, prompt: "Do you have any suggestions for improving the Carbon Trader learning activity?", options: null, validationConfig: { required: false, multiline: true, semanticScoring: false } }
  ];
  for (const [index, question] of feedbackQuestions.entries()) {
    await prisma.feedbackQuestion.upsert({
      where: { feedbackFormId_stableId: { feedbackFormId: feedbackForm.id, stableId: question.stableId } },
      update: {},
      create: { feedbackFormId: feedbackForm.id, stableId: question.stableId, questionType: question.questionType, prompt: question.prompt, displayOrder: index + 1, options: question.options ?? Prisma.JsonNull, validationConfig: question.validationConfig }
    });
  }

  console.log("Seed complete. Accounts: teacher.demo, student.alex, student.ben / Carbon123!");
}

main().finally(() => prisma.$disconnect());
