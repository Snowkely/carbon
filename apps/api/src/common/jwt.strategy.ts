import { Injectable } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import type { AccountType } from "@prisma/client";
import { validateRuntimeConfig } from "./runtime-config";

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    const config = validateRuntimeConfig();
    super({ jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(), ignoreExpiration: false, secretOrKey: config.jwtAccessSecret, algorithms: ["HS256"] });
  }
  validate(payload: { sub: string; accountType: AccountType; username: string }) {
    return { userId: payload.sub, accountType: payload.accountType, username: payload.username };
  }
}
