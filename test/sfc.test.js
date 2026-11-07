import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { parseComponent } from '../parser.js';
import { renderServerTemplate, resolveSfcScriptSrc, INLINE_SCRIPT_ERROR } from '../sfc.js';
import { signal } from '../state.js';

describe('SFC loading trust boundary', () => {
  it('refuses to execute inline script from SFC text', async () => {
    const parser = readFileSync(new URL('../parser.js', import.meta.url), 'utf8');
    const loader = readFileSync(new URL('../sfc.js', import.meta.url), 'utf8');
    assert.doesNotMatch(parser, /data:text\/javascript/);
    assert.doesNotMatch(loader, /new Function/);
    assert.doesNotMatch(loader, /data:text\/javascript/);
    await assert.rejects(
      () => parseComponent('<template><p>{{ name }}</p></template><script setup>const name = "nope"</script>'),
      (error) => error.message === INLINE_SCRIPT_ERROR
    );
  });

  it('resolves same-directory script modules and blocks remote script URLs', () => {
    const base = 'http://127.0.0.1:4173/components/Counter.html';
    assert.equal(resolveSfcScriptSrc('./counter.setup.js', base), 'http://127.0.0.1:4173/components/counter.setup.js');
    assert.throws(() => resolveSfcScriptSrc('data:text/javascript,alert(1)', base));
    assert.throws(() => resolveSfcScriptSrc('blob:http://127.0.0.1/id', base));
    assert.throws(() => resolveSfcScriptSrc('//evil.example/a.js', base));
    assert.throws(() => resolveSfcScriptSrc('https://evil.example/a.js', base));
    assert.throws(() => resolveSfcScriptSrc('../secret.js', base));
  });

  it('renders server HTML with the supplied context and does not keep script or handlers', () => {
    const [name, setName] = signal('A&B<C>');
    const el = renderServerTemplate(`
      <script>alert(1)</script>
      <button type="button" onclick="alert(2)" @click="increment">{{ name }}</button>
      <a href="javascript:alert(3)">bad</a>
    `, {
      name,
      increment: () => setName('ok')
    });
    assert.equal(el.querySelector('script'), null);
    assert.equal(el.querySelector('button').textContent, 'A&B<C>');
    assert.equal(el.querySelector('button').hasAttribute('onclick'), false);
    assert.equal(el.querySelector('a').hasAttribute('href'), false);
    el.querySelector('button').click();
    assert.equal(name(), 'ok');
    assert.equal(el.querySelector('button').textContent, 'ok');
  });
});
