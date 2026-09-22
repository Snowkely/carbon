import { Injectable, UnauthorizedException } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { AccountStatus, type AccountType } from "@prisma/client";
import { validateRuntimeConfig } from "./runtime-config";
import { PrismaService } from "./prisma.service";

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly prisma: PrismaService) {
    const config = validateRuntimeConfig();
    super({ jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(), ignoreExpiration: false, secretOrKey: config.jwtAccessSecret, algorithms: ["HS256"] });
  }
  async validate(payload: { sub: string; accountType: AccountType; username: string; authVersion?: number }) {
    const account = await this.prisma.userAccount.findUnique({ where: { id: payload.sub }, select: { accountType: true, status: true, authVersion: true } });
    if (!account || account.status !== AccountStatus.ACTIVE || account.accountType !== payload.accountType || account.authVersion !== (payload.authVersion ?? 0)) throw new UnauthorizedException("Session is no longer valid");
    return { userId: payload.sub, accountType: payload.accountType, username: payload.username };
  }
}
