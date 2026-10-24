import { version as skillsCliVersion } from "skills/package.json";

// The `skills` CLI release that `cline skill` and the marketplace skill
// fallback run through npx. Read from the devDependency so the pin lives in
// package.json, where Dependabot bumps it, and each bump goes through CI and
// review instead of landing on users' machines the moment Vercel publishes.
export const SKILLS_CLI_VERSION: string = skillsCliVersion;
export const SKILLS_CLI_PACKAGE = `skills@${skillsCliVersion}`;
