// PATH: app/components/chat/Chat.client.tsx

/*
 * @ts-nocheck
 * Preventing TS checks with files presented in the video for a better presentation.
 */
import { useStore } from '@nanostores/react';
import { useSearchParams } from '@remix-run/react';
import type { Message } from 'ai';
import { useChat } from 'ai/react';
import { useAnimate } from 'framer-motion';
import Cookies from 'js-cookie';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { cssTransition, toast, ToastContainer } from 'react-toastify';
import { useMessageParser, usePromptEnhancer, useShortcuts } from '~/lib/hooks';
import { useSettings } from '~/lib/hooks/useSettings';
import { description, useChatHistory } from '~/lib/persistence';
import { chatStore } from '~/lib/stores/chat';
import { logStore } from '~/lib/stores/logs';
import { streamingState } from '~/lib/stores/streaming';
import { supabaseConnection } from '~/lib/stores/supabase';
import { workbenchStore } from '~/lib/stores/workbench';
import type { ProviderInfo } from '~/types/model';
import { DEFAULT_MODEL, DEFAULT_PROVIDER, PROMPT_COOKIE_KEY, PROVIDER_LIST } from '~/utils/constants';
import { debounce } from '~/utils/debounce';
import { cubicEasingFn } from '~/utils/easings';
import { filesToArtifacts } from '~/utils/fileUtils';
import { createScopedLogger, renderLogger } from '~/utils/logger';
import { createSampler } from '~/utils/sampler';
import { getTemplates, selectStarterTemplate } from '~/utils/selectStarterTemplate';
import { BaseChat } from './BaseChat';

const toastAnimation = cssTransition({
  enter: 'animated fadeInRight',
  exit: 'animated fadeOutRight',
});

const logger = createScopedLogger('Chat');

export function Chat() {
  renderLogger.trace('Chat');

  const { ready, initialMessages, storeMessageHistory, importChat, exportChat } = useChatHistory();
  const title = useStore(description);
  useEffect(() => {
    workbenchStore.setReloadedMessages(initialMessages.map((m) => m.id));
  }, [initialMessages]);

  return (
    <>
      {ready && (
        <ChatImpl
          description={title}
          initialMessages={initialMessages}
          exportChat={exportChat}
          storeMessageHistory={storeMessageHistory}
          importChat={importChat}
        />
      )}
      <ToastContainer
        closeButton={({ closeToast }) => {
          return (
            <button className="Toastify__close-button" onClick={closeToast}>
              <div className="i-ph:x text-lg" />
            </button>
          );
        }}
        icon={({ type }) => {
          switch (type) {
            case 'success':
              return <div className="i-ph:check-bold text-bolt-elements-icon-success text-2xl" />;
            case 'error':
              return <div className="i-ph:warning-circle-bold text-bolt-elements-icon-error text-2xl" />;
          }
          return undefined;
        }}
        position="bottom-right"
        pauseOnFocusLoss
        transition={toastAnimation}
        autoClose={3000}
      />
    </>
  );
}

const processSampledMessages = createSampler(
  (options: {
    messages: Message[];
    initialMessages: Message[];
    isLoading: boolean;
    parseMessages: (messages: Message[], isLoading: boolean) => void;
    storeMessageHistory: (messages: Message[]) => Promise<void>;
  }) => {
    const { messages, initialMessages, isLoading, parseMessages, storeMessageHistory } = options;
    parseMessages(messages, isLoading);

    if (messages.length > initialMessages.length) {
      storeMessageHistory(messages).catch((error) => toast.error(error.message));
    }
  },
  50,
);

interface ChatProps {
  initialMessages: Message[];
  storeMessageHistory: (messages: Message[]) => Promise<void>;
  importChat: (description: string, messages: Message[]) => Promise<void>;
  exportChat: () => void;
  description?: string;
}

/**
 * Heurística local (fallback) para escolha automática de provedor/modelo.
 */
function chooseProviderAndModel(opts: {
  message: string;
  hasImages: boolean;
  activeProviders: ProviderInfo[];
  preferred?: { provider?: ProviderInfo; model?: string };
}) {
  const { message, hasImages, activeProviders } = opts;
  const isCodey = /```|function|class|<div|const |let |var |import |def |public |private |;|{|\(|<\/?[\w-]+>/.test(
    message || '',
  );
  const short = (message || '').length <= 1200;

  const byName = (name: string) => activeProviders.find((p) => p.name.toLowerCase() === name.toLowerCase());

  const lmstudio = byName('LMStudio');
  const ollama = byName('Ollama');
  const openrouter = byName('OpenRouter');
  const openai = byName('OpenAI');

  // LM Studio (OpenAI-compatible) → IDs com hífen
  if (lmstudio && short && !hasImages) {
    const model = isCodey ? 'qwen2.5-coder-7b-instruct' : 'meta-llama-3.1-8b-instruct';
    return { provider: lmstudio, model };
  }

  // Ollama → aliases com dois-pontos
  if (ollama && short && !hasImages) {
    const model = isCodey ? 'deepseek-coder:6.7b' : 'llama3.1:8b';
    return { provider: ollama, model };
  }

  if (openrouter) {
    if (isCodey && short && !hasImages) {
      return { provider: openrouter, model: 'deepseek/deepseek-coder' };
    }

    if (hasImages || !short) {
      return { provider: openrouter, model: 'openai/gpt-4o-mini' };
    }

    return { provider: openrouter, model: 'meta-llama/llama-3.1-8b-instruct' };
  }

  if (openai) {
    if (hasImages || !short) {
      return { provider: openai, model: 'gpt-4o-mini' };
    }

    return { provider: openai, model: 'gpt-4o-mini' };
  }

  const first = activeProviders?.[0];

  return first
    ? { provider: first, model: undefined }
    : { provider: { name: 'OpenRouter' } as ProviderInfo, model: 'meta-llama/llama-3.1-8b-instruct' };
}

/**
 * Tenta delegar a escolha para a factory central (se existir); senão usa a heurística acima.
 */
async function resolveAutoProviderModel(opts: {
  message: string;
  hasImages: boolean;
  activeProviders: ProviderInfo[];
}) {
  try {
    const mod = await import('~/components/@settings/tabs/providers/service-status/provider-factory');

    if (mod && typeof mod.resolveAutoProviderModel === 'function') {
      return await mod.resolveAutoProviderModel(opts);
    }
  } catch {
    // módulo ausente ou erro de carregamento → usa fallback local
  }
  return chooseProviderAndModel(opts);
}

export const ChatImpl = memo(
  ({ description, initialMessages, storeMessageHistory, importChat, exportChat }: ChatProps) => {
    useShortcuts();

    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const [chatStarted, setChatStarted] = useState(initialMessages.length > 0);
    const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
    const [imageDataList, setImageDataList] = useState<string[]>([]);
    const [searchParams, setSearchParams] = useSearchParams();
    const [fakeLoading, setFakeLoading] = useState(false);
    const files = useStore(workbenchStore.files);
    const actionAlert = useStore(workbenchStore.alert);
    const deployAlert = useStore(workbenchStore.deployAlert);
    const supabaseConn = useStore(supabaseConnection);
    const selectedProject = supabaseConn.stats?.projects?.find(
      (project) => project.id === supabaseConn.selectedProjectId,
    );
    const supabaseAlert = useStore(workbenchStore.supabaseAlert);
    const { activeProviders, promptId, autoSelectTemplate, contextOptimizationEnabled } = useSettings();

    const [model, setModel] = useState(() => {
      const savedModel = Cookies.get('selectedModel');
      return savedModel || DEFAULT_MODEL;
    });
    const [provider, setProvider] = useState(() => {
      const savedProvider = Cookies.get('selectedProvider');
      return (PROVIDER_LIST.find((p) => p.name === savedProvider) || DEFAULT_PROVIDER) as ProviderInfo;
    });

    const { showChat } = useStore(chatStore);
    const [animationScope, animate] = useAnimate();
    const [apiKeys, setApiKeys] = useState<Record<string, string>>({});

    const {
      messages,
      isLoading,
      input,
      handleInputChange,
      setInput,
      stop,
      append,
      setMessages,
      reload,
      error,
      data: chatData,
      setData,
    } = useChat({
      api: '/api/chat',
      body: {
        apiKeys,
        files,
        promptId,
        contextOptimization: contextOptimizationEnabled,
        supabase: {
          isConnected: supabaseConn.isConnected,
          hasSelectedProject: !!selectedProject,
          credentials: {
            supabaseUrl: supabaseConn?.credentials?.supabaseUrl,
            anonKey: supabaseConn?.credentials?.anonKey,
          },
        },
      },
      sendExtraMessageFields: true,
      onError: (e) => {
        logger.error('Request failed\n\n', e, error);
        logStore.logError('Chat request failed', e, {
          component: 'Chat',
          action: 'request',
          error: e.message,
        });
        toast.error(
          'There was an error processing your request: ' + (e.message ? e.message : 'No details were returned'),
        );
      },
      onFinish: (message, response) => {
        const usage = response.usage;
        setData(undefined);

        if (usage) {
          console.log('Token usage:', usage);
          logStore.logProvider('Chat response completed', {
            component: 'Chat',
            action: 'response',
            model,
            provider: provider.name,
            usage,
            messageLength: message.content.length,
          });
        }

        logger.debug('Finished streaming');
      },
      initialMessages,
      initialInput: Cookies.get(PROMPT_COOKIE_KEY) || '',
    });

    useEffect(() => {
      const prompt = searchParams.get('prompt');

      if (prompt) {
        setSearchParams({});
        runAnimation();

        (async () => {
          const { provider: resolvedP, model: resolvedM } =
            provider?.name === 'Automatic' || model === 'auto'
              ? await resolveAutoProviderModel({
                  message: prompt,
                  hasImages: false,
                  activeProviders,
                })
              : { provider, model };

          append({
            role: 'user',
            content: [
              {
                type: 'text',
                text: `[Model: ${resolvedM ?? model}]\n\n[Provider: ${resolvedP?.name ?? provider.name}]\n\n${prompt}`,
              },
            ] as any,
          });
        })();
      }
    }, [model, provider, searchParams]);

    const { enhancingPrompt, promptEnhanced, enhancePrompt, resetEnhancer } = usePromptEnhancer();
    const { parsedMessages, parseMessages } = useMessageParser();

    const TEXTAREA_MAX_HEIGHT = chatStarted ? 400 : 200;

    useEffect(() => {
      chatStore.setKey('started', initialMessages.length > 0);
    }, []);

    useEffect(() => {
      processSampledMessages({
        messages,
        initialMessages,
        isLoading,
        parseMessages,
        storeMessageHistory,
      });
    }, [messages, isLoading, parseMessages]);

    const scrollTextArea = () => {
      const textarea = textareaRef.current;

      if (textarea) {
        textarea.scrollTop = textarea.scrollHeight;
      }
    };

    const abort = () => {
      stop();
      chatStore.setKey('aborted', true);
      workbenchStore.abortAllActions();

      logStore.logProvider('Chat response aborted', {
        component: 'Chat',
        action: 'abort',
        model,
        provider: provider.name,
      });
    };

    useEffect(() => {
      const textarea = textareaRef.current;

      if (textarea) {
        textarea.style.height = 'auto';

        const scrollHeight = textarea.scrollHeight;
        textarea.style.height = `${Math.min(scrollHeight, TEXTAREA_MAX_HEIGHT)}px`;
        textarea.style.overflowY = scrollHeight > TEXTAREA_MAX_HEIGHT ? 'auto' : 'hidden';
      }
    }, [input, textareaRef]);

    const runAnimation = async () => {
      if (chatStarted) {
        return;
      }

      await Promise.all([
        animate('#examples', { opacity: 0, display: 'none' }, { duration: 0.1 }),
        animate('#intro', { opacity: 0, flex: 1 }, { duration: 0.2, ease: cubicEasingFn }),
      ]);

      chatStore.setKey('started', true);
      setChatStarted(true);
    };

    const sendMessage = async (_event: React.UIEvent, messageInput?: string) => {
      const messageContent = messageInput || input;

      if (!messageContent?.trim()) {
        return;
      }

      if (isLoading) {
        abort();
        return;
      }

      const finalMessageContent = messageContent;
      runAnimation();

      const hasImages = (imageDataList?.length ?? 0) > 0;

      const { provider: resolvedProvider, model: resolvedModel } =
        provider?.name === 'Automatic' || model === 'auto'
          ? await resolveAutoProviderModel({
              message: finalMessageContent,
              hasImages,
              activeProviders,
            })
          : { provider, model };

      const MODEL_TAG = `[Model: ${resolvedModel ?? model}]`;
      const PROVIDER_TAG = `[Provider: ${resolvedProvider?.name ?? provider.name}]`;

      if (!chatStarted) {
        setFakeLoading(true);

        if (autoSelectTemplate) {
          const { template, title } = await selectStarterTemplate({
            message: finalMessageContent,
            model: resolvedModel ?? model,
            provider: resolvedProvider ?? provider,
          });

          if (template !== 'blank') {
            const temResp = await getTemplates(template, title).catch((e) => {
              if (e.message.includes('rate limit')) {
                toast.warning('Rate limit exceeded. Skipping starter template\n Continuing with blank template');
              } else {
                toast.warning('Failed to import starter template\n Continuing with blank template');
              }

              return null;
            });

            if (temResp) {
              const { assistantMessage, userMessage } = temResp;
              setMessages([
                {
                  id: `1-${new Date().getTime()}`,
                  role: 'user',
                  content: [
                    { type: 'text', text: `${MODEL_TAG}\n\n${PROVIDER_TAG}\n\n${finalMessageContent}` },
                    ...imageDataList.map((imageData) => ({ type: 'image', image: imageData })),
                  ] as any,
                },
                { id: `2-${new Date().getTime()}`, role: 'assistant', content: assistantMessage },
                {
                  id: `3-${new Date().getTime()}`,
                  role: 'user',
                  content: `${MODEL_TAG}\n\n${PROVIDER_TAG}\n\n${userMessage}`,
                  annotations: ['hidden'],
                },
              ]);
              reload();
              setInput('');
              Cookies.remove(PROMPT_COOKIE_KEY);
              setUploadedFiles([]);
              setImageDataList([]);
              resetEnhancer();
              textareaRef.current?.blur();
              setFakeLoading(false);

              return;
            }
          }
        }

        // fluxo normal
        setMessages([
          {
            id: `${new Date().getTime()}`,
            role: 'user',
            content: [
              { type: 'text', text: `${MODEL_TAG}\n\n${PROVIDER_TAG}\n\n${finalMessageContent}` },
              ...imageDataList.map((imageData) => ({ type: 'image', image: imageData })),
            ] as any,
          },
        ]);
        reload();
        setFakeLoading(false);
        setInput('');
        Cookies.remove(PROMPT_COOKIE_KEY);
        setUploadedFiles([]);
        setImageDataList([]);
        resetEnhancer();
        textareaRef.current?.blur();

        return;
      }

      if (error != null) {
        setMessages(messages.slice(0, -1));
      }

      const modifiedFiles = workbenchStore.getModifiedFiles();
      chatStore.setKey('aborted', false);

      if (modifiedFiles !== undefined) {
        const userUpdateArtifact = filesToArtifacts(modifiedFiles, `${Date.now()}`);
        append({
          role: 'user',
          content: [
            { type: 'text', text: `${MODEL_TAG}\n\n${PROVIDER_TAG}\n\n${userUpdateArtifact}${finalMessageContent}` },
            ...imageDataList.map((imageData) => ({ type: 'image', image: imageData })),
          ] as any,
        });
        workbenchStore.resetAllFileModifications();
      } else {
        append({
          role: 'user',
          content: [
            { type: 'text', text: `${MODEL_TAG}\n\n${PROVIDER_TAG}\n\n${finalMessageContent}` },
            ...imageDataList.map((imageData) => ({ type: 'image', image: imageData })),
          ] as any,
        });
      }

      setInput('');
      Cookies.remove(PROMPT_COOKIE_KEY);
      setUploadedFiles([]);
      setImageDataList([]);
      resetEnhancer();
      textareaRef.current?.blur();
    };

    const onTextareaChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      handleInputChange(event);
    };

    const debouncedCachePrompt = useCallback(
      debounce((event: React.ChangeEvent<HTMLTextAreaElement>) => {
        const trimmedValue = event.target.value.trim();
        Cookies.set(PROMPT_COOKIE_KEY, trimmedValue, { expires: 30 });
      }, 1000),
      [],
    );

    useEffect(() => {
      const storedApiKeys = Cookies.get('apiKeys');

      if (storedApiKeys) {
        setApiKeys(JSON.parse(storedApiKeys));
      }
    }, []);

    const handleModelChange = (newModel: string) => {
      setModel(newModel);
      Cookies.set('selectedModel', newModel, { expires: 30 });
    };

    const handleProviderChange = (newProvider: ProviderInfo) => {
      setProvider(newProvider);
      Cookies.set('selectedProvider', newProvider.name, { expires: 30 });

      if (newProvider.name === 'Automatic') {
        setModel('auto');
        Cookies.set('selectedModel', 'auto', { expires: 30 });
      }
    };

    return (
      <BaseChat
        ref={animationScope}
        textareaRef={textareaRef}
        input={input}
        showChat={showChat}
        chatStarted={chatStarted}
        isStreaming={isLoading || fakeLoading}
        onStreamingChange={(streaming) => {
          streamingState.set(streaming);
        }}
        enhancingPrompt={enhancingPrompt}
        promptEnhanced={promptEnhanced}
        sendMessage={sendMessage}
        model={model}
        setModel={handleModelChange}
        provider={provider}
        setProvider={handleProviderChange}
        providerList={activeProviders}
        handleInputChange={(e) => {
          onTextareaChange(e);
          debouncedCachePrompt(e);
        }}
        handleStop={abort}
        description={description}
        importChat={importChat}
        exportChat={exportChat}
        messages={messages.map((message, i) => {
          if (message.role === 'user') {
            return message;
          }

          return { ...message, content: parsedMessages[i] || '' };
        })}
        enhancePrompt={() => {
          enhancePrompt(
            input,
            (input) => {
              setInput(input);
              scrollTextArea();
            },
            model,
            provider,
            apiKeys,
          );
        }}
        uploadedFiles={uploadedFiles}
        setUploadedFiles={setUploadedFiles}
        imageDataList={imageDataList}
        setImageDataList={setImageDataList}
        actionAlert={actionAlert}
        clearAlert={() => workbenchStore.clearAlert()}
        supabaseAlert={supabaseAlert}
        clearSupabaseAlert={() => workbenchStore.clearSupabaseAlert()}
        deployAlert={deployAlert}
        clearDeployAlert={() => workbenchStore.clearDeployAlert()}
        data={chatData}
      />
    );
  },
);
