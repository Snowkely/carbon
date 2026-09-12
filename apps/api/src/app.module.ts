import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { PrismaService } from "./common/prisma.service";
import { JwtStrategy } from "./common/jwt.strategy";
import { AuthController, AuthService } from "./auth/auth";
import { StudentController, StudentService } from "./student/student";
import { TeacherController, TeacherService } from "./teacher/teacher";
import { ScoringService } from "./student/scoring.service";
import { FeedbackService, StudentFeedbackController, TeacherFeedbackController } from "./feedback/feedback";
import { validateRuntimeConfig } from "./common/runtime-config";
import { HealthController, HealthService } from "./health/health";

@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({ useFactory: () => {
      const runtime = validateRuntimeConfig();
      return { secret: runtime.jwtAccessSecret, signOptions: { expiresIn: runtime.accessTokenTtl as never, algorithm: "HS256" as const } };
    } })
  ],
  controllers: [HealthController, AuthController, StudentController, StudentFeedbackController, TeacherController, TeacherFeedbackController],
  providers: [PrismaService, JwtStrategy, HealthService, AuthService, StudentService, TeacherService, FeedbackService, ScoringService]
})
export class AppModule {}
