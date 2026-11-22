export type Getter<T> = () => T;
export type Setter<T> = (next: T | ((previous: T) => T)) => void;
export type Signal<T> = [Getter<T>, Setter<T>];

export function signal<T>(value: T): Signal<T>;
export function signal<T>(key: string, value: T): Signal<T>;

export function computed<T>(fn: () => T): Getter<T> & { dispose(): void };
export function effect(fn: () => void): () => void;
export function watch<T>(
  source: () => T,
  callback: (next: T, prev: T | undefined, onCleanup: (cleanup: () => void) => void) => void,
  options?: { immediate?: boolean }
): () => void;
export function batch<T>(fn: () => T): T;
export function untrack<T>(fn: () => T): T;
export function onCleanup(fn: () => void): () => void;

export function onMount(fn: (element: HTMLElement) => void): void;
export function onUnmount(fn: (element: HTMLElement) => void): void;
export function onUpdate(fn: (element: HTMLElement) => void): void;

export function setStyleNonce(nonce: string): void;

export interface SfcDefinition {
  template?: string;
  styles?: string;
  name?: string;
  setup?: (props: Record<string, unknown>) => Record<string, unknown> | void;
}

export function defineSfc(definition: SfcDefinition): (props?: Record<string, unknown>) => HTMLElement;
export function defineProps(schema?: Record<string, { default?: unknown; required?: boolean } | unknown>): Record<string, Getter<unknown>>;
export function emit(name: string, payload?: unknown): void;
export function provide(key: string, value: unknown): void;
export function inject<T = unknown>(key: string, defaultValue?: T): T;

export interface Resource<T> {
  (): T | undefined;
  loading: Getter<boolean>;
  error: Getter<unknown>;
  value: Getter<T | undefined>;
  refetch(): Promise<void>;
  dispose(): void;
}
export function createResource<T>(fetcher: (source: undefined, context: { signal: AbortSignal }) => Promise<T>): Resource<T>;
export function createResource<S, T>(source: () => S, fetcher: (source: S, context: { signal: AbortSignal }) => Promise<T>): Resource<T>;
export function loadComponent(url: string, options?: { baseUrl?: string; allowOutsideDirectory?: boolean }): Promise<(props?: Record<string, unknown>) => HTMLElement>;
export function renderServerTemplate(html: string, context?: Record<string, unknown>): HTMLElement;
export function mount(component: (() => Node) | Node, target: HTMLElement | string): Node;
export function unmount(target: HTMLElement | string): void;

export interface RouteLoadContext {
  path: string;
  params: Record<string, string>;
  query: Record<string, string>;
  signal: AbortSignal;
}

export interface RouteConfig {
  path: string;
  component?: unknown;
  load?: (context: RouteLoadContext) => unknown;
  children?: RouteConfig[];
  meta?: Record<string, unknown>;
  guards?: {
    beforeEnter?: (context: RouteContext) => unknown;
    beforeLeave?: (context: RouteContext) => unknown;
  };
}

export function lazy(loader: () => Promise<unknown>): (...args: unknown[]) => unknown;

export interface RouteContext {
  path: string;
  query: Record<string, string>;
  from: unknown;
  to: unknown;
}

export function defineRoute(config: RouteConfig): RouteConfig;
export function startRouter(options?: { mode?: 'history' | 'hash' }): void;
export function startApp(rootSelector?: string): void;
export function navigate(path: string, options?: { replace?: boolean; triggeredByPopstate?: boolean }): Promise<void>;
export function shouldInterceptLink(link: Element, event: MouseEvent): boolean;
