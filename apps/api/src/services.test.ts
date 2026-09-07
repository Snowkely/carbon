import { createHash } from "node:crypto";
import { HttpException } from "@nestjs/common";
import { AccountType, AttemptStatus, SessionStatus, UnlockSource, WorkshopRole, WorkshopStatus } from "@prisma/client";
import argon2 from "argon2";
import { describe, expect, it, vi } from "vitest";
import { AuthService } from "./auth/auth";
import { StudentService } from "./student/student";
import { ScoringService } from "./student/scoring.service";
import { TeacherService } from "./teacher/teacher";

const student = { userId: "student-1", username: "student.alex", accountType: AccountType.STUDENT };
const teacher = { userId: "teacher-1", username: "teacher.demo", accountType: AccountType.TEACHER };
const responseCode = (error: unknown) => (error as HttpException).getResponse() as { error: { code: string } };

function studentPrisma(sessionStatus: SessionStatus, attempts: Array<{ id:string; missionTemplateId:string; status:AttemptStatus }>, unlockMissionIds = ["m1", "m2"]) {
  return {
    workshopParticipant: { findUnique: vi.fn().mockResolvedValue({ id:"participant-1", studentId:student.userId, session:{ id:"session-1", status:sessionStatus, workshop:{ contentVersionId:"v1" } } }) },
    missionTemplate: { findMany: vi.fn().mockResolvedValue([
      { id:"m1", stableId:"M1", titleCn:"边界侦探", titleEn:"Boundary Detective", sequenceNo:1 },
      { id:"m2", stableId:"M2", titleCn:"碳足迹", titleEn:"Build the Carbon Footprint", sequenceNo:2 }
    ]) },
    missionUnlock: { findMany: vi.fn().mockResolvedValue(unlockMissionIds.map((missionTemplateId,index)=>({ missionTemplateId, unlockSource:index===0?"INITIAL":"TEACHER" }))) },
    missionAttempt: { findMany: vi.fn().mockResolvedValue(attempts) }
  } as any;
}

describe("Mission availability Option B", () => {
  it("makes M2 AVAILABLE only with teacher unlock and completed M1, without enabling Phase 2 gameplay", async () => {
    const service = new StudentService(studentPrisma(SessionStatus.ACTIVE, [{ id:"ma1", missionTemplateId:"m1", status:AttemptStatus.COMPLETED }]), {} as any);
    const missions = await service.missions(student, "session-1");
    expect(missions[1]).toMatchObject({ accessState:"AVAILABLE", progressState:"NOT_STARTED", reason:"GAMEPLAY_DEFERRED_PHASE_1", capabilities:{ canStartAttempt:false } });
  });

  it("keeps M2 prerequisite-blocked when M1 is not complete", async () => {
    const service = new StudentService(studentPrisma(SessionStatus.ACTIVE, [{ id:"ma1", missionTemplateId:"m1", status:AttemptStatus.IN_PROGRESS }]), {} as any);
    const missions = await service.missions(student, "session-1");
    expect(missions[1]).toMatchObject({ accessState:"BLOCKED_PREREQUISITE", reason:"PREREQUISITE_NOT_COMPLETED" });
  });

  it("keeps M3 prerequisite-blocked after an early Teacher unlock when M2 is incomplete", async () => {
    const prisma:any=studentPrisma(SessionStatus.ACTIVE, [{ id:"ma1", missionTemplateId:"m1", status:AttemptStatus.COMPLETED }], ["m1","m3"]);
    prisma.missionTemplate.findMany=vi.fn().mockResolvedValue([
      { id:"m1", stableId:"M1", titleCn:"边界侦探", titleEn:"Boundary Detective", sequenceNo:1 },
      { id:"m2", stableId:"M2", titleCn:"碳足迹", titleEn:"Build the Carbon Footprint", sequenceNo:2 },
      { id:"m3", stableId:"M3", titleCn:"碳定价", titleEn:"Carbon Pricing Puzzle", sequenceNo:3 }
    ]);
    const missions=await new StudentService(prisma,{} as any).missions(student,"session-1");
    expect(missions[2]).toMatchObject({sessionUnlock:{state:"UNLOCKED_FOR_SESSION",source:"TEACHER"},progressState:"NOT_STARTED",accessState:"BLOCKED_PREREQUISITE",reason:"PREREQUISITE_NOT_COMPLETED",capabilities:{canStartAttempt:false}});
  });

  it("returns the existing active MissionAttempt as the only resumable M1 entry", async () => {
    const service = new StudentService(studentPrisma(SessionStatus.ACTIVE, [{ id:"ma-existing", missionTemplateId:"m1", status:AttemptStatus.IN_PROGRESS }]), {} as any);
    const [m1] = await service.missions(student, "session-1");
    expect(m1).toMatchObject({
      progressState:"IN_PROGRESS",
      accessState:"ACTIVE_ATTEMPT",
      activeMissionAttemptId:"ma-existing",
      capabilities:{ canStartAttempt:false, canContinueAttempt:true, canSubmitAnswer:true }
    });
  });

  it("separates historical completion from gameplay capability after Session end", async () => {
    const service = new StudentService(studentPrisma(SessionStatus.ENDED, [{ id:"ma1", missionTemplateId:"m1", status:AttemptStatus.COMPLETED }]), {} as any);
    const [m1,m2] = await service.missions(student, "session-1");
    expect(m1).toMatchObject({ progressState:"COMPLETED", accessState:"COMPLETED_READ_ONLY", capabilities:{ canStartAttempt:false, canContinueAttempt:false, canSubmitAnswer:false } });
    expect(m2?.capabilities).toEqual({ canStartAttempt:false, canContinueAttempt:false, canSubmitAnswer:false });
  });
});

describe("student mutation invariants", () => {
  it("does not create a second MissionAttempt when M1 is already IN_PROGRESS", async () => {
    const prisma:any=studentPrisma(SessionStatus.ACTIVE, [{ id:"ma-existing", missionTemplateId:"m1", status:AttemptStatus.IN_PROGRESS }]);
    prisma.missionTemplate.findUnique=vi.fn().mockResolvedValue({id:"m1",stableId:"M1"});
    prisma.missionScreenTemplate={findFirstOrThrow:vi.fn()};
    prisma.$transaction=vi.fn();

    await expect(new StudentService(prisma,{} as any).startAttempt(student,"session-1","m1")).rejects.toSatisfy((error:unknown)=>responseCode(error).error.code==="MISSION_LOCKED");
    expect(prisma.missionScreenTemplate.findFirstOrThrow).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("persists one Mission-level Hint flag without changing Question score", async () => {
    const update=vi.fn().mockResolvedValue({});
    const prisma:any={missionAttempt:{findFirst:vi.fn().mockResolvedValue({id:"ma1",missionTemplateId:"m1",status:AttemptStatus.IN_PROGRESS,runtimeState:{hintUsed:false},attempt:{participant:{id:"p1",studentId:student.userId,session:{status:SessionStatus.ACTIVE}}},mission:{stableId:"M1"},currentScreen:null}),update},questionTemplate:{findUnique:vi.fn().mockResolvedValue({id:"q1",missionTemplateId:"m1",hintConfig:{hint:"Use the Scope Lens."}})},workshopParticipant:{update},$transaction:vi.fn(async(values:any[])=>Promise.all(values))};
    const result=await new StudentService(prisma,{} as any).hint(student,"ma1","q1");
    expect(result).toEqual({hint:"Use the Scope Lens.",hintUsed:true,questionScorePenalty:0});
    expect(update.mock.calls[0]![0].data.runtimeState).toMatchObject({hintUsed:true});
  });

  it("returns an idempotent submission before reevaluating it", async () => {
    const input = { clientSubmissionId:"a05c4b12-1e83-4b9f-9c9e-9195e579fc68", answer:"Scope 1", timeSpentMs:1000 };
    const requestHash=createHash("sha256").update(JSON.stringify(input)).digest("hex");
    const prisma:any={
      missionAttempt:{findFirst:vi.fn().mockResolvedValue({id:"ma1",missionTemplateId:"m1",status:AttemptStatus.IN_PROGRESS,attempt:{participant:{id:"p1",studentId:student.userId,session:{status:SessionStatus.ACTIVE}}},mission:{stableId:"M1"},currentScreen:null})},
      questionAttempt:{findUnique:vi.fn().mockResolvedValue({missionAttemptId:"ma1",questionTemplateId:"q1",requestHash,questionAttemptNo:1,candidateSystemScore:5,evaluatedResult:{correct:true},feedbackSnapshot:{correct:"Correct",explanation:"Owned source"}})},questionResult:{findUnique:vi.fn().mockResolvedValue({scoringPolicySnapshot:{reveal:{afterFailures:3}}})},
      questionTemplate:{findUnique:vi.fn()}
    };
    const result=await new StudentService(prisma,{} as any).submit(student,"ma1","q1",input);
    expect(result).toMatchObject({idempotent:true,attemptNumber:1,correct:true,score:5,finalized:true,feedback:"Correct"});
    expect(prisma.questionTemplate.findUnique).not.toHaveBeenCalled();
  });

  it("does not let an idempotency key cross MissionAttempt ownership boundaries", async () => {
    const input={clientSubmissionId:"a05c4b12-1e83-4b9f-9c9e-9195e579fc68",answer:"Scope 1",timeSpentMs:1000};
    const requestHash=createHash("sha256").update(JSON.stringify(input)).digest("hex");
    const prisma:any={missionAttempt:{findFirst:vi.fn().mockResolvedValue({id:"ma1",missionTemplateId:"m1",status:AttemptStatus.IN_PROGRESS,attempt:{participant:{id:"p1",studentId:student.userId,session:{status:SessionStatus.ACTIVE}}},mission:{stableId:"M1"},currentScreen:null})},questionAttempt:{findUnique:vi.fn().mockResolvedValue({missionAttemptId:"someone-elses-attempt",questionTemplateId:"q1",requestHash})}};
    await expect(new StudentService(prisma,{} as any).submit(student,"ma1","q1",input)).rejects.toSatisfy((error:unknown)=>responseCode(error).error.code==="IDEMPOTENCY_CONFLICT");
  });

  it("rejects a fourth independent attempt", async () => {
    const prisma:any={
      missionAttempt:{findFirst:vi.fn().mockResolvedValue({id:"ma1",missionTemplateId:"m1",status:AttemptStatus.IN_PROGRESS,attempt:{participant:{id:"p1",studentId:student.userId,session:{status:SessionStatus.ACTIVE}}},mission:{stableId:"M1"},currentScreen:null})},
      questionAttempt:{findUnique:vi.fn().mockResolvedValue(null),count:vi.fn().mockResolvedValue(3)},
      questionTemplate:{findUnique:vi.fn().mockResolvedValue({id:"q1",missionTemplateId:"m1"})},
      questionResult:{findUnique:vi.fn().mockResolvedValue(null)},missionScoringConfig:{findUniqueOrThrow:vi.fn().mockResolvedValue({retryPolicy:{maxIndependentAttempts:3,factors:[1,.9,.8]}})}
    };
    await expect(new StudentService(prisma,{} as any).submit(student,"ma1","q1",{clientSubmissionId:"a05c4b12-1e83-4b9f-9c9e-9195e579fc68",answer:"x",timeSpentMs:1})).rejects.toSatisfy((error:unknown)=>responseCode(error).error.code==="MAX_ATTEMPTS_REACHED");
  });

  it("server-evaluates and selects the first correct retry using the snapshotted versioned policy", async () => {
    const upsert=vi.fn().mockResolvedValue({});const tx:any={questionAttempt:{create:vi.fn().mockResolvedValue({id:"qa2"})},questionResult:{upsert},workshopParticipant:{update:vi.fn().mockResolvedValue({})}};
    const prisma:any={missionAttempt:{findFirst:vi.fn().mockResolvedValue({id:"ma1",missionTemplateId:"m1",status:AttemptStatus.IN_PROGRESS,runtimeState:{hintUsed:true},attempt:{participant:{id:"p1",studentId:student.userId,session:{status:SessionStatus.ACTIVE}}},mission:{stableId:"M1",contentVersionId:"v1"},currentScreen:null})},questionAttempt:{findUnique:vi.fn().mockResolvedValue(null),count:vi.fn().mockResolvedValue(1)},questionTemplate:{findUnique:vi.fn().mockResolvedValue({id:"q1",stableId:"M1-Q02",missionTemplateId:"m1",contentVersionId:"v1",baseScore:6,promptCn:"?",promptEn:"?",options:["Scope 1","Scope 2"],answerRule:{mode:"EXACT",answer:"Scope 1"},hintConfig:{},feedbackConfig:{correct:"Correct",wrong:"Try again",explanation:"Owned source"}})},questionResult:{findUnique:vi.fn().mockResolvedValue(null)},missionScoringConfig:{findUniqueOrThrow:vi.fn().mockResolvedValue({id:"cfg",checksum:"a".repeat(64),retryPolicy:{maxIndependentAttempts:3,factors:[1,.9,.8],selection:"FIRST_CORRECT"},assistancePolicy:{noHint:8,hintUsed:6,reveal:0},revealPolicy:{afterFailures:3,factor:.5}})},$transaction:vi.fn(async(callback:any)=>callback(tx))};
    const result=await new StudentService(prisma,{} as any).submit(student,"ma1","q1",{clientSubmissionId:"a05c4b12-1e83-4b9f-9c9e-9195e579fc68",answer:"Scope 1",timeSpentMs:10});
    expect(result).toMatchObject({attemptNumber:2,correct:true,score:5.4,finalized:true});
    expect(upsert.mock.calls[0]![0].create).toMatchObject({selectedQuestionAttemptId:"qa2",systemScore:5.4,v5BaseScore:6});
    expect(tx.questionAttempt.create.mock.calls[0]![0].data.hintUsage).toEqual({hintUsed:true});
  });

  it("blocks gameplay mutation when the Session is ENDED", async () => {
    const prisma:any={missionAttempt:{findFirst:vi.fn().mockResolvedValue({id:"ma1",runtimeState:{},attempt:{participant:{id:"p1",studentId:student.userId,session:{status:SessionStatus.ENDED}}},mission:{},currentScreen:null})}};
    await expect(new StudentService(prisma,{} as any).viewNode(student,"ma1",{nodeId:"Dyeing"})).rejects.toSatisfy((error:unknown)=>responseCode(error).error.code==="SESSION_INACTIVE");
  });

  it("hydrates the persisted screen, viewed nodes, and Question history without exposing answer rules", async () => {
    const prisma:any={
      missionAttempt:{findFirst:vi.fn().mockResolvedValue({id:"ma1",missionTemplateId:"m1",status:AttemptStatus.IN_PROGRESS,runtimeState:{viewedNodes:["Dyeing"],hintUsed:true,revealUsed:false,reflection:null},attempt:{participant:{id:"p1",studentId:student.userId,session:{status:SessionStatus.ACTIVE}}},mission:{stableId:"M1",contentVersionId:"v1"},currentScreen:{id:"s2",stableId:"M1-S02"}})},
      questionTemplate:{findMany:vi.fn().mockResolvedValue([{id:"q1",stableId:"M1-Q01",screenTemplateId:"s3",questionType:"SC",promptCn:"?",promptEn:"?",options:["Scope 1"],baseScore:5,answerRule:{mode:"EXACT",answer:"Scope 1"},results:[{status:"FINALIZED",systemScore:4.5,resolutionMode:"INDEPENDENT"}],attempts:[{questionAttemptNo:1},{questionAttemptNo:2}]}])},missionScoringConfig:{findUniqueOrThrow:vi.fn().mockResolvedValue({revealPolicy:{afterFailures:3}})}
    };
    const result=await new StudentService(prisma,{} as any).attempt(student,"ma1");
    expect(result).toMatchObject({
      id:"ma1",
      status:AttemptStatus.IN_PROGRESS,
      currentScreen:{stableId:"M1-S02"},
      runtimeState:{viewedNodes:["Dyeing"],hintUsed:true,revealUsed:false},
      questions:[{stableId:"M1-Q01",attemptsUsed:2,finalized:true,score:4.5}]
    });
    expect(result.questions[0]).not.toHaveProperty("answerRule");
    expect(JSON.stringify(result)).not.toContain('"answer":"Scope 1"');
  });

  it("keeps hidden answer rules out of Student history", async () => {
    const prisma:any={attempt:{findMany:vi.fn().mockResolvedValue([{id:"a1",attemptNo:1,status:AttemptStatus.IN_PROGRESS,systemTotalScore:null,startedAt:new Date(),completedAt:null,participant:{session:{id:"s1",status:SessionStatus.ACTIVE,workshop:{id:"w1",name:"Lab"}}},missionAttempts:[{id:"ma1",status:AttemptStatus.IN_PROGRESS,systemScore:null,completedAt:null,mission:{stableId:"M1",titleCn:"M1",titleEn:"M1"},questionResults:[{status:"PENDING",systemScore:null,resolutionMode:null,question:{stableId:"M1-Q01",answerRule:{mode:"EXACT",answer:"Scope 1"}}}]}] }])}};
    const result=await new StudentService(prisma,{} as any).history(student);
    expect(result[0]).toMatchObject({attemptNo:1,session:{status:SessionStatus.ACTIVE,workshop:{name:"Lab"}},missionAttempts:[{status:AttemptStatus.IN_PROGRESS,completedAt:null}]});
    expect(JSON.stringify(result)).not.toContain("answerRule");
    expect(JSON.stringify(result)).not.toContain("Scope 1");
  });

  it("offers Reveal after three failures and snapshots a 50% score", async () => {
    const tx:any={questionAttempt:{create:vi.fn().mockResolvedValue({id:"qa4"})},questionResult:{update:vi.fn().mockResolvedValue({})},missionAttempt:{update:vi.fn().mockResolvedValue({})},workshopParticipant:{update:vi.fn().mockResolvedValue({})}};
    const prisma:any={
      missionAttempt:{findFirst:vi.fn().mockResolvedValue({id:"ma1",missionTemplateId:"m1",status:AttemptStatus.IN_PROGRESS,runtimeState:{},attempt:{participant:{id:"p1",studentId:student.userId,session:{status:SessionStatus.ACTIVE}}},mission:{stableId:"M1",contentVersionId:"v1"},currentScreen:null})},
      questionTemplate:{findUnique:vi.fn().mockResolvedValue({id:"q1",stableId:"M1-Q02",missionTemplateId:"m1",contentVersionId:"v1",baseScore:6,promptCn:"?",promptEn:"?",options:["Scope 1"],answerRule:{mode:"EXACT",answer:"Scope 1"},feedbackConfig:{explanation:"Owned source"}})},
      questionAttempt:{count:vi.fn().mockResolvedValue(3)},questionResult:{findUnique:vi.fn().mockResolvedValue({status:"PENDING"})},missionScoringConfig:{findUniqueOrThrow:vi.fn().mockResolvedValue({id:"cfg",checksum:"a".repeat(64),retryPolicy:{},assistancePolicy:{},revealPolicy:{factor:.5}})},$transaction:vi.fn(async(callback:any)=>callback(tx))
    };
    const result=await new StudentService(prisma,{} as any).reveal(student,"ma1","q1");
    expect(result).toMatchObject({finalized:true,resolutionMode:"REVEALED",score:3,revealedAnswer:"Scope 1"});
    expect(tx.questionAttempt.create.mock.calls[0][0].data).toMatchObject({questionAttemptNo:4,resolutionMode:"REVEALED",revealUsed:true,independentlyCorrect:false,candidateSystemScore:3});
  });

  it("keeps Reveal unavailable before the configured failure threshold", async () => {
    const prisma:any={missionAttempt:{findFirst:vi.fn().mockResolvedValue({id:"ma1",missionTemplateId:"m1",status:AttemptStatus.IN_PROGRESS,runtimeState:{},attempt:{participant:{id:"p1",studentId:student.userId,session:{status:SessionStatus.ACTIVE}}},mission:{stableId:"M1",contentVersionId:"v1"},currentScreen:null})},questionTemplate:{findUnique:vi.fn().mockResolvedValue({id:"q1",missionTemplateId:"m1",contentVersionId:"v1"})},missionScoringConfig:{findUniqueOrThrow:vi.fn().mockResolvedValue({revealPolicy:{afterFailures:3,factor:.5}})},questionAttempt:{count:vi.fn().mockResolvedValue(2)},questionResult:{findUnique:vi.fn().mockResolvedValue({status:"PENDING"})}};
    await expect(new StudentService(prisma,{} as any).reveal(student,"ma1","q1")).rejects.toSatisfy((error:unknown)=>responseCode(error).error.code==="REVEAL_NOT_AVAILABLE");
  });

  it("completes a low-score Mission without creating an M2 unlock", async () => {
    const update=vi.fn().mockResolvedValue({});const unlock=vi.fn();
    const prisma:any={
      missionAttempt:{findFirst:vi.fn().mockResolvedValue({id:"ma1",attemptId:"a1",missionTemplateId:"m1",status:AttemptStatus.IN_PROGRESS,runtimeState:{viewedNodes:["1","2","3","4"],reflection:"Evidence"},attempt:{participant:{id:"p1",studentId:student.userId,session:{status:SessionStatus.ACTIVE}}},mission:{stableId:"M1",contentVersionId:"v1"},currentScreen:null}),update},
      questionTemplate:{count:vi.fn().mockResolvedValue(16)},questionResult:{count:vi.fn().mockResolvedValue(16)},missionScreenTemplate:{findFirstOrThrow:vi.fn().mockResolvedValue({inputConfig:{nodesRequired:4}})},missionScoringConfig:{findFirstOrThrow:vi.fn().mockResolvedValue({id:"cfg",checksum:"a".repeat(64),componentDefinitions:[]})},attempt:{update},workshopParticipant:{update},missionUnlock:{create:unlock},$transaction:vi.fn(async(values:any[])=>Promise.all(values))
    };
    const result=await new StudentService(prisma,{calculateMissionOne:vi.fn().mockResolvedValue(5)} as any).complete(student,"ma1");
    expect(result).toEqual({status:"COMPLETED",systemScore:5,nextMission:{state:"LOCKED",reason:"WAITING_FOR_TEACHER"}});
    expect(unlock).not.toHaveBeenCalled();
  });
});

describe("authentication and controlled profile references", () => {
  it("verifies an Argon2id password and persists server-side login state", async () => {
    const passwordHash=await argon2.hash("Carbon123!",{type:argon2.argon2id});
    const prisma:any={userAccount:{findUnique:vi.fn().mockResolvedValue({id:"u1",username:"teacher.demo",accountType:AccountType.TEACHER,status:"ACTIVE",passwordHash,student:null,teacher:{userId:"u1"}})},authSession:{create:vi.fn().mockResolvedValue({})},loginRecord:{create:vi.fn().mockResolvedValue({})},$transaction:vi.fn(async(values:any[])=>Promise.all(values))};
    const jwt:any={sign:vi.fn().mockReturnValueOnce("access").mockReturnValueOnce("refresh")};
    const result=await new AuthService(prisma,jwt).login({username:"TEACHER.DEMO",password:"Carbon123!"});
    expect(result).toMatchObject({accessToken:"access",refreshToken:"refresh",accountType:AccountType.TEACHER,profileRequired:false});
    expect(prisma.authSession.create).toHaveBeenCalled();expect(prisma.loginRecord.create).toHaveBeenCalled();
  });

  it("rejects arbitrary School/Class references", async () => {
    const prisma:any={schoolClass:{findFirst:vi.fn().mockResolvedValue(null)}};
    await expect(new AuthService(prisma,{} as any).updateProfile(student,{name:"Alex",studentId:"S1",schoolId:"c1111111-1111-4111-8111-111111111111",classId:"c2222222-2222-4222-8222-222222222222"})).rejects.toSatisfy((error:unknown)=>responseCode(error).error.code==="INVALID_REFERENCE");
  });
});

describe("teacher transactions and authorization", () => {
  const unlockPrisma=(role:WorkshopRole,stableId:string)=>{
    const sequenceNo=Number(stableId.slice(1));
    const upsert=vi.fn().mockResolvedValue({id:`unlock-${stableId}`,sessionId:"s1",missionTemplateId:stableId.toLowerCase(),unlockSource:UnlockSource.TEACHER,unlockedByTeacherId:teacher.userId});
    return {prisma:{workshopSession:{findUnique:vi.fn().mockResolvedValue({id:"s1",workshopId:"w1",status:SessionStatus.ACTIVE,workshop:{contentVersionId:"v1"}})},workshopTeacher:{findUnique:vi.fn().mockResolvedValue({role})},missionTemplate:{findUnique:vi.fn().mockResolvedValue({id:stableId.toLowerCase(),stableId,sequenceNo,contentVersionId:"v1"})},missionUnlock:{upsert}} as any,upsert};
  };

  it.each(["M2","M3","M4","M5","M6"])("allows OWNER to unlock %s without a Student prerequisite query",async(stableId)=>{
    const {prisma,upsert}=unlockPrisma(WorkshopRole.OWNER,stableId);
    await new TeacherService(prisma,{} as any).unlock(teacher,"s1",stableId.toLowerCase());
    expect(upsert).toHaveBeenCalledWith({where:{sessionId_missionTemplateId:{sessionId:"s1",missionTemplateId:stableId.toLowerCase()}},update:{},create:{sessionId:"s1",missionTemplateId:stableId.toLowerCase(),unlockSource:UnlockSource.TEACHER,unlockedByTeacherId:teacher.userId}});
    expect(prisma.workshopParticipant).toBeUndefined();
  });

  it.each(["M2","M3","M4","M5","M6"])("allows INSTRUCTOR to unlock %s",async(stableId)=>{
    const {prisma,upsert}=unlockPrisma(WorkshopRole.INSTRUCTOR,stableId);
    await new TeacherService(prisma,{} as any).unlock(teacher,"s1",stableId.toLowerCase());
    expect(upsert).toHaveBeenCalledOnce();
  });

  it.each(["M2","M3","M4","M5","M6"])("forbids VIEWER from unlocking %s",async(stableId)=>{
    const {prisma,upsert}=unlockPrisma(WorkshopRole.VIEWER,stableId);
    await expect(new TeacherService(prisma,{} as any).unlock(teacher,"s1",stableId.toLowerCase())).rejects.toSatisfy((error:unknown)=>(error as HttpException).getStatus()===403);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("keeps duplicate Teacher unlock requests idempotent",async()=>{
    const {prisma,upsert}=unlockPrisma(WorkshopRole.OWNER,"M3");
    const service=new TeacherService(prisma,{} as any);
    const first=await service.unlock(teacher,"s1","m3");
    const second=await service.unlock(teacher,"s1","m3");
    expect(first).toEqual(second);
    expect(upsert).toHaveBeenCalledTimes(2);
    expect(upsert).toHaveBeenLastCalledWith(expect.objectContaining({update:{}}));
  });

  it("rejects manual Teacher unlock for M1",async()=>{
    const {prisma,upsert}=unlockPrisma(WorkshopRole.OWNER,"M1");
    await expect(new TeacherService(prisma,{} as any).unlock(teacher,"s1","m1")).rejects.toSatisfy((error:unknown)=>responseCode(error).error.code==="INVALID_MISSION_UNLOCK");
    expect(upsert).not.toHaveBeenCalled();
  });

  it("reports an early-unlocked M3 independently of Student prerequisite counts",async()=>{
    const prisma:any={workshopSession:{findUnique:vi.fn().mockResolvedValue({id:"s1",workshopId:"w1",workshop:{contentVersionId:"v1"},unlocks:[{missionTemplateId:"m1",unlockSource:UnlockSource.INITIAL},{missionTemplateId:"m3",unlockSource:UnlockSource.TEACHER}],participants:[]})},workshopTeacher:{findUnique:vi.fn().mockResolvedValue({role:WorkshopRole.OWNER})},missionTemplate:{findMany:vi.fn().mockResolvedValue([{id:"m1",stableId:"M1",sequenceNo:1},{id:"m2",stableId:"M2",sequenceNo:2},{id:"m3",stableId:"M3",sequenceNo:3}])}};
    const result=await new TeacherService(prisma,{} as any).missionControl(teacher,"s1");
    expect(result[2]).toMatchObject({stableId:"M3",unlockState:"UNLOCKED_FOR_SESSION",unlockSource:UnlockSource.TEACHER,counts:{eligible:0,blockedByPrerequisite:0}});
  });

  it("excludes archived Workshops from the default dashboard", async () => {
    const ready={id:"ready-workshop",status:WorkshopStatus.READY};
    const archived={id:"archived-workshop",status:WorkshopStatus.ARCHIVED};
    const findMany=vi.fn().mockImplementation(({where}:any)=>Promise.resolve([ready,archived].filter((workshop)=>workshop.status!==where.status.not)));
    const prisma:any={workshop:{findMany}};

    const result=await new TeacherService(prisma,{} as any).dashboard(teacher);

    expect(result).toEqual([ready]);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({where:{status:{not:WorkshopStatus.ARCHIVED},teachers:{some:{teacherId:teacher.userId}}}}));
  });

  it("keeps archive blocked while the Workshop has an ACTIVE Session", async () => {
    const update=vi.fn();
    const prisma:any={workshopTeacher:{findUnique:vi.fn().mockResolvedValue({role:WorkshopRole.OWNER})},workshopSession:{count:vi.fn().mockResolvedValue(1)},workshop:{update}};

    await expect(new TeacherService(prisma,{} as any).archiveWorkshop(teacher,"w1")).rejects.toSatisfy((error:unknown)=>responseCode(error).error.code==="ACTIVE_SESSION_EXISTS");
    expect(update).not.toHaveBeenCalled();
  });

  it("creates Workshop and creator OWNER inside the same transaction", async () => {
    const tx={workshop:{create:vi.fn().mockResolvedValue({id:"w1",name:"Lab"})},workshopTeacher:{create:vi.fn().mockResolvedValue({})},workshopAudience:{createMany:vi.fn().mockResolvedValue({count:1}),create:vi.fn()}};
    const prisma:any={teacherProfile:{findUnique:vi.fn().mockResolvedValue({userId:teacher.userId,schoolId:"school-1"})},gameContentVersion:{findFirst:vi.fn().mockResolvedValue({id:"v1"})},schoolClass:{count:vi.fn().mockResolvedValue(1)},$transaction:vi.fn(async(callback:any)=>callback(tx))};
    await new TeacherService(prisma,{} as any).createWorkshop(teacher,{name:"Lab",contentVersionId:"v1",schoolId:"school-1",classIds:["class-1"]});
    expect(prisma.$transaction).toHaveBeenCalledOnce();
    expect(tx.workshopTeacher.create).toHaveBeenCalledWith({data:{workshopId:"w1",teacherId:teacher.userId,role:WorkshopRole.OWNER}});
  });

  it("rolls Session start back at an ACTIVE audience conflict", async () => {
    const tx:any={
      workshopSession:{findUnique:vi.fn().mockResolvedValue({id:"s1",workshopId:"w1",status:SessionStatus.SCHEDULED,workshop:{status:"READY",contentVersionId:"v1",audiences:[{schoolId:"school-1",classId:"class-1"}]}}),findFirst:vi.fn().mockResolvedValue({id:"conflict"}),update:vi.fn()},
      workshopTeacher:{findUnique:vi.fn().mockResolvedValue({role:WorkshopRole.OWNER})},
      $executeRaw:vi.fn().mockResolvedValue(0),workshopSessionAudience:{createMany:vi.fn()},missionTemplate:{findFirstOrThrow:vi.fn()},missionUnlock:{create:vi.fn()}
    };
    const prisma:any={$transaction:vi.fn(async(callback:any)=>callback(tx))};
    await expect(new TeacherService(prisma,{} as any).startSession(teacher,"s1")).rejects.toSatisfy((error:unknown)=>responseCode(error).error.code==="ACTIVE_SESSION_AUDIENCE_CONFLICT");
    expect(tx.workshopSession.update).not.toHaveBeenCalled();
    expect(tx.missionUnlock.create).not.toHaveBeenCalled();
  });

  it("freezes audience, activates the Session, and creates audited M1 INITIAL unlock atomically", async () => {
    const source={id:"s1",workshopId:"w1",status:SessionStatus.SCHEDULED,workshop:{status:"READY",contentVersionId:"v1",audiences:[{schoolId:"school-1",classId:"class-1"}]}};
    const tx:any={
      workshopSession:{findUnique:vi.fn().mockResolvedValueOnce(source).mockResolvedValueOnce({id:"s1",status:SessionStatus.ACTIVE}),findFirst:vi.fn().mockResolvedValue(null),update:vi.fn().mockResolvedValue({})},workshopTeacher:{findUnique:vi.fn().mockResolvedValue({role:WorkshopRole.OWNER})},$executeRaw:vi.fn().mockResolvedValue(0),workshopSessionAudience:{createMany:vi.fn().mockResolvedValue({count:1})},missionTemplate:{findFirstOrThrow:vi.fn().mockResolvedValue({id:"m1"})},missionUnlock:{create:vi.fn().mockResolvedValue({})}
    };
    const prisma:any={$transaction:vi.fn(async(callback:any)=>callback(tx))};
    await new TeacherService(prisma,{} as any).startSession(teacher,"s1");
    expect(tx.workshopSessionAudience.createMany).toHaveBeenCalledWith({data:[{sessionId:"s1",schoolId:"school-1",classId:"class-1"}]});
    expect(tx.workshopSession.update).toHaveBeenCalledWith({where:{id:"s1"},data:expect.objectContaining({status:SessionStatus.ACTIVE,startedByTeacherId:teacher.userId})});
    expect(tx.missionUnlock.create).toHaveBeenCalledWith({data:{sessionId:"s1",missionTemplateId:"m1",unlockSource:"INITIAL",unlockedByTeacherId:teacher.userId}});
  });

  it("forbids VIEWER mutations", async () => {
    const prisma:any={workshopTeacher:{findUnique:vi.fn().mockResolvedValue({role:WorkshopRole.VIEWER})},workshopSession:{count:vi.fn()},};
    await expect(new TeacherService(prisma,{} as any).createSession(teacher,"w1",{})).rejects.toSatisfy((error:unknown)=>(error as HttpException).getStatus()===403);
  });

  it("forbids VIEWER export of identifiable student data", async () => {
    const prisma:any={workshopTeacher:{findUnique:vi.fn().mockResolvedValue({role:WorkshopRole.VIEWER})},workshopParticipant:{findMany:vi.fn()}};
    await expect(new TeacherService(prisma,{} as any).exportCsv(teacher,"w1")).rejects.toSatisfy((error:unknown)=>(error as HttpException).getStatus()===403);
    expect(prisma.workshopParticipant.findMany).not.toHaveBeenCalled();
  });

  it("requires explicit same-level supersede and rejects stale writers", async () => {
    const prisma:any={missionAttempt:{findUnique:vi.fn().mockResolvedValue({id:"ma1",systemScore:55,attempt:{participant:{session:{workshopId:"w1"}}}})},workshopTeacher:{findUnique:vi.fn().mockResolvedValue({role:WorkshopRole.OWNER})},$transaction:vi.fn(async(callback:any)=>callback({scoreAdjustmentStream:{findFirst:vi.fn().mockResolvedValue({id:"stream",currentAdjustmentId:"old"})},$queryRaw:vi.fn().mockResolvedValue([{id:"stream",currentAdjustmentId:"old"}])}))};
    await expect(new TeacherService(prisma,{} as any).adjust(teacher,{targetLevel:"MISSION",targetId:"ma1",adjustedScore:60,reason:"Evidence review",expectedSupersedesAdjustmentId:null})).rejects.toSatisfy((error:unknown)=>responseCode(error).error.code==="SCORE_ADJUSTMENT_STALE");
  });

  it("appends a new adjustment that explicitly supersedes the effective one", async () => {
    const create=vi.fn().mockResolvedValue({id:"new",streamId:"stream",supersedesAdjustmentId:"old"});const update=vi.fn().mockResolvedValue({});
    const tx:any={scoreAdjustmentStream:{findFirst:vi.fn().mockResolvedValue({id:"stream",currentAdjustmentId:"old"}),update},scoreAdjustment:{create},$queryRaw:vi.fn().mockResolvedValue([{id:"stream",currentAdjustmentId:"old"}])};
    const prisma:any={missionAttempt:{findUnique:vi.fn().mockResolvedValue({id:"ma1",systemScore:55,attempt:{participant:{session:{workshopId:"w1"}}}})},workshopTeacher:{findUnique:vi.fn().mockResolvedValue({role:WorkshopRole.INSTRUCTOR})},$transaction:vi.fn(async(callback:any)=>callback(tx))};
    await new TeacherService(prisma,{} as any).adjust(teacher,{targetLevel:"MISSION",targetId:"ma1",adjustedScore:60,reason:"Evidence review",expectedSupersedesAdjustmentId:"old"});
    expect(create.mock.calls.at(0)![0].data).toMatchObject({streamId:"stream",supersedesAdjustmentId:"old",originalSystemScore:55,adjustedScore:60});
    expect(update).toHaveBeenCalledWith({where:{id:"stream"},data:{currentAdjustmentId:"new",version:{increment:1}}});
  });

  it("creates the first Mission adjustment on a MISSION stream linked to the selected MissionAttempt", async () => {
    const createStream=vi.fn().mockResolvedValue({id:"stream-mission",currentAdjustmentId:null});
    const createAdjustment=vi.fn().mockResolvedValue({id:"adj-mission",streamId:"stream-mission",supersedesAdjustmentId:null});
    const tx:any={scoreAdjustmentStream:{findFirst:vi.fn().mockResolvedValue(null),create:createStream,update:vi.fn().mockResolvedValue({})},scoreAdjustment:{create:createAdjustment},$queryRaw:vi.fn().mockResolvedValue([{id:"stream-mission",currentAdjustmentId:null}])};
    const prisma:any={missionAttempt:{findUnique:vi.fn().mockResolvedValue({id:"ma1",systemScore:84.16,attempt:{participant:{session:{workshopId:"w1"}}}})},workshopTeacher:{findUnique:vi.fn().mockResolvedValue({role:WorkshopRole.OWNER})},$transaction:vi.fn(async(callback:any)=>callback(tx))};
    await new TeacherService(prisma,{} as any).adjust(teacher,{targetLevel:"MISSION",targetId:"ma1",adjustedScore:70,reason:"Mission evidence review",expectedSupersedesAdjustmentId:null});
    expect(createStream).toHaveBeenCalledWith({data:{targetLevel:"MISSION",missionAttemptId:"ma1"}});
    expect(createAdjustment).toHaveBeenCalledWith({data:expect.objectContaining({streamId:"stream-mission",supersedesAdjustmentId:null,originalSystemScore:84.16,adjustedScore:70})});
    expect(prisma.missionAttempt.update).toBeUndefined();
    expect(prisma.questionResult).toBeUndefined();
  });

  it("keeps an active Mission override effective after later Question-score changes", async () => {
    const prisma:any={missionAttempt:{findUniqueOrThrow:vi.fn().mockResolvedValue({mission:{},adjustmentStream:{currentAdjustment:{adjustedScore:70}},questionResults:[{systemScore:4.2,adjustmentStream:{currentAdjustment:{adjustedScore:4.2}},question:{stableId:"M1-Q02"}}]})}};
    const effective=await new ScoringService(prisma).calculateMissionOne("ma1",true);
    expect(effective).toBe(70);
    expect(prisma.missionAttempt.findUniqueOrThrow).toHaveBeenCalledWith(expect.objectContaining({where:{id:"ma1"}}));
  });

  it("enforces Mission adjustment bounds", async () => {
    const prisma:any={missionAttempt:{findUnique:vi.fn().mockResolvedValue({id:"ma1",systemScore:55,attempt:{participant:{session:{workshopId:"w1"}}}})},workshopTeacher:{findUnique:vi.fn().mockResolvedValue({role:WorkshopRole.OWNER})}};
    await expect(new TeacherService(prisma,{} as any).adjust(teacher,{targetLevel:"MISSION",targetId:"ma1",adjustedScore:101,reason:"Invalid",expectedSupersedesAdjustmentId:null})).rejects.toSatisfy((error:unknown)=>responseCode(error).error.code==="SCORE_OUT_OF_BOUNDS");
  });

  it("uses the immutable QuestionResult base snapshot for Question adjustment bounds", async () => {
    const prisma:any={questionResult:{findUnique:vi.fn().mockResolvedValue({id:"qr1",status:"FINALIZED",systemScore:3,v5BaseScore:6,missionAttempt:{attempt:{participant:{session:{workshopId:"w1"}}}}})},workshopTeacher:{findUnique:vi.fn().mockResolvedValue({role:WorkshopRole.OWNER})}};
    await expect(new TeacherService(prisma,{} as any).adjust(teacher,{targetLevel:"QUESTION",targetId:"qr1",adjustedScore:7,reason:"Invalid",expectedSupersedesAdjustmentId:null})).rejects.toSatisfy((error:unknown)=>responseCode(error).error.code==="SCORE_OUT_OF_BOUNDS");
  });

  it("serializes Students and Gradebook roster data containing bigint adjustment stream versions", async () => {
    const currentAdjustment={id:"adj1",streamId:"stream-q",supersedesAdjustmentId:null,originalSystemScore:4,adjustedScore:4.01,reason:"Evidence review"};
    const questionStream={id:"stream-q",targetLevel:"QUESTION",version:1n,currentAdjustmentId:"adj1",currentAdjustment};
    const missionStream={id:"stream-m",targetLevel:"MISSION",version:2n,currentAdjustmentId:null,currentAdjustment:null};
    const attemptStream={id:"stream-a",targetLevel:"FINAL_TOTAL",version:3n,currentAdjustmentId:null,currentAdjustment:null};
    const rows=[{id:"participant-1",student:{name:"Alex",studentId:"S1",schoolClass:{name:"Class A"}},attempts:[{id:"attempt-1",adjustmentStream:attemptStream,missionAttempts:[{id:"ma1",mission:{stableId:"M1"},adjustmentStream:missionStream,questionResults:[{id:"qr1",systemScore:4,adjustmentStream:questionStream}]}]}]}];
    const prisma:any={workshopTeacher:{findUnique:vi.fn().mockResolvedValue({role:WorkshopRole.OWNER})},workshopParticipant:{findMany:vi.fn().mockResolvedValue(rows)}};
    const response=await new TeacherService(prisma,{} as any).students(teacher,"w1");
    expect(response[0]!.attempts[0]!.adjustmentStream!.version).toBe(3);
    expect(response[0]!.attempts[0]!.missionAttempts[0]!.adjustmentStream!.version).toBe(2);
    expect(response[0]!.attempts[0]!.missionAttempts[0]!.questionResults[0]!.adjustmentStream!.version).toBe(1);
    expect(response[0]!.attempts[0]!.missionAttempts[0]!.questionResults[0]!.adjustmentStream!.currentAdjustment!.adjustedScore).toBe(4.01);
    expect(()=>JSON.stringify(response)).not.toThrow();
    expect(questionStream.version).toBe(1n);
    expect(questionStream.currentAdjustment).toBe(currentAdjustment);
  });

  it("projects selectable Questions and resolves Mission override above Question-adjusted scoring", async () => {
    const missionAdjustment={id:"adj-m",adjustedScore:91};
    const questionAdjustment={id:"adj-q",adjustedScore:4.01};
    const rows=[{
      id:"participant-1",
      student:{name:"Alex",studentId:"S1",schoolClass:{name:"Class A"}},
      attempts:[{
        id:"attempt-1",
        systemTotalScore:null,
        adjustmentStream:null,
        missionAttempts:[{
          id:"ma1",
          systemScore:84.16,
          mission:{stableId:"M1"},
          adjustmentStream:{id:"stream-m",version:1n,currentAdjustmentId:"adj-m",currentAdjustment:missionAdjustment,adjustments:[missionAdjustment]},
          questionResults:[{
            id:"qr2",
            status:"FINALIZED",
            systemScore:4,
            v5BaseScore:5,
            question:{stableId:"M1-Q02",promptEn:"Prompt",promptCn:"问题"},
            adjustmentStream:{id:"stream-q",version:1n,currentAdjustmentId:"adj-q",currentAdjustment:questionAdjustment,adjustments:[questionAdjustment]}
          }]
        }]
      }]
    }];
    const prisma:any={workshopTeacher:{findUnique:vi.fn().mockResolvedValue({role:WorkshopRole.OWNER})},workshopParticipant:{findMany:vi.fn().mockResolvedValue(rows)}};
    const scoring:any={calculateMissionOne:vi.fn().mockResolvedValue(85.25)};
    const response=await new TeacherService(prisma,scoring).students(teacher,"w1");
    const mission=response[0]!.attempts[0]!.missionAttempts[0]!;
    expect(scoring.calculateMissionOne).toHaveBeenCalledWith("ma1",true,false);
    expect(mission).toMatchObject({questionAdjustedScore:85.25,effectiveScore:91,questionResults:[{effectiveScore:4.01,question:{stableId:"M1-Q02"}}]});
    expect(()=>JSON.stringify(response)).not.toThrow();
  });

  it("serializes Question evidence and its append-only adjustment audit history", async () => {
    const adjustments=[{id:"adj0",adjustedScore:4},{id:"adj1",supersedesAdjustmentId:"adj0",adjustedScore:4.01}];
    const result={id:"qr1",missionAttemptId:"ma1",questionTemplateId:"q1",systemScore:4,v5BaseScore:6,question:{stableId:"M1-Q02"},selectedAttempt:null,missionAttempt:{attempt:{participant:{session:{workshopId:"w1"},student:{name:"Alex"}}}},adjustmentStream:{id:"stream-q",version:2n,currentAdjustmentId:"adj1",currentAdjustment:adjustments[1],adjustments}};
    const prisma:any={questionResult:{findUnique:vi.fn().mockResolvedValue(result)},questionAttempt:{findMany:vi.fn().mockResolvedValue([])},workshopTeacher:{findUnique:vi.fn().mockResolvedValue({role:WorkshopRole.OWNER})}};
    const response=await new TeacherService(prisma,{} as any).questionResult(teacher,"qr1");
    expect(response.adjustmentStream!.version).toBe(2);
    expect(response.adjustmentStream!.adjustments).toEqual(adjustments);
    expect(response.effectiveScore).toBe(4.01);
    expect(()=>JSON.stringify(response)).not.toThrow();
  });

  it("returns a JSON-safe successful adjustment response without retrying or duplicating the append", async () => {
    const created={id:"adj1",streamId:"stream-q",supersedesAdjustmentId:null,originalSystemScore:4,adjustedScore:4.01,reason:"Evidence review"};
    const create=vi.fn().mockResolvedValue(created);const update=vi.fn().mockResolvedValue({});
    const tx:any={scoreAdjustmentStream:{findFirst:vi.fn().mockResolvedValue({id:"stream-q",version:0n,currentAdjustmentId:null}),update},scoreAdjustment:{create},$queryRaw:vi.fn().mockResolvedValue([{id:"stream-q",currentAdjustmentId:null}])};
    const prisma:any={questionResult:{findUnique:vi.fn().mockResolvedValue({id:"qr1",status:"FINALIZED",systemScore:4,v5BaseScore:6,missionAttempt:{attempt:{participant:{session:{workshopId:"w1"}}}}}),findUniqueOrThrow:vi.fn().mockResolvedValue({missionAttemptId:"ma1"})},workshopTeacher:{findUnique:vi.fn().mockResolvedValue({role:WorkshopRole.OWNER})},$transaction:vi.fn(async(callback:any)=>callback(tx))};
    const scoring:any={calculateMissionOne:vi.fn().mockResolvedValue(4.01)};
    const response=await new TeacherService(prisma,scoring).adjust(teacher,{targetLevel:"QUESTION",targetId:"qr1",adjustedScore:4.01,reason:"Evidence review",expectedSupersedesAdjustmentId:null});
    expect(response).toEqual({adjustment:created,effectiveMissionScore:4.01});
    expect(()=>JSON.stringify(response)).not.toThrow();
    expect(create).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledOnce();
  });

  it("creates an adjustment for another QuestionResult in its independent stream", async () => {
    const create=vi.fn().mockResolvedValue({id:"adj-q2",streamId:"stream-q2",supersedesAdjustmentId:null});
    const tx:any={scoreAdjustmentStream:{findFirst:vi.fn().mockResolvedValue({id:"stream-q2",currentAdjustmentId:null}),update:vi.fn().mockResolvedValue({})},scoreAdjustment:{create},$queryRaw:vi.fn().mockResolvedValue([{id:"stream-q2",currentAdjustmentId:null}])};
    const prisma:any={questionResult:{findUnique:vi.fn().mockResolvedValue({id:"qr2",status:"FINALIZED",systemScore:3,v5BaseScore:6,missionAttempt:{attempt:{participant:{session:{workshopId:"w1"}}}}}),findUniqueOrThrow:vi.fn().mockResolvedValue({missionAttemptId:"ma1"})},workshopTeacher:{findUnique:vi.fn().mockResolvedValue({role:WorkshopRole.INSTRUCTOR})},$transaction:vi.fn(async(callback:any)=>callback(tx))};
    await new TeacherService(prisma,{calculateMissionOne:vi.fn().mockResolvedValue(80)} as any).adjust(teacher,{targetLevel:"QUESTION",targetId:"qr2",adjustedScore:3.5,reason:"Independent review",expectedSupersedesAdjustmentId:null});
    expect(create).toHaveBeenCalledWith({data:expect.objectContaining({streamId:"stream-q2",originalSystemScore:3,adjustedScore:3.5})});
  });

  it("creates the first append-only Final Total stream and adjustment against the Attempt", async () => {
    const createStream=vi.fn().mockResolvedValue({id:"stream-final",currentAdjustmentId:null});
    const updateStream=vi.fn().mockResolvedValue({});
    const create=vi.fn().mockResolvedValue({id:"adj-final",streamId:"stream-final",supersedesAdjustmentId:null});
    const tx:any={scoreAdjustmentStream:{findFirst:vi.fn().mockResolvedValue(null),create:createStream,update:updateStream},scoreAdjustment:{create},$queryRaw:vi.fn().mockResolvedValue([{id:"stream-final",currentAdjustmentId:null}])};
    const prisma:any={attempt:{findUnique:vi.fn().mockResolvedValue({id:"a1",systemTotalScore:80,participant:{session:{workshopId:"w1"}}})},workshopTeacher:{findUnique:vi.fn().mockResolvedValue({role:WorkshopRole.OWNER})},$transaction:vi.fn(async(callback:any)=>callback(tx))};
    await new TeacherService(prisma,{} as any).adjust(teacher,{targetLevel:"FINAL_TOTAL",targetId:"a1",adjustedScore:86,reason:"Final evidence review",expectedSupersedesAdjustmentId:null});
    expect(createStream).toHaveBeenCalledWith({data:{targetLevel:"FINAL_TOTAL",attemptId:"a1"}});
    expect(create).toHaveBeenCalledWith({data:expect.objectContaining({streamId:"stream-final",originalSystemScore:80,adjustedScore:86})});
    expect(updateStream).toHaveBeenCalledWith({where:{id:"stream-final"},data:{currentAdjustmentId:"adj-final",version:{increment:1}}});
    expect(prisma.missionAttempt).toBeUndefined();
    expect(prisma.questionResult).toBeUndefined();
  });

  it("supersedes the currently effective Final Total adjustment without mutating history", async () => {
    const create=vi.fn().mockResolvedValue({id:"adj-final-2",streamId:"stream-final",supersedesAdjustmentId:"adj-final-1"});
    const updateStream=vi.fn().mockResolvedValue({});
    const tx:any={scoreAdjustmentStream:{findFirst:vi.fn().mockResolvedValue({id:"stream-final",currentAdjustmentId:"adj-final-1"}),update:updateStream},scoreAdjustment:{create},$queryRaw:vi.fn().mockResolvedValue([{id:"stream-final",currentAdjustmentId:"adj-final-1"}])};
    const prisma:any={attempt:{findUnique:vi.fn().mockResolvedValue({id:"a1",systemTotalScore:80,participant:{session:{workshopId:"w1"}}})},workshopTeacher:{findUnique:vi.fn().mockResolvedValue({role:WorkshopRole.INSTRUCTOR})},$transaction:vi.fn(async(callback:any)=>callback(tx))};
    await new TeacherService(prisma,{} as any).adjust(teacher,{targetLevel:"FINAL_TOTAL",targetId:"a1",adjustedScore:91,reason:"Updated final review",expectedSupersedesAdjustmentId:"adj-final-1"});
    expect(create).toHaveBeenCalledWith({data:{streamId:"stream-final",supersedesAdjustmentId:"adj-final-1",originalSystemScore:80,adjustedScore:91,reason:"Updated final review",adjustedByTeacherId:teacher.userId}});
    expect(updateStream).toHaveBeenCalledWith({where:{id:"stream-final"},data:{currentAdjustmentId:"adj-final-2",version:{increment:1}}});
    expect(tx.scoreAdjustment.update).toBeUndefined();
    expect(tx.scoreAdjustment.delete).toBeUndefined();
  });

  it("forbids VIEWER score adjustments at the backend", async () => {
    const prisma:any={missionAttempt:{findUnique:vi.fn().mockResolvedValue({id:"ma1",systemScore:55,attempt:{participant:{session:{workshopId:"w1"}}}})},workshopTeacher:{findUnique:vi.fn().mockResolvedValue({role:WorkshopRole.VIEWER})},$transaction:vi.fn()};
    await expect(new TeacherService(prisma,{} as any).adjust(teacher,{targetLevel:"MISSION",targetId:"ma1",adjustedScore:60,reason:"Not allowed",expectedSupersedesAdjustmentId:null})).rejects.toSatisfy((error:unknown)=>(error as HttpException).getStatus()===403);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("forbids VIEWER Final Total adjustments at the backend", async () => {
    const prisma:any={attempt:{findUnique:vi.fn().mockResolvedValue({id:"a1",systemTotalScore:80,participant:{session:{workshopId:"w1"}}})},workshopTeacher:{findUnique:vi.fn().mockResolvedValue({role:WorkshopRole.VIEWER})},$transaction:vi.fn()};
    await expect(new TeacherService(prisma,{} as any).adjust(teacher,{targetLevel:"FINAL_TOTAL",targetId:"a1",adjustedScore:86,reason:"Not allowed",expectedSupersedesAdjustmentId:null})).rejects.toSatisfy((error:unknown)=>(error as HttpException).getStatus()===403);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("keeps no-adjustment Students responses JSON safe", async () => {
    const rows=[{id:"participant-1",student:{name:"Alex"},attempts:[{id:"attempt-1",adjustmentStream:null,missionAttempts:[{id:"ma1",adjustmentStream:null,questionResults:[{id:"qr1",adjustmentStream:null}]}]}]}];
    const prisma:any={workshopTeacher:{findUnique:vi.fn().mockResolvedValue({role:WorkshopRole.VIEWER})},workshopParticipant:{findMany:vi.fn().mockResolvedValue(rows)}};
    const response=await new TeacherService(prisma,{} as any).students(teacher,"w1");
    expect(()=>JSON.stringify(response)).not.toThrow();
    expect(response[0]!.attempts[0]).toMatchObject({id:"attempt-1",adjustmentStream:null,effectiveScore:null});
    expect(response[0]!.attempts[0]!.missionAttempts[0]).toMatchObject({id:"ma1",adjustmentStream:null,questionAdjustedScore:null,effectiveScore:null});
    expect(response[0]!.attempts[0]!.missionAttempts[0]!.questionResults[0]).toMatchObject({id:"qr1",adjustmentStream:null,effectiveScore:null});
  });

  it("enforces Final Total adjustment bounds", async () => {
    const prisma:any={attempt:{findUnique:vi.fn().mockResolvedValue({id:"a1",systemTotalScore:80,participant:{session:{workshopId:"w1"}}})},workshopTeacher:{findUnique:vi.fn().mockResolvedValue({role:WorkshopRole.OWNER})}};
    await expect(new TeacherService(prisma,{} as any).adjust(teacher,{targetLevel:"FINAL_TOTAL",targetId:"a1",adjustedScore:101,reason:"Invalid",expectedSupersedesAdjustmentId:null})).rejects.toSatisfy((error:unknown)=>responseCode(error).error.code==="SCORE_OUT_OF_BOUNDS");
  });

  it("does not fabricate a Final Total adjustment target when the six-Mission total is unavailable", async () => {
    const prisma:any={attempt:{findUnique:vi.fn().mockResolvedValue({id:"a1",systemTotalScore:null,participant:{session:{workshopId:"w1"}}})},workshopTeacher:{findUnique:vi.fn()},$transaction:vi.fn()};
    await expect(new TeacherService(prisma,{} as any).adjust(teacher,{targetLevel:"FINAL_TOTAL",targetId:"a1",adjustedScore:86,reason:"No provisional total",expectedSupersedesAdjustmentId:null})).rejects.toSatisfy((error:unknown)=>responseCode(error).error.code==="FINAL_RESULT_NOT_FOUND");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
