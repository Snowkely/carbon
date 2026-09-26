import type { NextConfig } from "next";
import path from "node:path";

const standalone = process.env.NEXT_OUTPUT_STANDALONE === "true";
const configuredBasePath = process.env.PUBLIC_BASE_PATH?.trim() ?? "";
if (configuredBasePath && (!/^\/[a-z0-9-]+(?:\/[a-z0-9-]+)*$/i.test(configuredBasePath) || configuredBasePath.endsWith("/"))) {
  throw new Error("PUBLIC_BASE_PATH must be empty or an absolute path without a trailing slash");
}
const nextConfig: NextConfig = {
  reactStrictMode: true,
  ...(configuredBasePath ? { basePath: configuredBasePath } : {}),
  env: { NEXT_PUBLIC_BASE_PATH: configuredBasePath },
  ...(standalone ? {
    output: "standalone",
    outputFileTracingRoot: path.join(process.cwd(), "../..")
  } : {})
};

export default nextConfig;
