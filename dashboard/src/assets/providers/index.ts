import openaiLogo from "./openai.png";
import anthropicLogo from "./anthropic.png";
import geminiLogo from "./gemini.png";
import groqLogo from "./groq.png";
import ollamaLogo from "./ollama.png";
import onnxLogo from "./onnx.svg";
import openrouterLogo from "./openrouter.png";
import customProviderLogo from "./custom-provider.svg";
import opencodeLogo from "./opencode.svg";
import browserLogo from "./browser.svg";
import edgeLogo from "./edge.svg";
import tavilyLogo from "./tavily.svg";
import braveLogo from "./brave.svg";
import googleLogo from "./google.svg";

export const PROVIDER_LOGOS: Record<string, string> = {
  openai: openaiLogo,
  anthropic: anthropicLogo,
  gemini: geminiLogo,
  groq: groqLogo,
  ollama: ollamaLogo,
  onnx: onnxLogo,
  openrouter: openrouterLogo,
  opencode: opencodeLogo,
  browser: browserLogo,
  edge: edgeLogo,
  tavily: tavilyLogo,
  brave: braveLogo,
  google: googleLogo,
};

export { customProviderLogo };

export function getProviderLogo(providerId: string): string | undefined {
  if (PROVIDER_LOGOS[providerId]) return PROVIDER_LOGOS[providerId];
  const base = providerId.split("-")[0];
  if (base !== providerId && PROVIDER_LOGOS[base]) return PROVIDER_LOGOS[base];
  const groupLogo: Record<string, string> = {
    opencode: opencodeLogo,
  };
  return groupLogo[base];
}

/**
 * Documentation / API reference URLs for built-in providers.
 */
export const PROVIDER_DOCS: Record<string, string> = {
  ollama: "https://ollama.com/search",
  onnx: "https://onnx.ai/",
  openai: "https://platform.openai.com/docs",
  anthropic: "https://docs.anthropic.com",
  gemini: "https://ai.google.dev/gemini-api/docs",
  groq: "https://groq.com/",
  openrouter: "https://openrouter.ai/docs/quickstart",
  opencode: "https://opencode.ai/docs/zen/",
  "opencode-zen-openai": "https://opencode.ai/docs/zen/",
  "opencode-zen-anthropic": "https://opencode.ai/docs/zen/",
  "opencode-zen-compatible": "https://opencode.ai/docs/zen/",
  "opencode-go-openai": "https://opencode.ai/docs/go/",
  "opencode-go-anthropic": "https://opencode.ai/docs/go/",
  "opencode-go-compatible": "https://opencode.ai/docs/go/",
};

const OPENCODE_ZEN_DOCS = "https://opencode.ai/docs/zen/";
const OPENCODE_GO_DOCS = "https://opencode.ai/docs/go/";

function normalizeProviderDocsKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[()]/g, "")
    .replace(/[\s·]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function opencodeDocsFallback(normalized: string): string | undefined {
  if (!normalized.startsWith("opencode")) return undefined;
  if (normalized.includes("-go-")) return OPENCODE_GO_DOCS;
  return OPENCODE_ZEN_DOCS;
}

export function getProviderDocs(providerId: string): string | undefined {
  const direct = PROVIDER_DOCS[providerId];
  if (direct) return direct;

  const normalized = normalizeProviderDocsKey(providerId);
  if (normalized !== providerId) {
    const fromNormalized = PROVIDER_DOCS[normalized];
    if (fromNormalized) return fromNormalized;
  }

  return opencodeDocsFallback(normalized);
}

/**
 * Get provider name from i18n, falling back to the API-returned name.
 */
export function getProviderName(
  providerId: string,
  fallbackName: string,
  t: (key: string) => string,
): string {
  const key = `providers.${providerId}`;
  const translated = t(key);
  return translated === key ? fallbackName : translated;
}
