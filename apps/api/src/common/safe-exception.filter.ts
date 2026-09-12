import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from "@nestjs/common";

export function sanitizeDiagnostic(value: unknown): string {
  const message = value instanceof Error ? `${value.name}: ${value.message}` : String(value);
  return message
    .replace(/(postgres(?:ql)?:\/\/)[^@\s]+@/gi, "$1[redacted]@")
    .replace(/Bearer\s+[^\s]+/gi, "Bearer [redacted]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[redacted-jwt]")
    .replace(/(password|secret|token)(\s*[=:]\s*)[^\s,;]+/gi, "$1$2[redacted]")
    .slice(0, 1000);
}

@Catch()
export class SafeExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger("HttpException");

  catch(exception: unknown, host: ArgumentsHost) {
    const context = host.switchToHttp();
    const request = context.getRequest<{ method?: string; originalUrl?: string; url?: string }>();
    const response = context.getResponse<{ status(code: number): { json(body: unknown): void } }>();
    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const httpBody = exception instanceof HttpException ? exception.getResponse() : null;
    const readinessBody = status === HttpStatus.SERVICE_UNAVAILABLE
      && typeof httpBody === "object"
      && httpBody !== null
      && "database" in httpBody
      && "redis" in httpBody;
    if (status >= 500 && !readinessBody) {
      this.logger.error(`${request.method ?? "UNKNOWN"} ${request.originalUrl ?? request.url ?? "UNKNOWN"} ${status} ${sanitizeDiagnostic(exception)}`);
    }
    const body = readinessBody
      ? httpBody
      : status >= 500
      ? { statusCode: status, message: "Internal server error" }
      : exception instanceof HttpException
        ? httpBody
        : { statusCode: status, message: "Request failed" };
    response.status(status).json(body);
  }
}
