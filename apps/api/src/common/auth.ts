import { createParamDecorator, ExecutionContext, Injectable } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import type { AccountType } from "@prisma/client";

export interface AuthUser { userId: string; accountType: AccountType; username: string; }
export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext): AuthUser => context.switchToHttp().getRequest().user);
@Injectable()
export class JwtAuthGuard extends AuthGuard("jwt") {}
