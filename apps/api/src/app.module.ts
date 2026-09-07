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

@Module({
  imports: [
    PassportModule,
    JwtModule.register({ secret: process.env.JWT_ACCESS_SECRET ?? "local-development-access-secret-change-me", signOptions: { expiresIn: (process.env.ACCESS_TOKEN_TTL ?? "15m") as never } })
  ],
  controllers: [AuthController, StudentController, StudentFeedbackController, TeacherController, TeacherFeedbackController],
  providers: [PrismaService, JwtStrategy, AuthService, StudentService, TeacherService, FeedbackService, ScoringService]
})
export class AppModule {}
