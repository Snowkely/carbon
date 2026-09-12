import { Worker } from "bullmq";
const safeError = (error: unknown) => (error instanceof Error ? `${error.name}: ${error.message}` : String(error))
  .replace(/(redis(?:s)?:\/\/)[^@\s]+@/gi, "$1[redacted]@")
  .replace(/(password|secret|token)(\s*[=:]\s*)[^\s,;]+/gi, "$1$2[redacted]")
  .slice(0, 1000);
const redisUrl = process.env.REDIS_URL;
if (!redisUrl) {
  console.log("Carbon worker idle: REDIS_URL is not configured. Core gameplay is unaffected.");
} else {
  const connection = { url: redisUrl };
  const worker = new Worker("carbon-exports", async (job) => ({ exportId: job.data.exportId }), { connection });
  worker.on("completed", (job) => console.log(`Export job ${job.id} completed`));
  worker.on("failed", (job, error) => console.error(`Export job ${job?.id} failed: ${safeError(error)}`));
  worker.on("error", (error) => console.error(`Carbon worker connection error: ${safeError(error)}`));
}
