import type { NextConfig } from "next";
import path from "node:path";

const standalone = process.env.NEXT_OUTPUT_STANDALONE === "true";
const nextConfig: NextConfig = {
  reactStrictMode: true,
  ...(standalone ? {
    output: "standalone",
    outputFileTracingRoot: path.join(process.cwd(), "../..")
  } : {})
};

export default nextConfig;
