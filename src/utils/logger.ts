/**
 * Namespaced logger for the diorama runtime.
 *
 * Every subsystem logs through here so the browser console stays readable and
 * failures (missing assets, shader issues) are never swallowed silently —
 * a hard requirement for the manifest-driven loader.
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  readonly debug: (...args: unknown[]) => void;
  readonly info: (...args: unknown[]) => void;
  readonly warn: (...args: unknown[]) => void;
  readonly error: (...args: unknown[]) => void;
  readonly child: (subNamespace: string) => Logger;
}

const ROOT_NAMESPACE = 'diorama';

/**
 * Creates a logger under the root `[diorama]` namespace.
 * `debug` is silenced in production builds to keep the console clean.
 */
export function createLogger(namespace = ROOT_NAMESPACE): Logger {
  const prefix = `[${namespace}]`;

  const emit = (level: LogLevel, args: unknown[]): void => {
    if (level === 'debug' && !isDevEnvironment()) return;

    const sink = level === 'error' ? console.error : level === 'warn' ? console.warn : console.info;
    sink(prefix, ...args);
  };

  return {
    debug: (...args) => emit('debug', args),
    info: (...args) => emit('info', args),
    warn: (...args) => emit('warn', args),
    error: (...args) => emit('error', args),
    child: (subNamespace: string) => createLogger(`${namespace}:${subNamespace}`),
  };
}

function isDevEnvironment(): boolean {
  try {
    return Boolean(import.meta.env?.DEV);
  } catch {
    return false;
  }
}