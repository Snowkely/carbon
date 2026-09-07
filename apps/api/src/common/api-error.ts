import { HttpException } from "@nestjs/common";

export function apiError(status: number, code: string, message: string, details: Record<string, unknown> = {}): never {
  throw new HttpException({ error: { code, message, details } }, status);
}
