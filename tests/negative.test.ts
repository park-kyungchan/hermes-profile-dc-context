import {test,expect} from 'bun:test';
import {createHash} from 'node:crypto';
const hashText=(text:string)=>createHash('sha256').update(text).digest('hex');
import {resolveContext} from '../src/intent/resolve.ts';
import {parseLosslessJson} from '../src/intent/json-ingress.ts';
import {contextFixture} from './context-fixture.ts';
test('negative: missing or changed bytes do not resolve',()=>{
 for(const mode of ['missing','changed']){const f=contextFixture();if(mode==='missing')f.rows=[];else f.rows[0]!.content+=' altered';
 const r=resolveContext(f.candidate,f.request,f.rows);expect(r.status).toBe('NEEDS_EVIDENCE');expect(r.decisions).toEqual([]);}
});
test('negative: another owner scope, proposals and historical grants are not current direction',()=>{
 for(const mode of ['scope','proposal','historical-authorization']){const f=contextFixture();if(mode==='scope')f.request.profile='foreign-profile';else f.candidate.decisions[0]!.kind=mode;
 const r=resolveContext(f.candidate,f.request,f.rows);expect(r.status).toBe('SCOPE_UNRESOLVED');expect(r.authority).toBe('NO_EXECUTION_AUTHORITY');}
});
test('negative: unresolved revision conflict is not silently won by newest date',()=>{
 const f=contextFixture();f.candidate.decisions.push({...f.candidate.decisions[0]!,revision:2,statement:'Synthetic competing interpretation.'});
 const r=resolveContext(f.candidate,f.request,f.rows);expect(r.status).toBe('NEEDS_DECISION');expect(r.conflicts).toHaveLength(1);expect(r.decisions).toEqual([]);
});
test('negative: replayed source cannot support supersession',()=>{
 const f=contextFixture();f.candidate.decisions.push({...f.candidate.decisions[0]!,revision:2,supersedes:[1]});
 const r=resolveContext(f.candidate,f.request,f.rows);expect(r.status).toBe('REJECTED');expect(r.gaps[0]?.code).toBe('SUPERSESSION_NEEDS_NEW_SOURCE');
});
test('negative: duplicate JSON keys and rounded numeric spellings refuse',()=>{
 for(const text of ['{"x":1,"x":2}','{"x":9007199254740993}','{"x":1e0}'])expect(()=>parseLosslessJson(text)).toThrow();
});
