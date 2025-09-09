// PATH: app/components/@settings/tabs/providers/local/LocalProvidersTab.tsx
import { AnimatePresence, motion } from 'framer-motion';
import React, { useCallback, useEffect, useState } from 'react';
import type { IconType } from 'react-icons';
import { BiChip } from 'react-icons/bi';
import { BsRobot } from 'react-icons/bs';
import { TbBrandOpenai } from 'react-icons/tb';
import { Progress } from '~/components/ui/Progress';
import { Switch } from '~/components/ui/Switch';
import { useToast } from '~/components/ui/use-toast';
import { useSettings } from '~/lib/hooks/useSettings';
import { logStore } from '~/lib/stores/logs';
import { LOCAL_PROVIDERS, URL_CONFIGURABLE_PROVIDERS } from '~/lib/stores/settings';
import type { IProviderConfig } from '~/types/model';
import { classNames } from '~/utils/classNames';
import { providerBaseUrlEnvKeys } from '~/utils/constants';
import OllamaModelInstaller from './OllamaModelInstaller';

type ProviderName = 'Ollama' | 'LMStudio' | 'OpenAILike';

const PROVIDER_ICONS: Record<ProviderName, IconType> = {
  Ollama: BsRobot,
  LMStudio: BsRobot,
  OpenAILike: TbBrandOpenai,
};

const PROVIDER_DESCRIPTIONS: Record<ProviderName, string> = {
  Ollama: 'Rode modelos open-source 100% locais no seu PC.',
  LMStudio: 'Servidor local compatível com OpenAI (porta 1234).',
  OpenAILike: 'Aponte para qualquer endpoint compatível com OpenAI.',
};

const OLLAMA_API_URL = 'http://127.0.0.1:11434';
const LMSTUDIO_DEFAULT_URL = 'http://127.0.0.1:1234';

/** ---------- Helpers de tipagem segura p/ JSON desconhecido ---------- */
type JsonObj = Record<string, unknown>;

function getArrayLen(obj: unknown, key: 'models' | 'data') {
  if (obj && typeof obj === 'object' && Array.isArray((obj as JsonObj)[key])) {
    return ((obj as JsonObj)[key] as unknown[]).length;
  }

  return 0;
}

/** -------------------------------------------------------------------- */

interface OllamaModel {
  name: string;
  digest: string;
  size: number;
  modified_at: string;
  details?: {
    family: string;
    parameter_size: string;
    quantization_level: string;
  };
  status?: 'idle' | 'updating' | 'updated' | 'error' | 'checking';
  error?: string;
  newDigest?: string;
  progress?: {
    current: number;
    total: number;
    status: string;
  };
}

interface OllamaPullResponse {
  status: string;
  completed?: number;
  total?: number;
  digest?: string;
}

const isOllamaPullResponse = (data: unknown): data is OllamaPullResponse =>
  typeof data === 'object' && data !== null && 'status' in data;

export default function LocalProvidersTab() {
  const { providers, updateProviderSettings } = useSettings();
  const [filteredProviders, setFilteredProviders] = useState<IProviderConfig[]>([]);
  const [categoryEnabled, setCategoryEnabled] = useState(false);
  const [ollamaModels, setOllamaModels] = useState<OllamaModel[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [editingProvider, setEditingProvider] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    const newFilteredProviders = Object.entries(providers || {})
      .filter(([key]) => [...LOCAL_PROVIDERS, 'OpenAILike'].includes(key))
      .map(([key, value]) => {
        const provider = value as IProviderConfig;
        const envKey = providerBaseUrlEnvKeys[key]?.baseUrlKey;
        const envUrl = envKey ? (import.meta.env[envKey] as string | undefined) : undefined;

        if (envUrl && !provider.settings.baseUrl) {
          updateProviderSettings(key, { ...provider.settings, baseUrl: envUrl });
        }

        return {
          name: key,
          settings: { ...provider.settings, baseUrl: provider.settings.baseUrl || envUrl },
          staticModels: provider.staticModels || [],
          getDynamicModels: provider.getDynamicModels,
          getApiKeyLink: provider.getApiKeyLink,
          labelForGetApiKey: provider.labelForGetApiKey,
          icon: provider.icon,
        } as IProviderConfig;
      });

    // ordem amigável: LMStudio, Ollama, OpenAILike
    const sorted = newFilteredProviders.sort((a, b) => {
      const rank = (n: string) => (n === 'LMStudio' ? 0 : n === 'Ollama' ? 1 : n === 'OpenAILike' ? 2 : 3);
      return rank(a.name) - rank(b.name);
    });
    setFilteredProviders(sorted);
  }, [providers, updateProviderSettings]);

  useEffect(() => {
    const newCategoryState = filteredProviders.every((p) => p.settings.enabled);
    setCategoryEnabled(newCategoryState);
  }, [filteredProviders]);

  useEffect(() => {
    const ollamaProvider = filteredProviders.find((p) => p.name === 'Ollama');

    if (ollamaProvider?.settings.enabled) {
      fetchOllamaModels();
    }
  }, [filteredProviders]);

  const fetchOllamaModels = async () => {
    try {
      setIsLoadingModels(true);

      const response = await fetch(`${OLLAMA_API_URL}/api/tags`);
      const data = (await response.json()) as { models: OllamaModel[] };
      setOllamaModels(data.models.map((m) => ({ ...m, status: 'idle' as const })));
    } catch (error) {
      console.error('Error fetching Ollama models:', error);
    } finally {
      setIsLoadingModels(false);
    }
  };

  const updateOllamaModel = async (modelName: string): Promise<boolean> => {
    try {
      const response = await fetch(`${OLLAMA_API_URL}/api/pull`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: modelName }),
      });

      if (!response.ok) {
        throw new Error(`Failed to update ${modelName}`);
      }

      const reader = response.body?.getReader();

      if (!reader) {
        throw new Error('No response reader available');
      }

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        const text = new TextDecoder().decode(value);
        const lines = text.split('\n').filter(Boolean);

        for (const line of lines) {
          const raw = JSON.parse(line);

          if (!isOllamaPullResponse(raw)) {
            continue;
          }

          setOllamaModels((curr) =>
            curr.map((m) =>
              m.name === modelName
                ? {
                    ...m,
                    progress: {
                      current: raw.completed || 0,
                      total: raw.total || 0,
                      status: raw.status,
                    },
                    newDigest: raw.digest,
                  }
                : m,
            ),
          );
        }
      }

      const updated = await fetch(`${OLLAMA_API_URL}/api/tags`);
      const updatedData = (await updated.json()) as { models: OllamaModel[] };

      return !!updatedData.models.find((m) => m.name === modelName);
    } catch (error) {
      console.error(`Error updating ${modelName}:`, error);
      return false;
    }
  };

  const handleToggleCategory = useCallback(
    (enabled: boolean) => {
      filteredProviders.forEach((p) => updateProviderSettings(p.name, { ...p.settings, enabled }));
      toast(enabled ? 'Todos os provedores locais ativados' : 'Todos os provedores locais desativados');
    },
    [filteredProviders, updateProviderSettings, toast],
  );

  const handleToggleProvider = (provider: IProviderConfig, enabled: boolean) => {
    updateProviderSettings(provider.name, { ...provider.settings, enabled });
    logStore.logProvider(`${provider.name} ${enabled ? 'enabled' : 'disabled'}`, { provider: provider.name });
    toast(`${provider.name} ${enabled ? 'ativado' : 'desativado'}`);
  };

  const handleUpdateBaseUrl = (provider: IProviderConfig, newBaseUrl: string) => {
    updateProviderSettings(provider.name, { ...provider.settings, baseUrl: newBaseUrl });
    toast(`${provider.name}: endpoint atualizado`);
    setEditingProvider(null);
  };

  const handleUpdateOllamaModel = async (modelName: string) => {
    const ok = await updateOllamaModel(modelName);
    toast(ok ? `Atualizado ${modelName}` : `Falha ao atualizar ${modelName}`);
  };

  const handleDeleteOllamaModel = async (modelName: string) => {
    try {
      const response = await fetch(`${OLLAMA_API_URL}/api/delete`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: modelName }),
      });

      if (!response.ok) {
        throw new Error(`Failed to delete ${modelName}`);
      }

      setOllamaModels((cur) => cur.filter((m) => m.name !== modelName));
      toast(`Removido ${modelName}`);
    } catch (err) {
      console.error(err);
      toast(`Falha ao remover ${modelName}`);
    }
  };

  // ping simples para provedores locais
  const testLocalProvider = async (provider: IProviderConfig) => {
    try {
      const base = provider.settings.baseUrl?.trim();

      if (!base) {
        toast('Defina o endpoint primeiro');
        return;
      }

      if (provider.name === 'Ollama') {
        const r = await fetch(`${base}/api/tags`);

        if (!r.ok) {
          throw new Error(`HTTP ${r.status}`);
        }

        const j = await r.json().catch(() => ({}));
        toast(`Ollama OK (${getArrayLen(j, 'models')} modelos)`);

        return;
      }

      // LM Studio / OpenAILike: padrão OpenAI /v1/models
      const r = await fetch(`${base.replace(/\/$/, '')}/v1/models`);

      if (!r.ok) {
        throw new Error(`HTTP ${r.status}`);
      }

      const j = await r.json().catch(() => ({}));
      const n = getArrayLen(j, 'data');
      toast(`${provider.name} OK (${n} modelos)`);
    } catch (e: any) {
      toast(`${provider.name}: falha ao conectar${e?.message ? ` — ${e.message}` : ''}`);
    }
  };

  const ModelDetails = ({ model }: { model: OllamaModel }) => (
    <div className="flex items-center gap-3 text-xs text-bolt-elements-textSecondary">
      <div className="flex items-center gap-1">
        <div className="i-ph:code text-purple-500" />
        <span>{model.digest.substring(0, 7)}</span>
      </div>
      {model.details && (
        <>
          <div className="flex items-center gap-1">
            <div className="i-ph:database text-purple-500" />
            <span>{model.details.parameter_size}</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="i-ph:cube text-purple-500" />
            <span>{model.details.quantization_level}</span>
          </div>
        </>
      )}
    </div>
  );

  const ModelActions = ({
    model,
    onUpdate,
    onDelete,
  }: {
    model: OllamaModel;
    onUpdate: () => void;
    onDelete: () => void;
  }) => (
    <div className="flex items-center gap-2">
      <motion.button
        onClick={onUpdate}
        disabled={model.status === 'updating'}
        className={classNames(
          'rounded-lg p-2',
          'bg-purple-500/10 text-purple-500',
          'hover:bg-purple-500/20',
          'transition-all duration-200',
          { 'opacity-50 cursor-not-allowed': model.status === 'updating' },
        )}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        title="Update model"
      >
        {model.status === 'updating' ? (
          <div className="flex items-center gap-2">
            <div className="i-ph:spinner-gap-bold animate-spin w-4 h-4" />
            <span className="text-sm">Atualizando…</span>
          </div>
        ) : (
          <div className="i-ph:arrows-clockwise text-lg" />
        )}
      </motion.button>
      <motion.button
        onClick={onDelete}
        disabled={model.status === 'updating'}
        className={classNames(
          'rounded-lg p-2',
          'bg-red-500/10 text-red-500',
          'hover:bg-red-500/20',
          'transition-all duration-200',
          { 'opacity-50 cursor-not-allowed': model.status === 'updating' },
        )}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        title="Delete model"
      >
        <div className="i-ph:trash text-lg" />
      </motion.button>
    </div>
  );

  return (
    <div
      className={classNames(
        'rounded-lg bg-bolt-elements-background text-bolt-elements-textPrimary shadow-sm p-4',
        'hover:bg-bolt-elements-background-depth-2',
        'transition-all duration-200',
      )}
      role="region"
      aria-label="Local Providers Configuration"
    >
      <motion.div
        className="space-y-6"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        {/* header */}
        <div className="flex items-center justify-between gap-4 border-b border-bolt-elements-borderColor pb-4">
          <div className="flex items-center gap-3">
            <motion.div
              className={classNames(
                'w-10 h-10 flex items-center justify-center rounded-xl',
                'bg-purple-500/10 text-purple-500',
              )}
              whileHover={{ scale: 1.05 }}
            >
              <BiChip className="w-6 h-6" />
            </motion.div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold text-bolt-elements-textPrimary">Modelos Locais</h2>
              </div>
              <p className="text-sm text-bolt-elements-textSecondary">
                Rode modelos **no seu computador**. Seus dados não saem da máquina.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-sm text-bolt-elements-textSecondary">Ativar todos</span>
            <Switch
              checked={categoryEnabled}
              onCheckedChange={handleToggleCategory}
              aria-label="Toggle all local providers"
            />
          </div>
        </div>

        {/* OLLAMA */}
        {filteredProviders
          .filter((p) => p.name === 'Ollama')
          .map((provider) => (
            <motion.div
              key={provider.name}
              className={classNames(
                'bg-bolt-elements-background-depth-2 rounded-xl',
                'hover:bg-bolt-elements-background-depth-3',
                'transition-all duration-200 p-5',
                'relative overflow-hidden group',
              )}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              whileHover={{ scale: 1.01 }}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-4">
                  <motion.div
                    className={classNames(
                      'w-12 h-12 flex items-center justify-center rounded-xl',
                      'bg-bolt-elements-background-depth-3',
                      provider.settings.enabled ? 'text-purple-500' : 'text-bolt-elements-textSecondary',
                    )}
                    whileHover={{ scale: 1.1, rotate: 5 }}
                  >
                    {React.createElement(PROVIDER_ICONS[provider.name as ProviderName] || BsRobot, {
                      className: 'w-7 h-7',
                      'aria-label': `${provider.name} icon`,
                    })}
                  </motion.div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-md font-semibold text-bolt-elements-textPrimary">{provider.name}</h3>
                      <span className="px-2 py-0.5 text-xs rounded-full bg-green-500/10 text-green-500">Local</span>
                    </div>
                    <p className="text-sm text-bolt-elements-textSecondary mt-1">
                      {PROVIDER_DESCRIPTIONS[provider.name as ProviderName]}
                    </p>
                  </div>
                </div>
                <Switch
                  checked={provider.settings.enabled}
                  onCheckedChange={(checked) => handleToggleProvider(provider, checked)}
                  aria-label={`Toggle ${provider.name} provider`}
                />
              </div>

              <AnimatePresence>
                {provider.settings.enabled && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="mt-4"
                  >
                    <div className="flex flex-col gap-2">
                      <label className="text-sm text-bolt-elements-textSecondary">API Endpoint</label>
                      {editingProvider === provider.name ? (
                        <input
                          type="text"
                          defaultValue={provider.settings.baseUrl || OLLAMA_API_URL}
                          placeholder="http://127.0.0.1:11434"
                          className={classNames(
                            'w-full px-3 py-2 rounded-lg text-sm',
                            'bg-bolt-elements-background-depth-3 border border-bolt-elements-borderColor',
                            'text-bolt-elements-textPrimary placeholder-bolt-elements-textTertiary',
                            'focus:outline-none focus:ring-2 focus:ring-purple-500/30',
                            'transition-all duration-200',
                          )}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              handleUpdateBaseUrl(provider, e.currentTarget.value);
                            } else if (e.key === 'Escape') {
                              setEditingProvider(null);
                            }
                          }}
                          onBlur={(e) => handleUpdateBaseUrl(provider, e.target.value)}
                          autoFocus
                        />
                      ) : (
                        <div
                          onClick={() => setEditingProvider(provider.name)}
                          className={classNames(
                            'w-full px-3 py-2 rounded-lg text-sm cursor-pointer',
                            'bg-bolt-elements-background-depth-3 border border-bolt-elements-borderColor',
                            'hover:border-purple-500/30 hover:bg-bolt-elements-background-depth-4',
                            'transition-all duration-200',
                          )}
                        >
                          <div className="flex items-center gap-2 text-bolt-elements-textSecondary">
                            <div className="i-ph:link text-sm" />
                            <span>{provider.settings.baseUrl || OLLAMA_API_URL}</span>
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="mt-3 flex items-center gap-2">
                      <button
                        onClick={() =>
                          testLocalProvider({
                            ...provider,
                            settings: { ...provider.settings, baseUrl: provider.settings.baseUrl || OLLAMA_API_URL },
                          })
                        }
                        className="text-xs px-2 py-1 rounded-md bg-purple-500/10 text-purple-500 hover:bg-purple-500/20 inline-flex items-center gap-1"
                      >
                        <div className="i-ph:plug-charging" /> Testar conexão
                      </button>
                      <span className="text-[11px] text-bolt-elements-textTertiary">
                        Seus prompts e chaves não saem do computador.
                      </span>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* modelos do Ollama */}
              {provider.settings.enabled && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-6 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="i-ph:cube-duotone text-purple-500" />
                      <h4 className="text-sm font-medium text-bolt-elements-textPrimary">Modelos instalados</h4>
                    </div>
                    {isLoadingModels ? (
                      <div className="flex items-center gap-2">
                        <div className="i-ph:spinner-gap-bold animate-spin w-4 h-4" />
                        <span className="text-sm text-bolt-elements-textSecondary">Carregando…</span>
                      </div>
                    ) : (
                      <span className="text-sm text-bolt-elements-textSecondary">{ollamaModels.length} modelos</span>
                    )}
                  </div>

                  <div className="space-y-3">
                    {isLoadingModels ? (
                      <div className="space-y-3">
                        {Array.from({ length: 3 }).map((_, i) => (
                          <div
                            key={i}
                            className="h-20 w-full bg-bolt-elements-background-depth-3 rounded-lg animate-pulse"
                          />
                        ))}
                      </div>
                    ) : ollamaModels.length === 0 ? (
                      <div className="text-center py-8 text-bolt-elements-textSecondary">
                        <div className="i-ph:cube-transparent text-4xl mx-auto mb-2" />
                        <p>Nenhum modelo instalado</p>
                        <p className="text-sm text-bolt-elements-textTertiary px-1">
                          Veja{' '}
                          <a
                            href="https://ollama.com/library"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-purple-500 hover:underline inline-flex items-center gap-0.5 text-base font-medium"
                          >
                            ollama.com/library <div className="i-ph:arrow-square-out text-xs" />
                          </a>{' '}
                          e instale pelo nome.
                        </p>
                      </div>
                    ) : (
                      ollamaModels.map((model) => (
                        <motion.div
                          key={model.name}
                          className={classNames(
                            'p-4 rounded-xl',
                            'bg-bolt-elements-background-depth-3',
                            'hover:bg-bolt-elements-background-depth-4',
                            'transition-all duration-200',
                          )}
                          whileHover={{ scale: 1.01 }}
                        >
                          <div className="flex items-center justify-between">
                            <div className="space-y-2">
                              <div className="flex items-center gap-2">
                                <h5 className="text-sm font-medium text-bolt-elements-textPrimary">{model.name}</h5>
                                <ModelStatusBadge status={model.status} />
                              </div>
                              <ModelDetails model={model} />
                            </div>
                            <ModelActions
                              model={model}
                              onUpdate={() => handleUpdateOllamaModel(model.name)}
                              onDelete={() => {
                                if (window.confirm(`Remover ${model.name}?`)) {
                                  handleDeleteOllamaModel(model.name);
                                }
                              }}
                            />
                          </div>
                          {model.progress && (
                            <div className="mt-3">
                              <Progress
                                value={Math.round((model.progress.current / model.progress.total) * 100)}
                                className="h-1"
                              />
                              <div className="flex justify-between mt-1 text-xs text-bolt-elements-textSecondary">
                                <span>{model.progress.status}</span>
                                <span>{Math.round((model.progress.current / model.progress.total) * 100)}%</span>
                              </div>
                            </div>
                          )}
                        </motion.div>
                      ))
                    )}
                  </div>

                  <OllamaModelInstaller onModelInstalled={fetchOllamaModels} />
                </motion.div>
              )}
            </motion.div>
          ))}

        {/* DEMAIS LOCAIS (LM Studio / OpenAILike) */}
        <div className="border-t border-bolt-elements-borderColor pt-6 mt-8">
          <h3 className="text-lg font-semibold text-bolt-elements-textPrimary mb-4">Outros provedores locais</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {filteredProviders
              .filter((provider) => provider.name !== 'Ollama')
              .map((provider, index) => (
                <motion.div
                  key={provider.name}
                  className={classNames(
                    'bg-bolt-elements-background-depth-2 rounded-xl',
                    'hover:bg-bolt-elements-background-depth-3',
                    'transition-all duration-200 p-5',
                    'relative overflow-hidden group',
                  )}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.1 }}
                  whileHover={{ scale: 1.01 }}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-4">
                      <motion.div
                        className={classNames(
                          'w-12 h-12 flex items-center justify-center rounded-xl',
                          'bg-bolt-elements-background-depth-3',
                          provider.settings.enabled ? 'text-purple-500' : 'text-bolt-elements-textSecondary',
                        )}
                        whileHover={{ scale: 1.1, rotate: 5 }}
                      >
                        {React.createElement(PROVIDER_ICONS[provider.name as ProviderName] || BsRobot, {
                          className: 'w-7 h-7',
                          'aria-label': `${provider.name} icon`,
                        })}
                      </motion.div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="text-md font-semibold text-bolt-elements-textPrimary">{provider.name}</h3>
                          <div className="flex gap-1">
                            <span className="px-2 py-0.5 text-xs rounded-full bg-green-500/10 text-green-500">
                              Local
                            </span>
                            {URL_CONFIGURABLE_PROVIDERS.includes(provider.name) && (
                              <span className="px-2 py-0.5 text-xs rounded-full bg-purple-500/10 text-purple-500">
                                Configurable
                              </span>
                            )}
                          </div>
                        </div>
                        <p className="text-sm text-bolt-elements-textSecondary mt-1">
                          {PROVIDER_DESCRIPTIONS[provider.name as ProviderName]}
                        </p>
                      </div>
                    </div>
                    <Switch
                      checked={provider.settings.enabled}
                      onCheckedChange={(c) => handleToggleProvider(provider, c)}
                      aria-label={`Toggle ${provider.name}`}
                    />
                  </div>

                  <AnimatePresence>
                    {provider.settings.enabled && URL_CONFIGURABLE_PROVIDERS.includes(provider.name) && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="mt-4"
                      >
                        <div className="flex flex-col gap-2">
                          <label className="text-sm text-bolt-elements-textSecondary">API Endpoint</label>
                          {editingProvider === provider.name ? (
                            <input
                              type="text"
                              defaultValue={
                                provider.settings.baseUrl || (provider.name === 'LMStudio' ? LMSTUDIO_DEFAULT_URL : '')
                              }
                              placeholder={provider.name === 'LMStudio' ? LMSTUDIO_DEFAULT_URL : 'http://host:port'}
                              className={classNames(
                                'w-full px-3 py-2 rounded-lg text-sm',
                                'bg-bolt-elements-background-depth-3 border border-bolt-elements-borderColor',
                                'text-bolt-elements-textPrimary placeholder-bolt-elements-textTertiary',
                                'focus:outline-none focus:ring-2 focus:ring-purple-500/30',
                                'transition-all duration-200',
                              )}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  handleUpdateBaseUrl(provider, e.currentTarget.value);
                                } else if (e.key === 'Escape') {
                                  setEditingProvider(null);
                                }
                              }}
                              onBlur={(e) => handleUpdateBaseUrl(provider, e.target.value)}
                              autoFocus
                            />
                          ) : (
                            <div
                              onClick={() => setEditingProvider(provider.name)}
                              className={classNames(
                                'w-full px-3 py-2 rounded-lg text-sm cursor-pointer',
                                'bg-bolt-elements-background-depth-3 border border-bolt-elements-borderColor',
                                'hover:border-purple-500/30 hover:bg-bolt-elements-background-depth-4',
                                'transition-all duration-200',
                              )}
                            >
                              <div className="flex items-center gap-2 text-bolt-elements-textSecondary">
                                <div className="i-ph:link text-sm" />
                                <span>
                                  {provider.settings.baseUrl ||
                                    (provider.name === 'LMStudio' ? LMSTUDIO_DEFAULT_URL : 'Clique para definir')}
                                </span>
                              </div>
                            </div>
                          )}
                        </div>

                        <div className="mt-3">
                          <button
                            onClick={() =>
                              testLocalProvider({
                                ...provider,
                                settings: {
                                  ...provider.settings,
                                  baseUrl:
                                    provider.settings.baseUrl ||
                                    (provider.name === 'LMStudio' ? LMSTUDIO_DEFAULT_URL : provider.settings.baseUrl),
                                },
                              })
                            }
                            className="text-xs px-2 py-1 rounded-md bg-purple-500/10 text-purple-500 hover:bg-purple-500/20 inline-flex items-center gap-1"
                          >
                            <div className="i-ph:plug-charging" /> Testar conexão
                          </button>
                          <span className="ml-2 text-[11px] text-bolt-elements-textTertiary">
                            Compatível com o padrão OpenAI <code>/v1/*</code>.
                          </span>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              ))}
          </div>
        </div>
      </motion.div>
    </div>
  );
}

function ModelStatusBadge({ status }: { status?: string }) {
  if (!status || status === 'idle') {
    return null;
  }

  const statusConfig = {
    updating: { bg: 'bg-yellow-500/10', text: 'text-yellow-500', label: 'Atualizando' },
    updated: { bg: 'bg-green-500/10', text: 'text-green-500', label: 'Atualizado' },
    error: { bg: 'bg-red-500/10', text: 'text-red-500', label: 'Erro' },
  } as const;
  const cfg = (statusConfig as any)[status];

  if (!cfg) {
    return null;
  }

  return (
    <span className={classNames('px-2 py-0.5 rounded-full text-xs font-medium', cfg.bg, cfg.text)}>{cfg.label}</span>
  );
}
