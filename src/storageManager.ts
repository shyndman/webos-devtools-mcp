import type {PageSession} from './pageSession.js';

export interface CookieSummary {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: string;
  session?: boolean;
}

export interface SetCookieOptions {
  url: string;
  name: string;
  value: string;
  domain?: string;
  path?: string;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
  expires?: number;
}

export interface DeleteCookieOptions {
  name: string;
  url?: string;
  domain?: string;
  path?: string;
}

export interface LocalStorageEntry {
  key: string;
  value: string | null;
}

export class StorageManager {
  #session: PageSession;

  constructor(session: PageSession) {
    this.#session = session;
  }

  async listCookies(url?: string): Promise<CookieSummary[]> {
    const response = url
      ? await this.#session.sendCommand<{
          cookies: Array<CookieSummary & {size?: number}>;
        }>('Network.getCookies', {
          urls: [url],
        })
      : await this.#session.sendCommand<{
          cookies: Array<CookieSummary & {size?: number}>;
        }>('Network.getAllCookies');
    return (response.cookies ?? []).map(cookie => ({
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path,
      expires: cookie.expires,
      httpOnly: cookie.httpOnly,
      secure: cookie.secure,
      sameSite: cookie.sameSite,
      session: cookie.session,
    }));
  }

  async setCookie(options: SetCookieOptions): Promise<void> {
    const response = await this.#session.sendCommand<{
      success: boolean;
    }>('Network.setCookie', {
      url: options.url,
      name: options.name,
      value: options.value,
      domain: options.domain,
      path: options.path,
      secure: options.secure,
      httpOnly: options.httpOnly,
      sameSite: options.sameSite,
      expires: options.expires,
    });
    if (!response.success) {
      throw new Error('Failed to set cookie. Verify domain/path parameters.');
    }
  }

  async clearCookies(): Promise<void> {
    await this.#session.sendCommand('Network.clearBrowserCookies');
  }

  async deleteCookie(options: DeleteCookieOptions): Promise<void> {
    await this.#session.sendCommand('Network.deleteCookies', {
      name: options.name,
      url: options.url,
      domain: options.domain,
      path: options.path,
    });
  }

  async listLocalStorage(): Promise<LocalStorageEntry[]> {
    const response = await this.#evaluateLocalStorage(
      `(() => {
        const entries = [];
        try {
          for (let i = 0; i < localStorage.length; ++i) {
            const key = localStorage.key(i);
            entries.push({key, value: localStorage.getItem(key)});
          }
        } catch (error) {
          const message = error && error.message ? error.message : String(error);
          return {status: 'error', message};
        }
        return {status: 'ok', entries};
      })()`,
    );
    if (response.status === 'error') {
      throw new Error(response.message ?? 'Failed to access localStorage.');
    }
    return response.entries ?? [];
  }

  async setLocalStorageItem(key: string, value: string): Promise<void> {
    const response = await this.#evaluateLocalStorage(
      `(() => {
        try {
          localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(value)});
          return {status: 'ok'};
        } catch (error) {
          const message = error && error.message ? error.message : String(error);
          return {status: 'error', message};
        }
      })()`,
    );
    if (response.status === 'error') {
      throw new Error(response.message ?? 'Failed to set localStorage item.');
    }
  }

  async removeLocalStorageItem(key: string): Promise<void> {
    const response = await this.#evaluateLocalStorage(
      `(() => {
        try {
          localStorage.removeItem(${JSON.stringify(key)});
          return {status: 'ok'};
        } catch (error) {
          const message = error && error.message ? error.message : String(error);
          return {status: 'error', message};
        }
      })()`,
    );
    if (response.status === 'error') {
      throw new Error(response.message ?? 'Failed to remove localStorage item.');
    }
  }

  async #evaluateLocalStorage(expression: string): Promise<any> {
    const response = await this.#session.sendCommand<{
      result: {
        type?: string;
        value?: unknown;
      };
      exceptionDetails?: {text?: string; exception?: {description?: string}};
    }>('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (response.exceptionDetails) {
      const message =
        response.exceptionDetails.text ||
        (response.exceptionDetails.exception
          ? response.exceptionDetails.exception.description
          : undefined) ||
        'Runtime evaluation failed.';
      throw new Error(message);
    }
    return response.result?.value;
  }
}
