import { Worker } from "bullmq";
const redisUrl = process.env.REDIS_URL;
if (!redisUrl) {
  console.log("Carbon worker idle: REDIS_URL is not configured. Core gameplay is unaffected.");
} else {
  const connection = { url: redisUrl };
  const worker = new Worker("carbon-exports", async (job) => ({ exportId: job.data.exportId }), { connection });
  worker.on("completed", (job) => console.log(`Export job ${job.id} completed`));
  worker.on("failed", (job, error) => console.error(`Export job ${job?.id} failed`, error));
}
