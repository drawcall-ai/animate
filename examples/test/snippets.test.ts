import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { expect, it } from 'vitest';
import * as animate from '@drawcall/animate';
import * as rig from '@drawcall/animate/rig';

// Every TypeScript block in the skill and the README compiles against the package as published: each is checked as the body of an
// async generator, with the package's exports in scope and the scene's own things (a story, a saddle, the frame's delta…) declared.
const here = dirname(fileURLToPath(import.meta.url)), root = resolve(here, '../..');
const DOCS = ['packages/animate/skills/animate/SKILL.md', 'README.md'];
const TYPES = ['Behaviour', 'Frame', 'Side', 'Species', 'BoneDef', 'DrivenRoot', 'Placement', 'Grips'];
/** what a snippet takes from the scene around it */
const SCENE: Record<string, string> = {
  story: '(h: Humanoid) => Behaviour', saddle: 'Item', rope: 'Item', ball: 'Item', item: 'Item', mare: 'Body', groom: 'Humanoid',
  h: 'Humanoid', HEAD: 'number', stall: 'Vector3', goal: 'Vector3', position: 'Vector3', aim: 'Vector3', UP: 'Vector3', bones: 'BoneDef[]',
  delta: 'number', scene: '{ add(...o: unknown[]): unknown }', model: 'NonNullable<ConstructorParameters<typeof Humanoid>[0]>',
  input: '{ x: number; z: number; yaw: number; crouch: boolean; jump: boolean }',
};

function blocks(): { name: string; code: string }[] {
  return DOCS.flatMap((doc) => [...readFileSync(resolve(root, doc), 'utf8').matchAll(/```ts\n([\s\S]*?)```/g)]
    .map((m, i) => ({ name: `${doc.split('/').pop()}#${i + 1}`, code: m[1] })));
}

function source(code: string): string {
  const body = code.replace(/^import .*\n/gm, '');
  const own = new Set([...body.matchAll(/(?:const|let|function)\s+(\w+)/g)].map((m) => m[1]));
  const declared = Object.entries(SCENE).filter(([name]) => !own.has(name)).map(([name, type]) => `${name}: ${type}`);
  return [
    "import { Box3, Quaternion, Vector3 } from 'three';",
    "import { parallel, timePassed } from '@pmndrs/timeline';",
    "import { loadCharacterModel } from '@pmndrs/viverse';",
    `import { ${Object.keys(animate).join(', ')}, ${TYPES.map((t) => `type ${t}`).join(', ')} } from '@drawcall/animate';`,
    `import { ${Object.keys(rig).filter((name) => !(name in animate)).join(', ')} } from '@drawcall/animate/rig';`,
    declared.length ? `declare const ${declared.join(', ')};` : '',
    'export async function* snippet(): AsyncGenerator<any, void, any> {',
    body,
    '}',
  ].join('\n');
}

it('every code block in the skill and the README compiles', () => {
  const config = ts.readConfigFile(resolve(root, 'tsconfig.base.json'), ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, resolve(root, 'examples'));
  // (every snippet is given all the exports, most of which it does not use)
  const options = { ...parsed.options, noUnusedLocals: false };
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
  const errors = ts.getPreEmitDiagnostics(program).filter((d) => d.file && files.has(d.file.fileName)).map((d) => {
    const { line } = d.file!.getLineAndCharacterOfPosition(d.start ?? 0);
    return `${files.get(d.file!.fileName)!.name} line ${line - 6}: ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`;
  });
  expect(files.size).toBeGreaterThan(5);
  expect(errors).toEqual([]);
}, 120_000);
