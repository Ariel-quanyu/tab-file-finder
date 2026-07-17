import * as assert from 'assert';
import { stripSurroundingQuotes, expandHome, normalizeInputForFs } from '../pathUtils';
import * as os from 'os';
import * as path from 'path';

describe('pathUtils', () => {
  it('stripSurroundingQuotes removes matching quotes', () => {
    assert.strictEqual(stripSurroundingQuotes('"/home/user/file.txt"'), '/home/user/file.txt');
    assert.strictEqual(stripSurroundingQuotes("'/tmp/test'"), '/tmp/test');
    assert.strictEqual(stripSurroundingQuotes('`/tmp/test`'), '/tmp/test');
    assert.strictEqual(stripSurroundingQuotes('/no/quotes'), '/no/quotes');
  });

  it('expandHome expands ~ and ~/ paths', () => {
    const home = os.homedir();
    assert.strictEqual(expandHome('~'), home);
    assert.strictEqual(expandHome('~/docs'), path.join(home, 'docs'));
  });

  it('normalizeInputForFs handles file:// and separators', () => {
    const p = normalizeInputForFs('file:///tmp/test.txt');
    assert.ok(p.indexOf('tmp') >= 0 && p.indexOf('test.txt') >= 0);

    const p2 = normalizeInputForFs('  "~/my/dir"  ');
    assert.ok(p2.indexOf(path.join(os.homedir(), 'my', 'dir')) >= 0);
  });
});
