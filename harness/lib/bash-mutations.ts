// Back-compat shim. New code should import from command-policy.ts so mutation,
// destructive, and verify decisions stay in one place.
export { isBashMutation } from "./command-policy.ts";
