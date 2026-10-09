import {test,expect} from 'bun:test';
import {createHash} from 'node:crypto';
const hashText=(text:string)=>createHash('sha256').update(text).digest('hex');
import {resolveContext} from '../src/intent/resolve.ts';
import {contextFixture} from './context-fixture.ts';
test('positive: scoped source-bound direction is attributed but not authorized',()=>{
 const f=contextFixture();const result=resolveContext(f.candidate,f.request,f.rows);
 expect(result.status).toBe('RESOLVED');expect(result.decisions[0]?.sourceIds).toEqual(['synthetic-source']);
 expect(result.authority).toBe('NO_EXECUTION_AUTHORITY');expect(result.requestedSelectionComplete).toBe(true);
});
test('positive: explicit correction uses new evidence and retires only the exact predecessor',()=>{
 const f=contextFixture();const content='Synthetic correction: retain the typed boundary.';
 const row={...f.rows[0]!,id:2,content};f.rows.push(row);
 const source={...f.candidate.sources[0]!,id:'new-synthetic-source',messageId:2,contentSha256:hashText(content)};f.candidate.sources.push(source);
 f.candidate.decisions.push({...f.candidate.decisions[0]!,revision:2,sourceIds:[source.id],supersedes:[1]});
 const result=resolveContext(f.candidate,f.request,f.rows);expect(result.status).toBe('RESOLVED');expect(result.decisions.map(d=>d.revision)).toEqual([2]);
});
