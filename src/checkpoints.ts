import { type Project, validateProject, uid } from './model';
import { media } from './audio';

export type CheckpointSummary = { id:string; projectId:string; name:string; time:number; reason:string; clipCount:number; bytes:number };
type StoredCheckpoint = CheckpointSummary & { project:Project; media:{id:string;hash:string}[]; fingerprint:string };
type StoredMedia = {hash:string;blob:Blob;bytes:number};
const maximumBytes=192*1024*1024, perProject=12, maximumCount=32;
let queue=Promise.resolve();
function enqueue<T>(action:()=>Promise<T>):Promise<T>{const result=queue.then(action);queue=result.then(()=>{},()=>{});return result;}
function digest(buffer:ArrayBuffer){return crypto.subtle.digest('SHA-256',buffer).then(result=>Array.from(new Uint8Array(result),v=>v.toString(16).padStart(2,'0')).join(''));}
function capture(bytes:Uint8Array){const blob=new Blob([bytes.slice().buffer as ArrayBuffer]);return{blob,hash:blob.arrayBuffer().then(digest)};}
function openDatabase():Promise<IDBDatabase>{return new Promise((resolve,reject)=>{const request=indexedDB.open('KurAudioCheckpoints',1);let abandoned=false;request.onupgradeneeded=()=>{const db=request.result;if(!db.objectStoreNames.contains('checkpoints'))db.createObjectStore('checkpoints',{keyPath:'id'});if(!db.objectStoreNames.contains('media'))db.createObjectStore('media',{keyPath:'hash'});};request.onerror=()=>reject(request.error);request.onblocked=()=>{abandoned=true;reject(Error('Penyimpanan cadangan sedang digunakan. Tutup jendela lama lalu coba lagi.'));};request.onsuccess=()=>{if(abandoned){request.result.close();return;}request.result.onversionchange=()=>request.result.close();resolve(request.result);};});}
const text=(value:unknown):value is string=>typeof value==='string'&&value.length>0&&value.length<=512;
const hashString=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
function validSummary(row:unknown):row is StoredCheckpoint {
 if(!row||typeof row!=='object')return false;const r=row as StoredCheckpoint;
 if(!text(r.id)||!text(r.projectId)||!text(r.name)||typeof r.reason!=='string'||r.reason.length>100||!Number.isFinite(r.time)||r.time<0||r.time>=Date.now()+86400000||!hashString(r.fingerprint)||r.project?.id!==r.projectId||r.project?.name!==r.name||!Array.isArray(r.project.clips)||r.clipCount!==r.project.clips.length||!Array.isArray(r.project.assets)||!Number.isInteger(r.bytes)||r.bytes<0||r.bytes>maximumBytes||!Array.isArray(r.media)||r.media.length!==r.project.assets.length)return false;
 const ids=new Set<string>();for(const entry of r.media){if(!entry||!text(entry.id)||ids.has(entry.id)||!hashString(entry.hash))return false;ids.add(entry.id);}
 return r.project.assets.every(asset=>asset&&ids.has(asset.id));
}
function fingerprintPayload(project:Project,references:{id:string;hash:string}[]){return JSON.stringify({project,media:references.map(({id,hash})=>({id,hash}))});}
function summary(r:StoredCheckpoint):CheckpointSummary{return{id:r.id,projectId:r.projectId,name:r.name,time:r.time,reason:r.reason,clipCount:r.clipCount,bytes:r.bytes};}
async function transact<T>(mode:IDBTransactionMode, action:(checkpoints:IDBObjectStore,audio:IDBObjectStore,rows:unknown[],blobs:StoredMedia[])=>T):Promise<T>{
 const db=await openDatabase();return new Promise<T>((resolve,reject)=>{let value:T;let transaction:IDBTransaction;
 try{transaction=db.transaction(['checkpoints','media'],mode);}catch(e){db.close();reject(e);return;}
 transaction.oncomplete=()=>{db.close();resolve(value);};transaction.onerror=transaction.onabort=()=>{db.close();reject(transaction.error??Error('Cadangan tidak dapat ditulis.'));};
 const checkpoints=transaction.objectStore('checkpoints'),audio=transaction.objectStore('media'),a=checkpoints.getAll(),b=audio.getAll();let ready=0;
 const finish=()=>{if(++ready!==2)return;try{value=action(checkpoints,audio,a.result,b.result);}catch(e){transaction.abort();reject(e);}};a.onsuccess=finish;b.onsuccess=finish;
 });
}
function retained(rows:StoredCheckpoint[],blobs:Map<string,StoredMedia>){
 const counts=new Map<string,number>();const entries=rows.slice().sort((a,b)=>b.time-a.time).filter(row=>{if(!row.media.every(m=>blobs.has(m.hash)))return false;const n=counts.get(row.projectId)??0;counts.set(row.projectId,n+1);return n<perProject;}).slice(0,maximumCount);
 const total=()=>[...new Set(entries.flatMap(row=>row.media.map(m=>m.hash)))].reduce((sum,hash)=>sum+(blobs.get(hash)?.blob.size??maximumBytes+1),0);
 while(entries.length&&total()>maximumBytes)entries.pop();return entries;
}
/** Immutable binary snapshots are captured synchronously before the first await. */
export async function createCheckpoint(project:Project,reason:string,source:Map<string,{bytes:Uint8Array}>=media):Promise<CheckpointSummary>{
 const snapshot=validateProject(project),binary=snapshot.assets.map(asset=>{const entry=source.get(asset.id);if(!entry)throw Error(`Audio cadangan tidak tersedia: ${asset.name}`);return{id:asset.id,...capture(entry.bytes)};});
 return enqueue(async()=>{const captured=await Promise.all(binary.map(async entry=>({id:entry.id,hash:await entry.hash,blob:entry.blob}))),bytes=[...new Map(captured.map(m=>[m.hash,m.blob.size])).values()].reduce((a,b)=>a+b,0);if(bytes>maximumBytes)throw Error('Audio proyek melebihi kapasitas cadangan192MB. Simpan berkas .kura.');
  const payload=fingerprintPayload(snapshot,captured),fingerprint=await digest(new TextEncoder().encode(payload).buffer as ArrayBuffer);
  return transact('readwrite',(store,audio,rows,blobs)=>{const current=rows.filter(validSummary),latest=current.filter(r=>r.projectId===snapshot.id).slice().sort((a,b)=>b.time-a.time)[0];
   const duplicate=latest?.fingerprint===fingerprint&&latest.bytes===bytes&&fingerprintPayload(latest.project,latest.media)===payload;
   const next:StoredCheckpoint=duplicate?latest:{id:uid(),projectId:snapshot.id,name:snapshot.name,time:Math.max(Date.now(),...current.map(r=>r.time+1)),reason:reason.slice(0,100),clipCount:snapshot.clips.length,bytes,project:snapshot,media:captured.map(({id,hash})=>({id,hash})),fingerprint};
   const sources=new Map(blobs.filter(blob=>hashString(blob.hash)&&blob.blob instanceof Blob).map(blob=>[blob.hash,{...blob,bytes:blob.blob.size}]));for(const blob of captured)sources.set(blob.hash,{hash:blob.hash,blob:blob.blob,bytes:blob.blob.size});const keep=retained(duplicate?current:[next,...current],sources);if(!keep.some(r=>r.id===next.id))throw Error('Kapasitas cadangan tidak cukup. Simpan berkas .kura.');
   const ids=new Set(keep.map(row=>row.id)),hashes=new Set(keep.flatMap(row=>row.media.map(m=>m.hash)));for(const row of rows as {id:IDBValidKey}[])if(!ids.has(row.id as string))store.delete(row.id);store.put(next);
   for(const blob of blobs)if(!hashes.has(blob.hash))audio.delete(blob.hash);
   // Rewriting captured immutable blobs also repairs an unchanged version after storage corruption.
   for(const [hash,blob]of sources)if(hashes.has(hash))audio.put(blob);return summary(next);
  });
 });
}
export function listCheckpoints(projectId?:string):Promise<CheckpointSummary[]>{return enqueue(()=>transact('readonly',(_store,_audio,rows)=>rows.filter(validSummary).filter(row=>!projectId||row.projectId===projectId).slice().sort((a,b)=>b.time-a.time).map(summary)));}
export function readCheckpoint(id:string):Promise<{project:Project;media:{id:string;bytes:Uint8Array}[];summary:CheckpointSummary}|null>{return enqueue(async()=>{
 const record=await transact('readonly',(_store,_audio,rows,blobs)=>{const row=(rows as StoredCheckpoint[]).find(r=>r.id===id);if(!row)return null;if(!validSummary(row))throw Error('Metadata cadangan rusak. Buka berkas .kura yang terakhir disimpan.');const project=validateProject(row.project),sources=new Map(blobs.map(blob=>[blob.hash,blob]));if(row.media.length!==project.assets.length)throw Error('Audio cadangan tidak lengkap.');return{row,project,blobs:project.assets.map(asset=>{const records=row.media.filter(m=>m.id===asset.id),entry=records.length===1?sources.get(records[0].hash):undefined;if(!entry||!(entry.blob instanceof Blob))throw Error(`Audio cadangan hilang: ${asset.name}`);return{id:asset.id,hash:entry.hash,blob:entry.blob};})};});
 if(!record)return null;
 const fingerprint=await digest(new TextEncoder().encode(fingerprintPayload(record.project,record.row.media)).buffer as ArrayBuffer);
 const bytes=[...new Map(record.blobs.map(entry=>[entry.hash,entry.blob.size])).values()].reduce((sum,size)=>sum+size,0);
 if(fingerprint!==record.row.fingerprint||bytes!==record.row.bytes)throw Error('Metadata cadangan rusak. Buka berkas .kura yang terakhir disimpan.');
 const binaries=await Promise.all(record.blobs.map(async entry=>{const buffer=await entry.blob.arrayBuffer();if(await digest(buffer)!==entry.hash)throw Error('Audio cadangan rusak. Buka berkas .kura.');return{id:entry.id,bytes:new Uint8Array(buffer)};}));return{project:record.project,media:binaries,summary:summary(record.row)};
});}
export function deleteCheckpoint(id:string):Promise<void>{return enqueue(()=>transact('readwrite',(store,audio,rows,blobs)=>{store.delete(id);const hashes=new Set(rows.filter(validSummary).filter(r=>r.id!==id).flatMap(r=>r.media.map(m=>m.hash)));for(const blob of blobs)if(!hashes.has(blob.hash))audio.delete(blob.hash);}));}
