import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
export function toneWav(seconds=2,rate=16000){
 const frames=Math.floor(seconds*rate),b=Buffer.alloc(44+frames*2);
 b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(rate,24);b.writeUInt32LE(rate*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(frames*2,40);
 for(let i=0;i<frames;i++)b.writeInt16LE(Math.round(Math.sin(i*2*Math.PI*220/rate)*5000),44+i*2);return b;
}
export async function audioFixture(){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'kuraudio-test-'));const file=path.join(dir,'tone.wav');await fs.writeFile(file,toneWav());return {file,cleanup:()=>fs.rm(dir,{recursive:true,force:true})};}
