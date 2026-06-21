const webGpuUnavailableMessage = 'WebGPU is not available on this browser/device. Try a current desktop Chrome/Edge browser, or a mobile browser/device with WebGPU support enabled.';
const webGpuDeviceLostMessage = 'The browser GPU device was lost while rendering this map. Reload the page, update your browser/GPU drivers, or try another browser/device.';

export interface RendererDeviceLostInfo {
  api?: string;
  message?: string;
  reason?: string | null;
  originalEvent?: unknown;
}

type WebGpuAdapterOptions = GPURequestAdapterOptions & {
  featureLevel?: 'core' | 'compatibility';
};

const webGpuAdapterOptions: WebGpuAdapterOptions = {
  featureLevel: 'compatibility'
};

export async function assertWebGpuAvailable(): Promise<void> {
  if (!('gpu' in navigator)) {
    throw new Error(webGpuUnavailableMessage);
  }

  const adapter = await navigator.gpu.requestAdapter(webGpuAdapterOptions);
  if (!adapter) {
    throw new Error(webGpuUnavailableMessage);
  }
}

export function shouldSkipGpuPipelineWarmup(): boolean {
  return isAppleWebKitBrowser();
}

export function createRendererInitializationError(error: unknown): Error {
  const originalMessage = error instanceof Error ? error.message : String(error);
  const message = originalMessage.includes('this.gl is null') || originalMessage.includes('WebGPUBackend')
    ? webGpuUnavailableMessage
    : `WebGPU renderer failed to initialize: ${originalMessage}`;
  const nextError = new Error(message);
  if (error instanceof Error && error.stack) {
    nextError.stack = error.stack;
  }

  return nextError;
}

export function createRendererRuntimeError(error: unknown): Error {
  if (isKnownGpuDeviceLostError(error)) {
    return createRendererDeviceLostError();
  }

  if (isKnownWebGpuAttributeDisposalError(error)) {
    return createSafariRendererCompatibilityError(error);
  }

  return error instanceof Error ? error : new Error(String(error));
}

export function createRendererDeviceLostError(info?: RendererDeviceLostInfo): Error {
  const details = [
    info?.api ? `${info.api} device lost` : null,
    info?.reason ? `reason: ${info.reason}` : null,
    info?.message ? `message: ${info.message}` : null
  ].filter(Boolean).join('; ');
  const message = details
    ? `${webGpuDeviceLostMessage} Details: ${details}.`
    : webGpuDeviceLostMessage;
  const nextError = new Error(message);
  nextError.name = 'MapSceneRendererDeviceLostError';
  return nextError;
}

function isAppleWebKitBrowser(): boolean {
  const userAgent = navigator.userAgent;
  const vendor = navigator.vendor;
  const isAppleVendor = /Apple/i.test(vendor);
  const isIosLike = /\b(iPad|iPhone|iPod)\b/i.test(userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isSafari = /Safari\//i.test(userAgent) &&
    !/(Chrome|Chromium|CriOS|FxiOS|Edg|OPR|OPiOS)\//i.test(userAgent);

  return isAppleVendor && (isSafari || isIosLike);
}

function createSafariRendererCompatibilityError(error: unknown): Error {
  const originalMessage = error instanceof Error ? error.message : String(error);
  const message = [
    'Safari/WebKit failed while preparing the WebGPU scene.',
    'This browser currently appears incompatible with this renderer path; try a current desktop Chrome or Edge build.',
    `Original error: ${originalMessage}`
  ].join(' ');
  const nextError = new Error(message);
  if (error instanceof Error && error.stack) {
    nextError.stack = error.stack;
  }

  return nextError;
}

function isKnownWebGpuAttributeDisposalError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('buffer.destroy') && message.includes('_getBufferAttribute');
}

function isKnownGpuDeviceLostError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  return normalized.includes('device lost') ||
    normalized.includes('context lost') ||
    normalized.includes('gpu state invalid');
}
