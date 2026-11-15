// 内置引擎自测：不经过 phone-bridge，直接在 _app 里合成一段语音
import path from 'node:path';
import fs from 'node:fs';

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));

const tts = await import('./tts.mjs');
console.log('TTS 模块加载 OK，默认音色 =', tts.DEFAULT_VOICE);

const t0 = Date.now();
const r = await tts.synth('内置引擎测试，我是大肥鱼。', tts.DEFAULT_VOICE, 'neutral', 1);
const ms = Date.now() - t0;
const st = fs.statSync(r.file);
console.log('合成成功', ms + 'ms', st.size + ' 字节');
console.log('  引擎 =', r.engine, '| 时长 =', r.dur + 's', '| 缓存命中 =', r.cached);
