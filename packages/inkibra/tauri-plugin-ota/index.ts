import { convertFileSrc, invoke } from '@tauri-apps/api/core';

export enum UpdateStatus {
  Ready = 'ready',
  Error = 'error',
}

export type UpdateInfo = {
  update?: string;
  manifest?: {
    version: string;
    url: string;
    hash: string;
    notes?: string;
  };
  error?: string;
};

export type BundleFormat = 'esm' | 'iife';

export type ClientBundleChunk = {
  url: string;
  hash?: string;
  fullHash?: string;
  importPath?: string;
  kind?: 'entry-point' | 'chunk';
};

export type ClientBundleManifest = {
  version: string;
  buildNumber?: number;
  entryUrl: string;
  entryHash?: string;
  entryFullHash: string;
  chunks: ClientBundleChunk[];
  chunkMap?: Record<string, string>;
  cssUrl?: string;
  cssHash?: string;
  format?: BundleFormat;
};

export type BundleUpdateInfo = {
  manifest?: ClientBundleManifest;
  basePath?: string;
  update?: boolean;
  error?: string;
};

export type DevManifestPrimarySource = {
  label: string;
  manifestUrl: string;
};

export type PrepareOptions = {
  devManifestPrompt?: boolean;
  devManifestPrimarySources?: DevManifestPrimarySource[];
  devManifestManualHistoryLimit?: number;
};

// Store for registered startup handlers
const registeredStartupHandlers: Array<() => void | Promise<void>> = [];
let updateInfo: UpdateInfo | undefined;
let prepared = false;
let started = false;
let startInProgress = false;

let bundleUpdateInfo: BundleUpdateInfo | undefined;
let bundlePrepared = false;
let bundleStarted = false;
let bundleStartInProgress = false;

const DEV_MANIFEST_LAST_MANUAL_KEY = 'otaManifestLastManual';
const DEV_MANIFEST_MANUAL_HISTORY_KEY = 'otaManifestManualHistory';
const DEFAULT_MANUAL_HISTORY_LIMIT = 10;
let devManifestOverrideInitialized = false;
let devManifestOverrideResolved: string | undefined;

function normalizeManualHistoryLimit(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_MANUAL_HISTORY_LIMIT;
  }
  const normalized = Math.floor(value);
  if (normalized <= 0) {
    return DEFAULT_MANUAL_HISTORY_LIMIT;
  }
  return normalized;
}

function normalizeStoredManual(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeStoredManualList(values: unknown): string[] {
  if (!Array.isArray(values)) {
    return [];
  }
  const deduped: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = normalizeStoredManual(value);
    if (!normalized) {
      continue;
    }
    const dedupeKey = normalized.toLowerCase();
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);
    deduped.push(normalized);
  }
  return deduped;
}

function getStoredLastManualOverride(): string | undefined {
  try {
    const value = window.localStorage.getItem(DEV_MANIFEST_LAST_MANUAL_KEY);
    return value ? value : undefined;
  } catch {
    return undefined;
  }
}

function setStoredLastManualOverride(value?: string) {
  try {
    if (!value) {
      window.localStorage.removeItem(DEV_MANIFEST_LAST_MANUAL_KEY);
      return;
    }
    window.localStorage.setItem(DEV_MANIFEST_LAST_MANUAL_KEY, value);
  } catch {
    return;
  }
}

function getStoredManualHistory(
  historyLimit = DEFAULT_MANUAL_HISTORY_LIMIT,
): string[] {
  const safeHistoryLimit = normalizeManualHistoryLimit(historyLimit);
  try {
    const value = window.localStorage.getItem(DEV_MANIFEST_MANUAL_HISTORY_KEY);
    if (!value) {
      return [];
    }
    const parsed = JSON.parse(value) as unknown;
    return normalizeStoredManualList(parsed).slice(0, safeHistoryLimit);
  } catch {
    return [];
  }
}

function setStoredManualHistory(values: string[]) {
  try {
    window.localStorage.setItem(
      DEV_MANIFEST_MANUAL_HISTORY_KEY,
      JSON.stringify(values),
    );
  } catch {
    return;
  }
}

function rememberManualOverride(input: string, historyLimit: number): string {
  const manual = normalizeStoredManual(input);
  if (!manual) {
    return input;
  }
  setStoredLastManualOverride(manual);
  const previous = getStoredManualHistory(historyLimit).filter(
    (value) => value.toLowerCase() !== manual.toLowerCase(),
  );
  const next = [manual, ...previous].slice(0, historyLimit);
  setStoredManualHistory(next);
  return manual;
}

function resolveManifestInput(baseUrl: string, input: string): string {
  const normalizedInput = input.trim();
  if (!normalizedInput) {
    return baseUrl;
  }
  try {
    if (normalizedInput.includes('://')) {
      return new URL(normalizedInput).toString();
    }

    const base = new URL(baseUrl);

    const [hostPart, ...pathParts] = normalizedInput.split('/');
    if (hostPart) {
      base.host = hostPart;
    }
    if (pathParts.length > 0) {
      base.pathname = `/${pathParts.join('/')}`;
    }
    return base.toString();
  } catch {
    return baseUrl;
  }
}

function normalizePrimarySources(
  primarySources: PrepareOptions['devManifestPrimarySources'],
): DevManifestPrimarySource[] {
  if (!primarySources) {
    return [];
  }

  return primarySources
    .map((source) => {
      const label = source.label.trim();
      const manifestUrl = source.manifestUrl.trim();
      return {
        label,
        manifestUrl,
      };
    })
    .filter(
      (source) => source.label.length > 0 && source.manifestUrl.length > 0,
    );
}

type ManifestChooserResult =
  | { kind: 'fallback' }
  | { kind: 'primary'; source: DevManifestPrimarySource }
  | { kind: 'last-manual'; value: string }
  | { kind: 'manual'; value: string };

function chooseManifestSource(
  primarySources: DevManifestPrimarySource[],
  previousManualOverrides: string[],
  lastManualOverride: string | undefined,
): Promise<ManifestChooserResult> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined' || !document.body) {
      resolve({ kind: 'fallback' });
      return;
    }

    const overlay = document.createElement('div');
    overlay.style.position = 'fixed';
    overlay.style.inset = '0';
    overlay.style.zIndex = '2147483647';
    overlay.style.background = 'rgba(0, 0, 0, 0.75)';
    overlay.style.display = 'flex';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.padding = '20px';

    const card = document.createElement('div');
    card.style.width = '100%';
    card.style.maxWidth = '520px';
    card.style.background = '#0f1115';
    card.style.border = '1px solid rgba(255,255,255,0.15)';
    card.style.borderRadius = '14px';
    card.style.padding = '16px';
    card.style.color = '#f5f5f5';
    card.style.fontFamily = 'system-ui, -apple-system, sans-serif';

    const title = document.createElement('div');
    title.textContent = 'OTA Manifest Source (Dev)';
    title.style.fontSize = '17px';
    title.style.fontWeight = '700';
    title.style.marginBottom = '10px';

    const desc = document.createElement('div');
    desc.textContent = 'Pick manifest source before OTA fetch.';
    desc.style.fontSize = '13px';
    desc.style.opacity = '0.8';
    desc.style.marginBottom = '12px';

    const sectionContainer = document.createElement('div');
    sectionContainer.style.display = 'grid';
    sectionContainer.style.gridTemplateColumns = '1fr';
    sectionContainer.style.gap = '10px';

    const createSectionTitle = (label: string) => {
      const sectionTitle = document.createElement('div');
      sectionTitle.textContent = label;
      sectionTitle.style.fontSize = '12px';
      sectionTitle.style.fontWeight = '700';
      sectionTitle.style.letterSpacing = '0.04em';
      sectionTitle.style.textTransform = 'uppercase';
      sectionTitle.style.opacity = '0.75';
      return sectionTitle;
    };

    const input = document.createElement('input');
    input.type = 'text';
    input.value = '';
    input.placeholder = 'hostname/path or full URL';
    input.style.width = '100%';
    input.style.boxSizing = 'border-box';
    input.style.padding = '10px';
    input.style.borderRadius = '8px';
    input.style.border = '1px solid rgba(255,255,255,0.2)';
    input.style.background = '#131722';
    input.style.color = '#fff';
    input.style.marginBottom = '12px';

    const createButton = (label: string, subtitle?: string) => {
      const btn = document.createElement('button');
      btn.style.textAlign = 'left';
      btn.style.padding = '10px 12px';
      btn.style.borderRadius = '8px';
      btn.style.border = '1px solid rgba(255,255,255,0.2)';
      btn.style.background = '#1d2433';
      btn.style.color = '#fff';
      btn.style.fontWeight = '600';
      btn.style.display = 'grid';
      btn.style.gridTemplateColumns = '1fr';
      btn.style.gap = '4px';

      const title = document.createElement('span');
      title.textContent = label;
      title.style.fontSize = '13px';
      btn.appendChild(title);

      if (subtitle) {
        const subtitleElem = document.createElement('span');
        subtitleElem.textContent = subtitle;
        subtitleElem.style.fontSize = '11px';
        subtitleElem.style.fontWeight = '500';
        subtitleElem.style.opacity = '0.75';
        subtitleElem.style.wordBreak = 'break-word';
        btn.appendChild(subtitleElem);
      }

      return btn;
    };

    const done = (result: ManifestChooserResult) => {
      overlay.remove();
      resolve(result);
    };

    if (primarySources.length > 0) {
      sectionContainer.appendChild(createSectionTitle('Primary domains'));
      primarySources.forEach((source) => {
        const primaryBtn = createButton(source.label, source.manifestUrl);
        primaryBtn.onclick = () => done({ kind: 'primary', source });
        sectionContainer.appendChild(primaryBtn);
      });
    }

    const previousManualWithoutLast = previousManualOverrides.filter(
      (value) =>
        !lastManualOverride ||
        value.toLowerCase() !== lastManualOverride.toLowerCase(),
    );

    if (previousManualWithoutLast.length > 0) {
      sectionContainer.appendChild(
        createSectionTitle('Previous manual overrides'),
      );
      const previousManualList = document.createElement('div');
      previousManualList.style.display = 'grid';
      previousManualList.style.gridTemplateColumns = '1fr';
      previousManualList.style.gap = '8px';
      previousManualList.style.maxHeight = '180px';
      previousManualList.style.overflowY = 'auto';
      previousManualList.style.paddingRight = '4px';

      previousManualWithoutLast.forEach((value) => {
        const manualEntryBtn = createButton(value);
        manualEntryBtn.onclick = () => done({ kind: 'manual', value });
        previousManualList.appendChild(manualEntryBtn);
      });

      sectionContainer.appendChild(previousManualList);
    }

    const lastManualButton = createButton(
      'Use last used manual override',
      lastManualOverride,
    );
    if (lastManualOverride) {
      lastManualButton.onclick = () =>
        done({ kind: 'last-manual', value: lastManualOverride });
    } else {
      lastManualButton.disabled = true;
      lastManualButton.style.opacity = '0.5';
    }
    sectionContainer.appendChild(lastManualButton);

    sectionContainer.appendChild(createSectionTitle('Enter manual override'));

    const manualButton = createButton('Use entered manual override');
    manualButton.onclick = () => {
      const value = normalizeStoredManual(input.value);
      if (!value) {
        done({ kind: 'fallback' });
        return;
      }
      done({ kind: 'manual', value });
    };

    input.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') {
        return;
      }
      event.preventDefault();
      manualButton.click();
    });

    sectionContainer.appendChild(input);
    sectionContainer.appendChild(manualButton);

    if (primarySources.length === 0 && !lastManualOverride) {
      const fallbackButton = createButton(
        'Use current manifest URL',
        undefined,
      );
      fallbackButton.onclick = () => done({ kind: 'fallback' });
      sectionContainer.appendChild(fallbackButton);
    }

    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) {
        done({ kind: 'fallback' });
      }
    });

    card.appendChild(title);
    card.appendChild(desc);
    card.appendChild(sectionContainer);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
  });
}

async function resolveManifestUrl(
  manifestUrl: string,
  options?: PrepareOptions,
): Promise<string> {
  if (options?.devManifestPrompt !== true) {
    console.info(
      '[OTA] Dev manifest prompt disabled; using default manifest URL',
    );
    return manifestUrl;
  }

  if (typeof window === 'undefined') {
    console.info('[OTA] No window context; using default manifest URL');
    return manifestUrl;
  }

  if (devManifestOverrideInitialized) {
    console.info('[OTA] Reusing manifest URL for current launch');
    return devManifestOverrideResolved ?? manifestUrl;
  }

  devManifestOverrideInitialized = true;
  const primarySources = normalizePrimarySources(
    options?.devManifestPrimarySources,
  );
  const manualHistoryLimit = normalizeManualHistoryLimit(
    options?.devManifestManualHistoryLimit,
  );
  const manualHistory = getStoredManualHistory(manualHistoryLimit);
  const lastManualOverride = getStoredLastManualOverride();

  const selection = await chooseManifestSource(
    primarySources,
    manualHistory,
    lastManualOverride,
  );

  if (selection.kind === 'primary') {
    devManifestOverrideResolved = resolveManifestInput(
      manifestUrl,
      selection.source.manifestUrl,
    );
    console.info(
      '[OTA] Selected primary manifest URL',
      selection.source.label,
      devManifestOverrideResolved,
    );
    return devManifestOverrideResolved;
  }

  if (selection.kind === 'last-manual' || selection.kind === 'manual') {
    const storedManual = rememberManualOverride(
      selection.value,
      manualHistoryLimit,
    );
    devManifestOverrideResolved = resolveManifestInput(
      manifestUrl,
      storedManual,
    );
    console.info(
      '[OTA] Selected manual manifest URL',
      devManifestOverrideResolved,
    );
    return devManifestOverrideResolved;
  }

  devManifestOverrideResolved = manifestUrl;
  console.info('[OTA] Falling back to provided manifest URL', manifestUrl);
  return manifestUrl;
}

function injectLink(attributes: Record<string, string>) {
  const link = document.createElement('link');
  Object.entries(attributes).forEach(([key, value]) => {
    link.setAttribute(key, value);
  });
  document.head.appendChild(link);
}

function injectScript(
  src: string,
  format: BundleFormat,
  onLoad?: () => void,
  onError?: () => void,
) {
  const script = document.createElement('script');
  script.src = src;
  script.async = true;
  script.defer = true;
  if (format === 'esm') {
    script.type = 'module';
  }
  if (onLoad) {
    script.onload = onLoad;
  }
  if (onError) {
    script.onerror = onError;
  }
  document.head.appendChild(script);
}

/**
 * Prepare the app by checking for updates and applying them if available
 * @param manifestUrl URL to the update manifest JSON
 * @returns Information about the update status including content if update is available
 */
export async function prepare(
  manifestUrl: string,
  options?: PrepareOptions,
): Promise<UpdateInfo> {
  if (prepared) {
    throw new Error('App already prepared');
  }
  const resolvedManifestUrl = await resolveManifestUrl(manifestUrl, options);
  const result = await invoke<UpdateInfo>('plugin:ota|prepare', {
    payload: { manifestUrl: resolvedManifestUrl },
  });
  updateInfo = result;
  prepared = true;
  return result;
}

/**
 * Start the app by loading the appropriate JavaScript file
 * Using Blob for dynamic loading if update is available
 * @param updateInfo Optional update info from prepare() call
 */
export async function start(): Promise<void> {
  console.info('Starting app...');

  if (!prepared) {
    throw new Error('App not prepared');
  }
  if (started || startInProgress) {
    throw new Error('App already started');
  }

  startInProgress = true;

  const onScriptLoaded = () => {
    started = true;
    startInProgress = false;
  };

  const onScriptError = () => {
    startInProgress = false;
  };

  // Check if we have an update
  if (updateInfo?.update) {
    console.info('Loading update from content...');

    // Create a blob from the update content
    const blob = new Blob([updateInfo.update], {
      type: 'application/javascript',
    });
    const scriptURL = URL.createObjectURL(blob);

    // Create script element
    const script = document.createElement('script');
    script.src = scriptURL;
    script.async = true;
    script.defer = true;

    // Clean up the URL when the script is loaded
    script.onload = () => {
      URL.revokeObjectURL(scriptURL);
      onScriptLoaded();
    };
    script.onerror = onScriptError;

    // Append to document
    document.head.appendChild(script);
  } else {
    console.info('Loading default bundled script...');

    // Create script element for bundled app.js
    const script = document.createElement('script');
    script.src = './app.js';
    script.async = true;
    script.defer = true;
    script.onload = onScriptLoaded;
    script.onerror = onScriptError;

    // Append to document
    document.head.appendChild(script);
  }
}

/**
 * Prepare a bundle update using a client bundle manifest.
 * @param manifestUrl URL to the client bundle manifest JSON
 */
export async function prepareBundle(
  manifestUrl: string,
  options?: PrepareOptions,
): Promise<BundleUpdateInfo> {
  if (bundlePrepared) {
    throw new Error('App already prepared');
  }
  const resolvedManifestUrl = await resolveManifestUrl(manifestUrl, options);
  const result = await invoke<BundleUpdateInfo>('plugin:ota|prepare_bundle', {
    payload: { manifestUrl: resolvedManifestUrl },
  });
  bundleUpdateInfo = result;
  bundlePrepared = true;
  return result;
}

/**
 * Start the app using the extracted bundle assets.
 */
export async function startBundle(): Promise<void> {
  console.info('Starting bundle app...');

  if (!bundlePrepared) {
    throw new Error('App not prepared');
  }
  if (bundleStarted || bundleStartInProgress) {
    throw new Error('App already started');
  }

  bundleStartInProgress = true;

  const onBundleScriptLoaded = () => {
    bundleStarted = true;
    bundleStartInProgress = false;
  };

  const onBundleScriptError = () => {
    bundleStartInProgress = false;
  };

  try {
    const manifest = bundleUpdateInfo?.manifest;

    if (!manifest) {
      console.info('Falling back to bundled script...');
      const script = document.createElement('script');
      script.src = './app.js';
      script.async = true;
      script.defer = true;
      script.onload = onBundleScriptLoaded;
      script.onerror = onBundleScriptError;
      document.head.appendChild(script);
      return;
    }

    const format = manifest.format ?? 'esm';
    const preloadChunks = manifest.chunks.filter(
      (chunk) => chunk.kind === 'chunk',
    );

    preloadChunks.forEach((chunk) => {
      const href = convertFileSrc(chunk.url);
      if (format === 'esm') {
        injectLink({ rel: 'modulepreload', href });
      } else {
        injectLink({ rel: 'preload', href, as: 'script' });
      }
    });

    if (manifest.cssUrl) {
      const href = convertFileSrc(manifest.cssUrl);
      injectLink({ rel: 'stylesheet', href });
    }

    const entrySrc = convertFileSrc(manifest.entryUrl);
    injectScript(entrySrc, format, onBundleScriptLoaded, onBundleScriptError);
  } catch (error) {
    bundleStartInProgress = false;
    throw error;
  }
}

/**
 * Register a startup handler that will be called when the app starts
 * @param handler Function to call when the app starts
 */
export function register(handler: () => void | Promise<void>): void {
  if (started) {
    throw new Error('App already started');
  }
  // Add to the list of handlers
  registeredStartupHandlers.push(handler);

  // Execute immediately if this is called after initial startup
  handler();
}
