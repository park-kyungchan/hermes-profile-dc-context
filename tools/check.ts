import {resolve} from 'node:path';
const compiler=process.env.TSC_PATH ?? resolve('node_modules/typescript/bin/tsc');
const types=process.env.TS_TYPE_ROOTS ?? resolve('node_modules/@types');
const result=Bun.spawnSync([process.execPath,'--no-env-file',compiler,'-p','tsconfig.json','--typeRoots',types],{stdout:'inherit',stderr:'inherit'});
process.exit(result.exitCode);
