// 启动钩子。放在 body 最末尾加载，此时 DOM 和前面所有脚本都已就绪。
//
// 为什么单独一个文件而不是内联 <script>：内联脚本逼着 CSP 放开
// 'unsafe-inline'，而 script-src 一旦允许内联，注入防护就等于没有。
// 拆成文件后 script-src 可以只留 'self'。
//
// 为什么不等 load：贴图还在下载，load 可能来得比预期晚很多，界面会先空着。
if (window.FishVoice) window.FishVoice.init();
