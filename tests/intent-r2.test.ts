import {test, expect} from 'bun:test';
import {resolveContext} from '../src/intent/resolve.ts';
import {parseCandidate, parseRequest, parseNativeRows} from '../src/intent/contract.ts';
import {parseLosslessJson} from '../src/intent/json-ingress.ts';
import {contextFixture} from './context-fixture.ts';

for (const field of ['sources','decisions','sourceIds','supersedes','topics','nativeRows']) {
 for (const mode of ['sparse','inherited','invalid-second']) {
  test(`object ingress: ${mode} ${field} never completes`, () => {
   const f=contextFixture();
   const good:any=field==='topics'?f.request.topics:field==='nativeRows'?f.rows:
    field==='sources'?f.candidate.sources:field==='decisions'?f.candidate.decisions:
    field==='sourceIds'?f.candidate.decisions[0]!.sourceIds:[1];
   const malformed:any[]=mode==='invalid-second'?[good[0],null]:new Array(1);
   if(mode==='inherited')Object.setPrototypeOf(malformed,Object.assign(Object.create(Array.prototype),{0:good[0]}));
   if(field==='topics')f.request.topics=malformed;
   else if(field==='nativeRows')f.rows=malformed;
   else if(field==='sources')f.candidate.sources=malformed;
   else if(field==='decisions')f.candidate.decisions=malformed;
   else if(field==='sourceIds')f.candidate.decisions[0]!.sourceIds=malformed;
   else f.candidate.decisions[0]!.supersedes=malformed;
   const r=resolveContext(f.candidate,f.request,field==='sourceIds'?[]:f.rows);
   expect(r.status).toBe(field==='nativeRows'?'NEEDS_EVIDENCE':'REJECTED');
   expect(r.requestedSelectionComplete).toBe(false);expect(r.decisions).toEqual([]);expect(r.sources).toEqual([]);
   expect(()=>field==='topics'?parseRequest(f.request):field==='nativeRows'?parseNativeRows(f.rows):parseCandidate(f.candidate)).toThrow();
  });
 }
}
test('JSON ingress is dense: serialization changes a hole to null, not a native acquisition exploit',()=>{
 const f=contextFixture();f.candidate.decisions[0]!.sourceIds=new Array(1);
 const text=JSON.stringify(f.candidate);expect(text).toContain('"sourceIds":[null]');
 const decoded:any=parseLosslessJson(text);expect(Object.hasOwn(decoded.decisions[0].sourceIds,0)).toBe(true);
 const r=resolveContext(decoded,f.request,[]);expect(r.status).toBe('REJECTED');expect(r.requestedSelectionComplete).toBe(false);
 expect(resolveContext(parseLosslessJson(JSON.stringify(contextFixture().candidate)),f.request,f.rows).status).toBe('RESOLVED');
});
