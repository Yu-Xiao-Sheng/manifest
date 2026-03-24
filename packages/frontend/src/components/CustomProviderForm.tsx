import { createSignal, Index, For, Show, type Component } from 'solid-js';
import {
  createCustomProvider,
  updateCustomProvider,
  deleteCustomProvider,
  type CustomProviderModel,
  type CustomProviderData,
} from '../services/api.js';
import { toast } from '../services/toast-store.js';

interface Props {
  agentName: string;
  onCreated: () => void;
  onBack: () => void;
  initialData?: CustomProviderData;
  onDeleted?: () => void;
}

interface ModelRow {
  model_name: string;
  input_price: string;
  output_price: string;
}

const emptyRow = (): ModelRow => ({ model_name: '', input_price: '', output_price: '' });

const toModelRows = (models: CustomProviderModel[]): ModelRow[] =>
  models.map((m) => ({
    model_name: m.model_name,
    input_price:
      m.input_price_per_million_tokens != null ? String(m.input_price_per_million_tokens) : '',
    output_price:
      m.output_price_per_million_tokens != null ? String(m.output_price_per_million_tokens) : '',
  }));

const CustomProviderForm: Component<Props> = (props) => {
  const isEdit = () => !!props.initialData;

  const [name, setName] = createSignal(props.initialData?.name ?? '');
  const [baseUrl, setBaseUrl] = createSignal(props.initialData?.base_url ?? '');
  const [pathSuffix, setPathSuffix] = createSignal(props.initialData?.path_suffix ?? '');
  const [apiKey, setApiKey] = createSignal('');
  const [editingKey, setEditingKey] = createSignal(false);
  const [rows, setRows] = createSignal<ModelRow[]>(
    props.initialData ? toModelRows(props.initialData.models) : [emptyRow()],
  );
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = createSignal(false);

  // Response API configuration
  const [enableResponseAPI, setEnableResponseAPI] = createSignal(
    props.initialData?.enable_response_api ?? false,
  );
  const [responseAPIAudioInput, setResponseAPIAudioInput] = createSignal(
    props.initialData?.response_api_config?.audio?.input ?? false,
  );
  const [responseAPIAudioOutput, setResponseAPIAudioOutput] = createSignal(
    props.initialData?.response_api_config?.audio?.output ?? false,
  );
  const [responseAPIScreenCapture, setResponseAPIScreenCapture] = createSignal(
    props.initialData?.response_api_config?.screen?.capture ?? false,
  );
  const [responseAPIScreenAnalysis, setResponseAPIScreenAnalysis] = createSignal(
    props.initialData?.response_api_config?.screen?.analysis ?? false,
  );
  const [responseAPIStreaming, setResponseAPIStreaming] = createSignal(
    props.initialData?.response_api_config?.streaming ?? false,
  );

  const updateRow = (index: number, field: keyof ModelRow, value: string) => {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, [field]: value } : r)));
  };

  const addRow = () => setRows((prev) => [...prev, emptyRow()]);

  const removeRow = (index: number) => {
    setRows((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)));
  };

  const validModels = () => rows().filter((r) => r.model_name.trim());

  const canSubmit = () => name().trim() && baseUrl().trim() && validModels().length > 0 && !busy();

  const parsePrice = (v: string): number => Number(v.replace(',', '.'));

  const buildModels = (): CustomProviderModel[] =>
    validModels().map((r) => ({
      model_name: r.model_name.trim(),
      ...(r.input_price !== ''
        ? { input_price_per_million_tokens: parsePrice(r.input_price) }
        : {}),
      ...(r.output_price !== ''
        ? { output_price_per_million_tokens: parsePrice(r.output_price) }
        : {}),
      supports_response_api: enableResponseAPI(),
    }));

  const handleCreate = async () => {
    setError(null);
    setBusy(true);
    try {
      const responseAPIConfig = enableResponseAPI()
        ? {
            audio: {
              input: responseAPIAudioInput(),
              output: responseAPIAudioOutput(),
            },
            screen: {
              capture: responseAPIScreenCapture(),
              analysis: responseAPIScreenAnalysis(),
            },
            streaming: responseAPIStreaming(),
          }
        : undefined;

      await createCustomProvider(props.agentName, {
        name: name().trim(),
        base_url: baseUrl().trim(),
        path_suffix: pathSuffix().trim() || null,
        apiKey: apiKey().trim() || undefined,
        enableResponseAPI: enableResponseAPI(),
        responseAPIConfig,
        models: buildModels(),
      });
      toast.success(`${name().trim()} connected`);
      props.onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create provider');
    } finally {
      setBusy(false);
    }
  };

  const handleUpdate = async () => {
    setError(null);
    const responseAPIConfig = enableResponseAPI()
      ? {
          audio: {
            input: responseAPIAudioInput(),
            output: responseAPIAudioOutput(),
          },
          screen: {
            capture: responseAPIScreenCapture(),
            analysis: responseAPIScreenAnalysis(),
          },
          streaming: responseAPIStreaming(),
        }
      : null;

    const data: Record<string, unknown> = {
      name: name().trim(),
      base_url: baseUrl().trim(),
      path_suffix: pathSuffix().trim() || null,
      enableResponseAPI: enableResponseAPI(),
      responseAPIConfig,
      models: buildModels(),
    };
    if (editingKey()) {
      data.apiKey = apiKey().trim() || undefined;
    }

    setBusy(true);
    try {
      await updateCustomProvider(props.agentName, props.initialData!.id, data as never);
      toast.success(`${name().trim()} updated`);
      props.onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update provider');
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    setBusy(true);
    try {
      await deleteCustomProvider(props.agentName, props.initialData!.id);
      toast.success(`${props.initialData!.name} removed`);
      props.onDeleted?.();
    } catch {
      // error toast from fetchMutate
    } finally {
      setBusy(false);
      setShowDeleteConfirm(false);
    }
  };

  const handleSubmit = () => {
    if (isEdit()) handleUpdate();
    else handleCreate();
  };

  return (
    <div
      class="provider-detail"
      style="display: flex; flex-direction: column; height: 100vh; max-height: 100vh; overflow: hidden;"
    >
      <button class="provider-detail__back" onClick={props.onBack} aria-label="Back to providers">
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="m15 18-6-6 6-6" />
        </svg>
      </button>

      <div
        class="routing-modal__header"
        style="border: none; padding: 0; margin-bottom: 20px; flex-shrink: 0;"
      >
        <div>
          <div class="routing-modal__title">
            {isEdit() ? 'Edit custom provider' : 'Add custom provider'}
          </div>
          <div class="routing-modal__subtitle">Connect any OpenAI-compatible endpoint</div>
        </div>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmit()) handleSubmit();
        }}
        style="display: flex; flex-direction: column; flex: 1; min-height: 0;"
      >
        <div style="flex: 1; overflow-y: auto; padding-right: 8px;">
          <div class="provider-detail__field">
            <label class="provider-detail__label" for="cp-name">
              Provider name
            </label>
            <input
              id="cp-name"
              class="provider-detail__input"
              type="text"
              placeholder="e.g. Groq, vLLM, Azure"
              value={name()}
              onInput={(e) => {
                setName(e.currentTarget.value);
                setError(null);
              }}
            />
          </div>

          <div class="provider-detail__field">
            <label class="provider-detail__label" for="cp-base-url">
              Base URL
            </label>
            <input
              id="cp-base-url"
              class="provider-detail__input"
              type="url"
              placeholder="https://api.example.com/v1"
              value={baseUrl()}
              onInput={(e) => {
                setBaseUrl(e.currentTarget.value);
                setError(null);
              }}
            />
          </div>

          <div class="provider-detail__field">
            <label class="provider-detail__label" for="cp-path-suffix">
              Path Suffix{' '}
              <span style="color: hsl(var(--muted-foreground)); font-weight: 400;">
                (optional, defaults to /v1/chat/completions)
              </span>
            </label>
            <input
              id="cp-path-suffix"
              class="provider-detail__input"
              type="text"
              placeholder="e.g. /chat/completions"
              value={pathSuffix()}
              onInput={(e) => {
                setPathSuffix(e.currentTarget.value);
                setError(null);
              }}
            />
          </div>

          <div class="provider-detail__field">
            <label class="provider-detail__label" for="cp-api-key">
              API Key{' '}
              <span style="color: hsl(var(--muted-foreground)); font-weight: 400;">
                (optional for local providers)
              </span>
            </label>
            <Show when={isEdit() && !editingKey()}>
              <div class="provider-detail__key-row">
                <input
                  id="cp-api-key"
                  class="provider-detail__input provider-detail__input--disabled"
                  type="text"
                  value={props.initialData?.has_api_key ? '••••••••••••' : 'No key set'}
                  disabled
                  aria-label="Current API key (masked)"
                />
                <button
                  type="button"
                  class="btn btn--outline btn--sm"
                  onClick={() => {
                    setEditingKey(true);
                    setApiKey('');
                  }}
                >
                  Change
                </button>
              </div>
            </Show>
            <Show when={!isEdit() || editingKey()}>
              <input
                id="cp-api-key"
                class="provider-detail__input provider-detail__input--masked"
                type="text"
                autocomplete="off"
                placeholder="sk-..."
                value={apiKey()}
                onInput={(e) => setApiKey(e.currentTarget.value)}
              />
            </Show>
          </div>

          <div class="provider-detail__field">
            <label
              class="provider-detail__label"
              style="display: flex; align-items: center; gap: 8px;"
            >
              <input
                type="checkbox"
                checked={enableResponseAPI()}
                onInput={(e) => setEnableResponseAPI(e.currentTarget.checked)}
                style="width: auto;"
              />
              Enable OpenAI Response API
            </label>
            <div class="routing-modal__subtitle" style="margin-top: 4px;">
              Enable support for OpenAI's Responses API format (audio, screen capture, etc.)
            </div>
          </div>

          <Show when={enableResponseAPI()}>
            <div
              class="provider-detail__field"
              style="padding: 16px; background: rgba(0,0,0,0.2); border-radius: 8px;"
            >
              <div class="provider-detail__label" style="margin-bottom: 12px;">
                Response API Configuration
              </div>

              <div style="margin-bottom: 12px;">
                <div class="provider-detail__label" style="font-size: 14px; margin-bottom: 8px;">
                  Audio
                </div>
                <label style="display: block; margin-bottom: 4px;">
                  <input
                    type="checkbox"
                    checked={responseAPIAudioInput()}
                    onInput={(e) => setResponseAPIAudioInput(e.currentTarget.checked)}
                    style="width: auto; margin-right: 8px;"
                  />
                  Input (audio input from user)
                </label>
                <label style="display: block;">
                  <input
                    type="checkbox"
                    checked={responseAPIAudioOutput()}
                    onInput={(e) => setResponseAPIAudioOutput(e.currentTarget.checked)}
                    style="width: auto; margin-right: 8px;"
                  />
                  Output (audio output to user)
                </label>
              </div>

              <div style="margin-bottom: 12px;">
                <div class="provider-detail__label" style="font-size: 14px; margin-bottom: 8px;">
                  Screen
                </div>
                <label style="display: block; margin-bottom: 4px;">
                  <input
                    type="checkbox"
                    checked={responseAPIScreenCapture()}
                    onInput={(e) => setResponseAPIScreenCapture(e.currentTarget.checked)}
                    style="width: auto; margin-right: 8px;"
                  />
                  Capture (take screenshots)
                </label>
                <label style="display: block;">
                  <input
                    type="checkbox"
                    checked={responseAPIScreenAnalysis()}
                    onInput={(e) => setResponseAPIScreenAnalysis(e.currentTarget.checked)}
                    style="width: auto; margin-right: 8px;"
                  />
                  Analysis (analyze screen content)
                </label>
              </div>

              <div>
                <label style="display: block;">
                  <input
                    type="checkbox"
                    checked={responseAPIStreaming()}
                    onInput={(e) => setResponseAPIStreaming(e.currentTarget.checked)}
                    style="width: auto; margin-right: 8px;"
                  />
                  Enable streaming responses
                </label>
              </div>
            </div>
          </Show>

          <div class="provider-detail__field">
            <label class="provider-detail__label">Models</label>
            <div class="custom-provider-models">
              <Index each={rows()}>
                {(row, i) => (
                  <div class="custom-provider-model-row">
                    <input
                      class="provider-detail__input custom-provider-model-row__name"
                      type="text"
                      placeholder="Model name"
                      aria-label={`Model ${i + 1} name`}
                      value={row().model_name}
                      onInput={(e) => updateRow(i, 'model_name', e.currentTarget.value)}
                    />
                    <input
                      class="provider-detail__input custom-provider-model-row__price"
                      type="text"
                      inputmode="decimal"
                      placeholder="$/M in"
                      aria-label={`Model ${i + 1} input price per million tokens`}
                      value={row().input_price}
                      onInput={(e) => updateRow(i, 'input_price', e.currentTarget.value)}
                    />
                    <input
                      class="provider-detail__input custom-provider-model-row__price"
                      type="text"
                      inputmode="decimal"
                      placeholder="$/M out"
                      aria-label={`Model ${i + 1} output price per million tokens`}
                      value={row().output_price}
                      onInput={(e) => updateRow(i, 'output_price', e.currentTarget.value)}
                    />
                    <button
                      type="button"
                      class="custom-provider-model-row__remove"
                      onClick={() => removeRow(i)}
                      disabled={rows().length <= 1}
                      aria-label={`Remove model ${i + 1}`}
                      title="Remove"
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M18 6 6 18" />
                        <path d="m6 6 12 12" />
                      </svg>
                    </button>
                  </div>
                )}
              </Index>
              <button
                type="button"
                class="btn btn--outline btn--sm"
                onClick={addRow}
                disabled={!rows().at(-1)?.model_name.trim()}
                style="margin-top: 4px; align-self: flex-start;"
              >
                + Add model
              </button>
            </div>
          </div>

          {error() && (
            <div class="provider-detail__error" role="alert">
              {error()}
            </div>
          )}
        </div>

        {/* Fixed bottom section with save button */}
        <div style="flex-shrink: 0; padding-top: 16px; border-top: 1px solid rgba(255,255,255,0.1);">
          <button
            type="submit"
            class="btn btn--primary btn--sm provider-detail__action"
            disabled={!canSubmit()}
          >
            {busy() ? <span class="spinner" /> : isEdit() ? 'Save changes' : 'Create'}
          </button>

          <Show when={isEdit()}>
            <button
              type="button"
              class="btn btn--outline btn--sm provider-detail__disconnect"
              disabled={busy()}
              onClick={() => setShowDeleteConfirm(true)}
              style="margin-top: 16px; align-self: flex-start;"
            >
              Delete provider
            </button>
          </Show>
        </div>
      </form>

      {/* -- Delete Confirmation Modal -- */}
      <Show when={showDeleteConfirm()}>
        <div
          class="modal-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowDeleteConfirm(false);
          }}
        >
          <div class="modal-card" style="max-width: 400px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--gap-lg);">
              <h3 style="margin: 0; font-size: var(--font-size-lg);">Delete provider</h3>
              <button
                style="background: none; border: none; cursor: pointer; color: hsl(var(--muted-foreground)); padding: 4px;"
                onClick={() => setShowDeleteConfirm(false)}
                aria-label="Close"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </svg>
              </button>
            </div>
            <p style="font-size: var(--font-size-sm); color: hsl(var(--muted-foreground)); margin-bottom: var(--gap-lg);">
              Remove{' '}
              <strong style="color: hsl(var(--foreground));">{props.initialData?.name}</strong>?
              This will delete all its models and any routing assignments using them. This action
              cannot be undone.
            </p>
            <div style="display: flex; gap: var(--gap-sm); justify-content: flex-end;">
              <button
                class="btn btn--outline btn--sm"
                onClick={() => setShowDeleteConfirm(false)}
                disabled={busy()}
              >
                Cancel
              </button>
              <button class="btn btn--danger btn--sm" onClick={handleDelete} disabled={busy()}>
                {busy() ? <span class="spinner" /> : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
};

export default CustomProviderForm;
