// 供應商切換：Claude（Anthropic）或 Gemini（Google）。
// 兩邊都提供相同的 makeClient / ask 介面，App 其他地方不用管差別。
import * as claude from './claude.js';
import * as gemini from './gemini.js';

export const PROVIDERS = {
  claude: {
    label: 'Claude（Anthropic）',
    module: claude,
    models: [
      { id: 'claude-opus-5', label: 'Claude Opus 5（最聰明）' },
      { id: 'claude-sonnet-5', label: 'Claude Sonnet 5（較省）' },
      { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5（最快）' },
    ],
  },
  gemini: {
    label: 'Gemini（Google，有免費額度）',
    module: gemini,
    models: gemini.FALLBACK_MODELS,
  },
};

export function providerOf(settings) {
  return PROVIDERS[settings.provider] ? settings.provider : 'claude';
}

export function makeClient(settings) {
  return PROVIDERS[providerOf(settings)].module.makeClient(settings);
}

export function ask(args) {
  return PROVIDERS[providerOf(args.settings)].module.ask(args);
}

/** 只有 Gemini 支援線上查詢可用模型 */
export function canListModels(settings) {
  return typeof PROVIDERS[providerOf(settings)].module.listModels === 'function';
}

export function listModels(settings) {
  return PROVIDERS[providerOf(settings)].module.listModels(settings);
}
