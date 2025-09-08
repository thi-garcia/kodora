// PATH: app/components/@settings/tabs/providers/cloud/CloudProvidersTab.tsx
import React, { useEffect, useState, useCallback } from 'react';
import { Switch } from '~/components/ui/Switch';
import { useSettings } from '~/lib/hooks/useSettings';
import { URL_CONFIGURABLE_PROVIDERS } from '~/lib/stores/settings';
import type { IProviderConfig } from '~/types/model';
import { logStore } from '~/lib/stores/logs';
import { motion } from 'framer-motion';
import { classNames } from '~/utils/classNames';
import { toast } from 'react-toastify';
import { providerBaseUrlEnvKeys } from '~/utils/constants';
import { SiAmazon, SiGoogle, SiHuggingface, SiPerplexity, SiOpenai } from 'react-icons/si';
import { BsRobot, BsCloud } from 'react-icons/bs';
import { TbBrain, TbCloudComputing } from 'react-icons/tb';
import { BiCodeBlock, BiChip } from 'react-icons/bi';
import { FaCloud, FaBrain } from 'react-icons/fa';
import type { IconType } from 'react-icons';

type ProviderName =
  | 'AmazonBedrock'
  | 'Anthropic'
  | 'Cohere'
  | 'Deepseek'
  | 'Google'
  | 'Groq'
  | 'HuggingFace'
  | 'Hyperbolic'
  | 'Mistral'
  | 'OpenAI'
  | 'OpenRouter'
  | 'Perplexity'
  | 'Together'
  | 'XAI';

const PROVIDER_ICONS: Record<ProviderName, IconType> = {
  AmazonBedrock: SiAmazon,
  Anthropic: FaBrain,
  Cohere: BiChip,
  Deepseek: BiCodeBlock,
  Google: SiGoogle,
  Groq: BsCloud,
  HuggingFace: SiHuggingface,
  Hyperbolic: TbCloudComputing,
  Mistral: TbBrain,
  OpenAI: SiOpenai,
  OpenRouter: FaCloud,
  Perplexity: SiPerplexity,
  Together: BsCloud,
  XAI: BsRobot,
};

const PROVIDER_DESCRIPTIONS: Partial<Record<ProviderName, string>> = {
  Anthropic: 'Claude (qualidade/razão). Requer chave própria.',
  OpenAI: 'Modelos GPT. Requer chave própria.',
  OpenRouter: 'Vários modelos com uma única API (alguns gratuitos).',
  Google: 'Modelos Gemini (chave própria).',
  Mistral: 'Modelos rápidos e baratos (chave própria).',
  Deepseek: 'Modelos ótimos em código (chave própria).',
  HuggingFace: 'Inference API/Endpoints (pode exigir chave).',
  Groq: 'Serviço rápido para modelos suportados (chave própria).',
};

const CloudProvidersTab = () => {
  const settings = useSettings();
  const [editingProvider, setEditingProvider] = useState<string | null>(null);
  const [filteredProviders, setFilteredProviders] = useState<IProviderConfig[]>([]);
  const [categoryEnabled, setCategoryEnabled] = useState<boolean>(false);

  // monta lista (só cloud)
  useEffect(() => {
    const newFilteredProviders = Object.entries(settings.providers || {})
      .filter(([key]) => !['Ollama', 'LMStudio', 'OpenAILike'].includes(key))
      .map(([key, value]) => ({
        name: key,
        settings: value.settings,
        staticModels: value.staticModels || [],
        getDynamicModels: value.getDynamicModels,
        // estes dois podem ser string OU função em alguns providers
        getApiKeyLink: (value as any).getApiKeyLink,
        labelForGetApiKey: (value as any).labelForGetApiKey,
        icon: value.icon,
      }));

    const sorted = newFilteredProviders.sort((a, b) => a.name.localeCompare(b.name));
    setFilteredProviders(sorted);

    const allEnabled = newFilteredProviders.every((p) => p.settings.enabled);
    setCategoryEnabled(allEnabled);
  }, [settings.providers]);

  const handleToggleCategory = useCallback(
    (enabled: boolean) => {
      filteredProviders.forEach((provider) => {
        settings.updateProviderSettings(provider.name, { ...provider.settings, enabled });
      });
      setCategoryEnabled(enabled);
      toast.success(enabled ? 'Todos os provedores em nuvem ativados' : 'Todos os provedores em nuvem desativados');
    },
    [filteredProviders, settings],
  );

  const handleToggleProvider = useCallback(
    (provider: IProviderConfig, enabled: boolean) => {
      settings.updateProviderSettings(provider.name, { ...provider.settings, enabled });
      if (enabled) {
        logStore.logProvider(`Provider ${provider.name} enabled`, { provider: provider.name });
        toast.success(`${provider.name} ativado`);
      } else {
        logStore.logProvider(`Provider ${provider.name} disabled`, { provider: provider.name });
        toast.success(`${provider.name} desativado`);
      }
    },
    [settings],
  );

  const handleUpdateBaseUrl = useCallback(
    (provider: IProviderConfig, baseUrl: string) => {
      const newBaseUrl: string | undefined = baseUrl.trim() || undefined;
      settings.updateProviderSettings(provider.name, { ...provider.settings, baseUrl: newBaseUrl });
      logStore.logProvider(`Base URL updated for ${provider.name}`, {
        provider: provider.name,
        baseUrl: newBaseUrl,
      });
      toast.success(`${provider.name}: endpoint atualizado`);
      setEditingProvider(null);
    },
    [settings],
  );

  // Testar conexão: usa getDynamicModels se existir (ele já sabe como autenticar)
  const testConnection = async (provider: IProviderConfig) => {
    try {
      if (typeof provider.getDynamicModels === 'function') {
        const result = await provider.getDynamicModels(provider.settings as any);
        const qtd =
          Array.isArray(result) ? result.length : Array.isArray((result as any)?.data) ? (result as any).data.length : 0;
        toast.success(`${provider.name}: conexão OK (${qtd} modelos listados)`);
      } else {
        if (URL_CONFIGURABLE_PROVIDERS.includes(provider.name) && !provider.settings.baseUrl) {
          toast.error(`${provider.name}: defina o endpoint/base URL antes de testar`);
          return;
        }
        toast.success(`${provider.name}: configuração salva`);
      }
    } catch (e: any) {
      toast.error(`${provider.name}: falha ao conectar${e?.message ? ` — ${e.message}` : ''}`);
    }
  };

  // helpers para aceitar string OU função
  const getStringOrCall = (val: unknown): string | undefined => {
    try {
      if (typeof val === 'function') return (val as () => string)();
      if (typeof val === 'string' && val.trim()) return val;
    } catch {}
    return undefined;
  };

  return (
    <div className="space-y-6">
      <motion.div
        className="space-y-4"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <div className="flex items-center justify-between gap-4 mt-8 mb-4">
          <div className="flex items-center gap-2">
            <div
              className={classNames(
                'w-8 h-8 flex items-center justify-center rounded-lg',
                'bg-bolt-elements-background-depth-3',
                'text-purple-500',
              )}
            >
              <TbCloudComputing className="w-5 h-5" />
            </div>
            <div>
              <h4 className="text-md font-medium text-bolt-elements-textPrimary">Cloud Providers</h4>
              <p className="text-sm text-bolt-elements-textSecondary">
                Conecte <b>sua própria</b> API (cobrança na sua conta). Chaves ficam salvas apenas no seu navegador.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-sm text-bolt-elements-textSecondary">Ativar todos</span>
            <Switch checked={categoryEnabled} onCheckedChange={handleToggleCategory} />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredProviders.map((provider, index) => {
            const apiKeyLink = getStringOrCall((provider as any).getApiKeyLink);
            const apiKeyLabel =
              getStringOrCall((provider as any).labelForGetApiKey) || 'Obter API key';

            return (
              <motion.div
                key={provider.name}
                className={classNames(
                  'rounded-lg border bg-bolt-elements-background text-bolt-elements-textPrimary shadow-sm',
                  'bg-bolt-elements-background-depth-2',
                  'hover:bg-bolt-elements-background-depth-3',
                  'transition-all duration-200',
                  'relative overflow-hidden group',
                  'flex flex-col',
                )}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.1 }}
                whileHover={{ scale: 1.02 }}
              >
                <div className="absolute top-0 right-0 p-2 flex gap-1">
                  {URL_CONFIGURABLE_PROVIDERS.includes(provider.name) && (
                    <motion.span
                      className="px-2 py-0.5 text-xs rounded-full bg-purple-500/10 text-purple-500 font-medium"
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                    >
                      Configurable
                    </motion.span>
                  )}
                </div>

                <div className="flex items-start gap-4 p-4">
                  <motion.div
                    className={classNames(
                      'w-10 h-10 flex items-center justify-center rounded-xl',
                      'bg-bolt-elements-background-depth-3 group-hover:bg-bolt-elements-background-depth-4',
                      'transition-all duration-200',
                      provider.settings.enabled ? 'text-purple-500' : 'text-bolt-elements-textSecondary',
                    )}
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.9 }}
                  >
                    <div className={classNames('w-6 h-6', 'transition-transform duration-200', 'group-hover:rotate-12')}>
                      {React.createElement(PROVIDER_ICONS[provider.name as ProviderName] || BsRobot, {
                        className: 'w-full h-full',
                        'aria-label': `${provider.name} logo`,
                      })}
                    </div>
                  </motion.div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-4 mb-2">
                      <div>
                        <h4 className="text-sm font-medium text-bolt-elements-textPrimary group-hover:text-purple-500 transition-colors">
                          {provider.name}
                        </h4>
                        <p className="text-xs text-bolt-elements-textSecondary mt-0.5">
                          {PROVIDER_DESCRIPTIONS[provider.name as keyof typeof PROVIDER_DESCRIPTIONS] ||
                            (URL_CONFIGURABLE_PROVIDERS.includes(provider.name)
                              ? 'Permite configurar endpoint compatível'
                              : 'Integração com provedor em nuvem')}
                        </p>
                      </div>
                      <Switch
                        checked={provider.settings.enabled}
                        onCheckedChange={(checked) => handleToggleProvider(provider, checked)}
                      />
                    </div>

                    {/* endpoint editável quando aplicável */}
                    {provider.settings.enabled && URL_CONFIGURABLE_PROVIDERS.includes(provider.name) && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.2 }}
                      >
                        <div className="flex items-center gap-2 mt-3">
                          {editingProvider === provider.name ? (
                            <input
                              type="text"
                              defaultValue={provider.settings.baseUrl}
                              placeholder={`Endpoint base do ${provider.name}`}
                              className={classNames(
                                'flex-1 px-3 py-1.5 rounded-lg text-sm',
                                'bg-bolt-elements-background-depth-3 border border-bolt-elements-borderColor',
                                'text-bolt-elements-textPrimary placeholder-bolt-elements-textTertiary',
                                'focus:outline-none focus:ring-2 focus:ring-purple-500/30',
                                'transition-all duration-200',
                              )}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleUpdateBaseUrl(provider, e.currentTarget.value);
                                if (e.key === 'Escape') setEditingProvider(null);
                              }}
                              onBlur={(e) => handleUpdateBaseUrl(provider, e.target.value)}
                              autoFocus
                            />
                          ) : (
                            <div
                              className="flex-1 px-3 py-1.5 rounded-lg text-sm cursor-pointer group/url"
                              onClick={() => setEditingProvider(provider.name)}
                            >
                              <div className="flex items-center gap-2 text-bolt-elements-textSecondary">
                                <div className="i-ph:link text-sm" />
                                <span className="group-hover/url:text-purple-500 transition-colors">
                                  {provider.settings.baseUrl || 'Clique para definir o endpoint'}
                                </span>
                              </div>
                            </div>
                          )}
                        </div>
                        {providerBaseUrlEnvKeys[provider.name]?.baseUrlKey && (
                          <div className="mt-2 text-xs text-green-500">
                            <div className="flex items-center gap-1">
                              <div className="i-ph:info" />
                              <span>Endpoint também pode vir do .env</span>
                            </div>
                          </div>
                        )}
                      </motion.div>
                    )}

                    {/* ações */}
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {apiKeyLink && (
                        <a
                          href={apiKeyLink}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs px-2 py-1 rounded-md bg-bolt-elements-item-backgroundDefault hover:bg-bolt-elements-item-backgroundActive text-bolt-elements-textPrimary inline-flex items-center gap-1"
                        >
                          <div className="i-ph:key" /> {apiKeyLabel}
                        </a>
                      )}
                      <button
                        onClick={() => testConnection(provider)}
                        className="text-xs px-2 py-1 rounded-md bg-purple-500/10 text-purple-500 hover:bg-purple-500/20 inline-flex items-center gap-1"
                      >
                        <div className="i-ph:plug-charging" /> Testar conexão
                      </button>
                      <span className="ml-auto text-[11px] text-bolt-elements-textTertiary">
                        As chaves ficam armazenadas <b>localmente</b>.
                      </span>
                    </div>
                  </div>
                </div>

                <motion.div
                  className="absolute inset-0 border-2 border-purple-500/0 rounded-lg pointer-events-none"
                  animate={{
                    borderColor: provider.settings.enabled ? 'rgba(168, 85, 247, 0.2)' : 'rgba(168, 85, 247, 0)',
                    scale: provider.settings.enabled ? 1 : 0.98,
                  }}
                  transition={{ duration: 0.2 }}
                />
              </motion.div>
            );
          })}
        </div>
      </motion.div>
    </div>
  );
};

export default CloudProvidersTab;