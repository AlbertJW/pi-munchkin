const CHILD_ENV_KEYS = [
  "HOME", "LANG", "LC_ALL", "PATH", "SYSTEMROOT", "TEMP", "TMP", "TMPDIR", "WINDIR",
  "XDG_CONFIG_HOME", "PI_CODING_AGENT_DIR",
  "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "AZURE_OPENAI_API_KEY", "AZURE_OPENAI_ENDPOINT",
  "GEMINI_API_KEY", "GOOGLE_API_KEY", "OPENROUTER_API_KEY", "GROQ_API_KEY", "MISTRAL_API_KEY", "LLAMA_API_KEY",
];

export function buildSubagentEnv(source = process.env) {
  const env = {};
  const extra = String(source.PI_SUBAGENT_ENV_ALLOW ?? "")
    .split(",").map((name) => name.trim()).filter((name) => /^[A-Z_][A-Z0-9_]*$/.test(name));
  for (const key of new Set([...CHILD_ENV_KEYS, ...extra])) if (source[key] !== undefined) env[key] = source[key];
  return env;
}
