import path from 'node:path';
import ts from 'typescript';

async function main() {
  const fixturePath = path.resolve(
    'src/reproduction/issue-15593-readonly-json-tool-result.fixture.ts',
  );
  const fixtureSource = `
import { openai } from '@ai-sdk/openai';
import { generateText } from 'ai';

const execute = () => [] as const;

generateText({
  model: openai('gpt-3.5-turbo'),
  messages: [
    {
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: '',
          toolName: '',
          output: {
            type: 'json',
            value: execute(),
          },
        },
      ],
    },
  ],
});
`;

  const compilerOptions: ts.CompilerOptions = {
    esModuleInterop: true,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noEmit: true,
    skipLibCheck: true,
    strict: true,
    target: ts.ScriptTarget.ES2022,
  };
  const defaultHost = ts.createCompilerHost(compilerOptions);
  const host: ts.CompilerHost = {
    ...defaultHost,
    fileExists: fileName =>
      fileName === fixturePath || defaultHost.fileExists(fileName),
    getSourceFile: (fileName, languageVersion, onError, shouldCreateNewFile) =>
      fileName === fixturePath
        ? ts.createSourceFile(
            fileName,
            fixtureSource,
            languageVersion,
            true,
            ts.ScriptKind.TS,
          )
        : defaultHost.getSourceFile(
            fileName,
            languageVersion,
            onError,
            shouldCreateNewFile,
          ),
    readFile: fileName =>
      fileName === fixturePath ? fixtureSource : defaultHost.readFile(fileName),
  };

  const program = ts.createProgram([fixturePath], compilerOptions, host);
  const diagnostics = ts
    .getPreEmitDiagnostics(program)
    .filter(
      diagnostic =>
        diagnostic.category === ts.DiagnosticCategory.Error &&
        diagnostic.file?.fileName === fixturePath,
    );
  const readonlyJsonDiagnostic = diagnostics.find(diagnostic => {
    const message = ts.flattenDiagnosticMessageText(
      diagnostic.messageText,
      '\n',
    );

    return (
      message.includes("Type 'readonly []' is not assignable to type") &&
      message.includes("cannot be assigned to the mutable type 'JSONArray'")
    );
  });

  if (readonlyJsonDiagnostic == null) {
    console.log(
      'Could not reproduce: the readonly tool-result value type-checks successfully.',
    );
    return;
  }

  const position = readonlyJsonDiagnostic.file?.getLineAndCharacterOfPosition(
    readonlyJsonDiagnostic.start ?? 0,
  );
  const message = ts.flattenDiagnosticMessageText(
    readonlyJsonDiagnostic.messageText,
    '\n',
  );

  console.error(
    `${fixturePath}:${(position?.line ?? 0) + 1}:${(position?.character ?? 0) + 1} - error TS${readonlyJsonDiagnostic.code}: ${message}`,
  );
  throw new Error(
    'Reproduced issue #15593: a readonly JSON array is rejected as a tool-result JSON value.',
  );
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
