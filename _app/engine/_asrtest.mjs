import fs from 'node:fs';
import path from 'node:path';
const asr = await import('./asr.mjs');
console.log('ASR 模块加载 OK');
const buf = fs.readFileSync(path.resolve('../_test/fake-mic.wav'));
const t0 = Date.now();
const r = await asr.transcribe(buf, 'wav');
console.log('识别结果:', JSON.stringify(r).slice(0, 400));
console.log('耗时', Date.now() - t0, 'ms');
