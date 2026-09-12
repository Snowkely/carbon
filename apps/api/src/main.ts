import "reflect-metadata";
import { Logger, RequestMethod } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { AppModule } from "./app.module";
import { corsOriginAllowed, validateRuntimeConfig } from "./common/runtime-config";
import { SafeExceptionFilter, sanitizeDiagnostic } from "./common/safe-exception.filter";

async function bootstrap() {
  const runtime = validateRuntimeConfig();
  const app = await NestFactory.create(AppModule);
  app.getHttpAdapter().getInstance().disable("x-powered-by");
  app.enableCors({
    origin: (origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void) => callback(null, corsOriginAllowed(origin, runtime)),
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: false
  });
  app.useGlobalFilters(new SafeExceptionFilter());
  app.setGlobalPrefix("v1", { exclude: [{ path: "health", method: RequestMethod.GET }, { path: "ready", method: RequestMethod.GET }] });
  const config = new DocumentBuilder().setTitle("Carbon Trader I API").setVersion("1.0").addBearerAuth().build();
  SwaggerModule.setup("docs", app, SwaggerModule.createDocument(app, config));
  await app.listen(runtime.port);
  Logger.log(`API listening on port ${runtime.port}; environment=${runtime.environment}; allowedOrigins=${runtime.corsAllowedOrigins.length}; redis=${runtime.redisUrl ? "configured" : "disabled"}`, "Bootstrap");
}

bootstrap().catch((error) => {
  Logger.error(`API startup failed: ${sanitizeDiagnostic(error)}`, undefined, "Bootstrap");
  process.exitCode = 1;
});
