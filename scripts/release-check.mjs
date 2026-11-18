import { readFileSync } from "node:fs";
import { VERSION } from "../src/version.ts";

const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
const lock = JSON.parse(
  readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"),
);
const tag = process.argv[2];
if (
  !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(packageJson.version) ||
  tag !== `v${packageJson.version}`
)
  throw Error(
    "Release tag must be v<package.json version>, using a stable MAJOR.MINOR.PATCH version",
  );
if (
  lock.version !== packageJson.version ||
  lock.packages[""].version !== packageJson.version ||
  VERSION !== packageJson.version
)
  throw Error("Package, lockfile and runtime release versions must match");
const compose = readFileSync(
  new URL("../compose.yaml", import.meta.url),
  "utf8",
);
const dockerfile = readFileSync(
  new URL("../Dockerfile", import.meta.url),
  "utf8",
);
if (
  !compose.includes(
    `image: ghcr.io/inferlopec/poe2-economy-reporter:${VERSION}\n`,
  ) ||
  !dockerfile.includes(`ARG VERSION=${VERSION}\n`)
)
  throw Error(
    "Compose image and Docker default version must match the release",
  );
console.log(`version=${VERSION}`);
