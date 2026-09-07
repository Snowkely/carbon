import { Injectable } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import type { AccountType } from "@prisma/client";

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({ jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(), ignoreExpiration: false, secretOrKey: process.env.JWT_ACCESS_SECRET ?? "local-development-access-secret-change-me" });
  }
  validate(payload: { sub: string; accountType: AccountType; username: string }) {
    return { userId: payload.sub, accountType: payload.accountType, username: payload.username };
  }
}
