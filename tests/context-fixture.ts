import {createHash} from 'node:crypto';
export function contextFixture() {
 const content='Synthetic caller: use a typed contract for this example.';
 const digest=createHash('sha256').update(content).digest('hex');
 const row={id:1,session_id:'synthetic-context-session',role:'user',tool_name:null,tool_call_id:null,content,timestamp:1};
 const source={id:'synthetic-source',kind:'user-message',sessionId:row.session_id,messageId:row.id,contentSha256:digest};
 const decision={id:'synthetic-direction',revision:1,topic:'example-topic',scope:{kind:'workstream',profile:'synthetic-profile',projectId:'synthetic-project',workstreamId:'synthetic-work'},kind:'confirmed-direction',statement:'Use the synthetic typed contract.',sourceIds:[source.id],supersedes:[] as number[]};
 return {candidate:{schema:'backend.intent-context.candidate.v1',stage:'candidate',meaningStatus:'curated-user-source-interpretations',sources:[source],decisions:[decision]},request:{schema:'backend.intent-context.request.v1',purpose:'Demonstrate source-bound selection only',profile:'synthetic-profile',projectId:'synthetic-project',workstreamId:'synthetic-work',topics:['example-topic']},rows:[row]};
}
