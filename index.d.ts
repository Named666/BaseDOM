export type Getter<T> = () => T;
export type Setter<T> = (next: T | ((previous: T) => T)) => void;
export type Signal<T> = [Getter<T>, Setter<T>];

export function signal<T>(value: T): Signal<T>;
export function signal<T>(key: string, value: T): Signal<T>;

export function computed<T>(fn: () => T): Getter<T> & { dispose(): void };
export function effect(fn: () => void): () => void;
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
export function loadComponent(url: string, options?: { baseUrl?: string; allowOutsideDirectory?: boolean }): Promise<(props?: Record<string, unknown>) => HTMLElement>;
export function renderServerTemplate(html: string, context?: Record<string, unknown>): HTMLElement;
export function mount(component: (() => Node) | Node, target: HTMLElement | string): Node;
export function unmount(target: HTMLElement | string): void;

export interface RouteConfig {
  path: string;
  component?: unknown;
  children?: RouteConfig[];
  meta?: Record<string, unknown>;
  guards?: {
    beforeEnter?: (context: RouteContext) => unknown;
    beforeLeave?: (context: RouteContext) => unknown;
  };
}

export interface RouteContext {
  path: string;
  query: Record<string, string>;
  from: unknown;
  to: unknown;
}

export function defineRoute(config: RouteConfig): RouteConfig;
export function startRouter(options?: { mode?: 'history' | 'hash' }): void;
export function navigate(path: string, options?: { replace?: boolean; triggeredByPopstate?: boolean }): Promise<void>;
export function shouldInterceptLink(link: Element, event: MouseEvent): boolean;

export function createForm(initialValues?: Record<string, unknown>): {
  fields: Record<string, ((next?: unknown) => unknown) & { set: (next: unknown) => void }>;
  errors: Getter<Record<string, string>>;
  isValid: Getter<boolean>;
  isSubmitting: Getter<boolean>;
  submitError: Getter<string | null>;
  setValidator(name: string, validator: ((value: unknown) => string | null) | Array<(value: unknown) => string | null>): void;
  handleSubmit(onSubmit: (values: Record<string, unknown>) => unknown): (event: { preventDefault(): void }) => Promise<void>;
  reset(): void;
  dispose(): void;
};
