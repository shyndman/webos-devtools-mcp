import {PageSession} from './pageSession.js';

export interface ClickOptions {
  selector: string;
  index?: number;
}

export interface TypeOptions {
  selector: string;
  text: string;
  index?: number;
  replace?: boolean;
  submit?: boolean;
}

export class DomActions {
  #session: PageSession;

  constructor(session: PageSession) {
    this.#session = session;
  }

  async click({selector, index = 0}: ClickOptions): Promise<void> {
    const payload = {selector, index};
    const script = `(function(){
      try {
        var data = ${JSON.stringify(payload)};
        var idx = typeof data.index === 'number' ? data.index : 0;
        var nodes = document.querySelectorAll(data.selector);
        var el = nodes.length > idx ? nodes[idx] : null;
        if (!el) {
          return {status:'not_found'};
        }
        try {
          if (typeof el.scrollIntoView === 'function') {
            el.scrollIntoView({block: 'center', inline: 'center'});
          }
        } catch (e) {}
        if (typeof el.click === 'function') {
          el.click();
        } else {
          var event;
          try {
            event = new MouseEvent('click', {bubbles: true, cancelable: true});
          } catch (e) {
            event = document.createEvent('MouseEvents');
            event.initEvent('click', true, true);
          }
          el.dispatchEvent(event);
        }
        return {status:'ok'};
      } catch (error) {
        var message = (error && error.message) ? error.message : String(error);
        return {status:'error', message: message};
      }
    })()`;
    const result = await this.#session.evaluate(script);
    const parsed = parseActionResult(result.value);
    if (parsed.status === 'not_found') {
      throw new Error(`Element not found for selector ${selector} at index ${index}.`);
    }
    if (parsed.status === 'error') {
      throw new Error(parsed.message ?? 'Unknown error during click action.');
    }
  }

  async type({
    selector,
    text,
    index = 0,
    replace = true,
    submit = false,
  }: TypeOptions): Promise<void> {
    const payload = {selector, text, index, replace, submit};
    const script = `(function(){
      function createEvent(type) {
        try {
          return new Event(type, {bubbles: true});
        } catch (e) {
          var evt = document.createEvent('Event');
          evt.initEvent(type, true, true);
          return evt;
        }
      }
      try {
        var data = ${JSON.stringify(payload)};
        var idx = typeof data.index === 'number' ? data.index : 0;
        var nodes = document.querySelectorAll(data.selector);
        var el = nodes.length > idx ? nodes[idx] : null;
        if (!el) {
          return {status:'not_found'};
        }
        var value = data.text;
        var replaceValue = data.replace !== false;
        var submitForm = !!data.submit;
        if ('value' in el) {
          try {
            if (typeof el.focus === 'function') {
              el.focus();
            }
          } catch (e) {}
          if (replaceValue) {
            el.value = value;
          } else {
            el.value = (typeof el.value === 'string' ? el.value : '') + value;
          }
          el.dispatchEvent(createEvent('input'));
          el.dispatchEvent(createEvent('change'));
          if (submitForm && el.form) {
            try {
              if (typeof el.form.requestSubmit === 'function') {
                el.form.requestSubmit();
              } else if (typeof el.form.submit === 'function') {
                el.form.submit();
              }
            } catch (e) {}
          }
          return {status:'ok'};
        }
        if (replaceValue) {
          el.textContent = value;
        } else {
          var current = typeof el.textContent === 'string' ? el.textContent : '';
          el.textContent = current + value;
        }
        el.dispatchEvent(createEvent('input'));
        return {status:'ok'};
      } catch (error) {
        var message = (error && error.message) ? error.message : String(error);
        return {status:'error', message: message};
      }
    })()`;

    const result = await this.#session.evaluate(script);
    const parsed = parseActionResult(result.value);
    if (parsed.status === 'not_found') {
      throw new Error(`Element not found or not editable for selector ${selector} at index ${index}.`);
    }
    if (parsed.status === 'error') {
      throw new Error(parsed.message ?? 'Unknown error while typing.');
    }
  }
}

type ActionResultStatus = 'ok' | 'not_found' | 'error';

interface ActionResult {
  status: ActionResultStatus;
  message?: string;
}

function parseActionResult(raw: unknown): ActionResult {
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as Partial<ActionResult>;
      if (parsed && typeof parsed.status === 'string') {
        return {
          status: parsed.status as ActionResultStatus,
          message: typeof parsed.message === 'string' ? parsed.message : undefined,
        };
      }
    } catch {
      if (raw === 'OK') {
        return {status: 'ok'};
      }
      if (raw === 'NOT_FOUND') {
        return {status: 'not_found'};
      }
      if (raw.indexOf('ERROR:') === 0) {
        return {status: 'error', message: raw.slice('ERROR:'.length)};
      }
    }
  }
  return {status: 'error', message: 'Unexpected evaluation result.'};
}
