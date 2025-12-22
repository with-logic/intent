#!/usr/bin/env node
/**
 * Build script for dual ESM/CJS output using esbuild.
 *
 * Produces:
 * - dist/index.mjs (ESM)
 * - dist/index.cjs (CommonJS)
 * - dist/*.d.ts (TypeScript declarations via tsc)
 */
import * as esbuild from "esbuild";
import { execSync } from "child_process";
import { rmSync } from "fs";

/** Source entry point. */
const ENTRY_POINT = "src/index.ts";

/** Output directory. */
const OUT_DIR = "dist";

/** Shared esbuild options for both formats. */
const sharedOptions = {
  entryPoints: [ENTRY_POINT],
  bundle: true,
  platform: "node",
  target: "node18",
  sourcemap: true,
  external: ["groq-sdk", "dotenv"],
};

/**
 * Clean the output directory.
 */
function clean() {
  console.log("Cleaning dist/...");
  rmSync(OUT_DIR, { recursive: true, force: true });
}

/**
 * Build ESM and CJS bundles with esbuild.
 */
async function buildBundles() {
  console.log("Building ESM bundle...");
  await esbuild.build({
    ...sharedOptions,
    format: "esm",
    outfile: `${OUT_DIR}/index.mjs`,
  });

  console.log("Building CJS bundle...");
  await esbuild.build({
    ...sharedOptions,
    format: "cjs",
    outfile: `${OUT_DIR}/index.cjs`,
  });
}

/**
 * Generate TypeScript declaration files using tsc.
 */
function buildDeclarations() {
  console.log("Generating type declarations...");
  execSync("tsc --emitDeclarationOnly --declaration --outDir dist", {
    stdio: "inherit",
  });
}

/**
 * Main build process.
 */
async function main() {
  try {
    clean();
    await buildBundles();
    buildDeclarations();
    console.log("Build complete!");
  } catch (error) {
    console.error("Build failed:", error);
    process.exit(1);
  }
}

main();
