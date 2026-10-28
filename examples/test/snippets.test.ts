import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { expect, it } from 'vitest';
import * as animate from '@drawcall/animate';
import * as three from 'three';
import * as timeline from '@pmndrs/timeline';
import { PERSON } from '../../packages/animate/skills/animate/references/person';

// Skill blocks are standalone modules; only the README's surrounding application is declared.
const here = dirname(fileURLToPath(import.meta.url)), root = resolve(here, '../..');
const DOCS = ['packages/animate/skills/animate/SKILL.md', 'README.md'];
const APP = `declare const scene: import('three').Scene, characterModel: import('three').Object3D,
  skeleton: typeof import('../src/skeletons').PERSON, delta: number;`;

function blocks(): { name: string; code: string; doc: string }[] {
  return DOCS.flatMap((doc) => [...readFileSync(resolve(root, doc), 'utf8').matchAll(/```ts\n([\s\S]*?)```/g)]
    .map((match, i) => ({ name: `${doc.split('/').pop()}#${i + 1}`, code: match[1], doc })));
}

/** each block's type errors, by block */
function compiled(): Map<string, string[]> {
  const config = ts.readConfigFile(resolve(root, 'tsconfig.base.json'), ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, resolve(root, 'examples'));
  const options = { ...parsed.options, noUnusedLocals: false, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 };
  const files = new Map(blocks().map(({ name, code, doc }, i) => [resolve(doc.endsWith('SKILL.md') ? resolve(root, dirname(doc)) : here, `__snippet${i + 1}.ts`),
    { name, text: doc.endsWith('SKILL.md') ? code : `${APP}\n${code}` }]));
  const host = ts.createCompilerHost(options);
  const { getSourceFile, fileExists, readFile } = host;
  host.fileExists = (file) => files.has(file) || fileExists(file);
  host.readFile = (file) => files.get(file)?.text ?? readFile(file);
  host.getSourceFile = (file, language, ...rest) => {
    const virtual = files.get(file);
    return virtual ? ts.createSourceFile(file, virtual.text, language) : getSourceFile(file, language, ...rest);
  };
  const program = ts.createProgram([...files.keys()], options, host);
  const errors = new Map([...files.values()].map(({ name }) => [name, [] as string[]]));
  for (const d of ts.getPreEmitDiagnostics(program)) {
    const file = d.file && files.get(d.file.fileName);
    if (!file || !d.file) continue;
    const { line } = d.file.getLineAndCharacterOfPosition(d.start ?? 0);
    errors.get(file.name)?.push(`line ${line + 1}: ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`);
  }
  return errors;
}

const errors = compiled();
for (const [name, found] of errors) it(`${name} compiles`, () => expect(found).toEqual([]), 120_000);

it('runs the skill story headlessly to its checked ending', () => {
  const main = blocks().find(({ doc }) => doc.endsWith('SKILL.md'));
  if (!main) throw new Error('The animate skill has no runnable example');
  const modules: Record<string, unknown> = {
    three, '@pmndrs/timeline': timeline, '@drawcall/animate': animate, './references/person': { PERSON },
  };
  const require = (name: string) => {
    if (!(name in modules)) throw new Error(`Snippet imports unsupported module ${name}`);
    return modules[name];
  };
  const compiled = ts.transpileModule(main.code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  new Function('require', 'exports', compiled.outputText)(require, {});
}, 30000);
