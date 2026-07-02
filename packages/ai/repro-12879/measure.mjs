import { spawnSync } from 'node:child_process';
const cases = ['repro-no-output.ts','repro-json.ts','repro.ts'];
for (const file of cases) {
  const tsconfig = { compilerOptions: { target:'ES2022', module:'NodeNext', moduleResolution:'NodeNext', strict:false, skipLibCheck:false, noEmit:true }, files:[file] };
  await import('node:fs').then(fs=>fs.writeFileSync('tsconfig.measure.json', JSON.stringify(tsconfig,null,2)));
  const start=performance.now();
  const r=spawnSync('../../../node_modules/.bin/tsc',['-p','tsconfig.measure.json','--extendedDiagnostics'],{encoding:'utf8'});
  const elapsed=performance.now()-start;
  const out=r.stdout+r.stderr;
  const check=out.match(/Check time:\s+([0-9.]+)s/)?.[1];
  const inst=out.match(/Instantiations:\s+(\d+)/)?.[1];
  console.log(file, 'exit', r.status, 'wallMs', Math.round(elapsed), 'check', check, 'inst', inst);
  if (r.status!==0) console.log(out);
}
