// PUBLIC_DERIVATIVE ordinary-JavaScript evidence boundary, not a Proxy sandbox.
// Inspect descriptors, never caller getters, iterators, array methods or toJSON.
// Preserve every record key (including error/annotation keys) for domain validation.
const captured = new WeakSet<object>();
export function dataSnapshot(value: any): any {
 let budget = 200000;
 const active = new WeakSet<object>();
 function copy(v: any, depth: number): any {
  if (--budget < 0 || depth > 64) throw new Error('evidence budget');
  if (v === null || v === undefined || typeof v === 'string' || typeof v === 'boolean') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v !== 'object') throw new Error('non-data evidence');
  if (captured.has(v)) return v;
  if (active.has(v)) throw new Error('cyclic evidence');
  active.add(v);
  const array = Array.isArray(v), prototype = Object.getPrototypeOf(v);
  if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null)
   throw new Error('evidence prototype');
  const descriptors = Object.getOwnPropertyDescriptors(v), keys = Reflect.ownKeys(descriptors);
  const out: any = array ? [] : Object.create(null);
  if (array) {
   const length = descriptors.length;
   if (!length || !Object.hasOwn(length,'value') || !Number.isSafeInteger(length.value) || length.value < 0 || length.value > 100000 || keys.length !== length.value + 1)
    throw new Error('evidence list');
   // Reject every decoration, including symbols and overridden array methods.
   for (const key of keys) if (key !== 'length' && (typeof key !== 'string' || !/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= length.value))
    throw new Error('evidence list decoration');
   for (let i = 0; i < length.value; i++) {
    const d = descriptors[String(i)];
    if (!d || !Object.hasOwn(d,'value')) throw new Error('evidence list index');
    out.push(copy(d.value,depth+1));
   }
  } else {
   for (const key of keys) {
    if (typeof key !== 'string') throw new Error('evidence record symbol');
    const d = descriptors[key];
    if (!Object.hasOwn(d,'value')) throw new Error('evidence record accessor');
    Object.defineProperty(out,key,{value:copy(d.value,depth+1),enumerable:true});
   }
  }
  active.delete(v);Object.freeze(out);captured.add(out);return out;
 }
 return copy(value,0);
}
export const parseData = (value: any): any => dataSnapshot(typeof value === 'string' ? JSON.parse(value) : value);
