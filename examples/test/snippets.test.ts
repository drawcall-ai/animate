import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { expect } from 'vitest';
import * as animate from '@drawcall/animate';
import * as species from '@drawcall/animate/species';
import { cases } from '../../packages/animate/test/open';

// Every TypeScript block in the skill and the README compiles against the package as published: each is checked as a module of its
// own, the package's exports it does not import in scope, and the scene's own things (a renderer, a clock, a model…) declared.
const here = dirname(fileURLToPath(import.meta.url)), root = resolve(here, '../..');
const DOCS = ['packages/animate/skills/animate/SKILL.md', 'README.md'];
/** what a snippet takes from the app around it */
const APP: Record<string, string> = {
  scene: 'import("three").Scene', renderer: 'import("three").WebGLRenderer', clock: 'import("three").Clock', delta: 'number',
  characterModel: 'import("three").Object3D', skeleton: 'typeof import("../src/skeletons").PERSON', BIRD: 'readonly import("@drawcall/rig").SkeletonBone<"body" | "neck" | "beak" | `${"left" | "right"}${"Hip" | "Knee" | "Ankle" | "Toe"}`>[]',
};

function blocks(): { name: string; code: string }[] {
  return DOCS.flatMap((doc) => [...readFileSync(resolve(root, doc), 'utf8').matchAll(/```ts\n([\s\S]*?)```/g)]
    .map((match, i) => ({ name: `${doc.split('/').pop()}#${i + 1}`, code: match[1] })));
}

function source(code: string): string {
  const imported = new Set([...code.matchAll(/^import [^;]*\{([^}]*)\}/gm)].flatMap((match) => match[1].split(',').map((name) => name.trim().replace(/^type /, ''))));
  const own = new Set([...code.matchAll(/(?:const|let|function)\s+(\w+)/g)].map((match) => match[1]));
  const free = (names: string[]) => names.filter((name) => !imported.has(name) && !own.has(name));
  const declared = Object.entries(APP).filter(([name]) => !own.has(name) && !imported.has(name)).map(([name, type]) => `${name}: ${type}`);
  return [
    `import { ${free(Object.keys(animate)).join(', ')} } from '@drawcall/animate';`,
    `import { ${free(Object.keys(species).filter((name) => !(name in animate))).join(', ')} } from '@drawcall/animate/species';`,
    declared.length ? `declare const ${declared.join(', ')};` : '',
    code,
    'export {};',
  ].join('\n');
}

// Open (expected to fail: fixed, it comes off the list): the skill's first block writes its skeleton as `[/* … */] as const`, an empty
// tuple, which `humanoid` rejects as missing every bone ("Argument of type 'readonly []' is not assignable … missingBones").
const test = cases(['SKILL.md#1 compiles']);

/** each block's type errors, by block */
function compiled(): Map<string, string[]> {
  const config = ts.readConfigFile(resolve(root, 'tsconfig.base.json'), ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, resolve(root, 'examples'));
  // (every snippet is given all the exports, most of which it does not use)
  const options = { ...parsed.options, noUnusedLocals: false, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 };
  const files = new Map(blocks().map(({ name, code }, i) => [resolve(here, `__snippet${i + 1}.ts`), { name, text: source(code) }]));
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
    errors.get(file.name)?.push(`line ${line - 2}: ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`);
  }
  return errors;
}

const errors = compiled();
for (const [name, found] of errors) test(`${name} compiles`, () => expect(found).toEqual([]), 120_000);
