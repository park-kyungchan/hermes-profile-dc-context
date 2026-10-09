import {resolveContext} from '../src/intent/resolve.ts';
import {contextFixture} from '../tests/context-fixture.ts';
const f=contextFixture();const result=resolveContext(f.candidate,f.request,f.rows);
if(result.status!=='RESOLVED'||result.authority!=='NO_EXECUTION_AUTHORITY')throw Error('Unexpected consumer result');
console.log(JSON.stringify({synthetic:true,status:result.status,authority:result.authority,decisions:result.decisions.length}));
