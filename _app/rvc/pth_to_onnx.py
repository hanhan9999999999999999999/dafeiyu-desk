# -*- coding: utf-8 -*-
"""把 RVC 的 .pth 转成 .onnx —— 用户只需要 torch，不需要 fairseq。

为什么这件事重要：`.pth` 的 RVC 依赖 fairseq，而 fairseq 得在用户机器上现场编译
（要 Visual Studio Build Tools），普通电脑根本装不上。转成 ONNX 之后只需要
onnxruntime，一键安装那套环境就能跑。

用法：
    python pth_to_onnx.py <输入.pth> <输出.onnx>

退出码：0 成功 / 1 失败（错误信息在 stdout 末行，主进程直接透传给用户）。
"""
import os
import sys
import time
import traceback

t0 = time.time()

# 模型定义的来源：优先同目录下的 fish_rvc_model（打包版就是这样），
# 其次 site-packages（开发机上装过）。它只依赖 torch，不需要 fairseq。
_HERE = os.path.dirname(os.path.abspath(__file__))
for _cand in (os.path.join(_HERE), os.path.join(_HERE, "py", "Lib", "site-packages")):
    if os.path.isdir(os.path.join(_cand, "fish_rvc_model")):
        if _cand not in sys.path:
            sys.path.insert(0, _cand)
        break


def say(msg):
    print("[onnx] " + str(msg), flush=True)


def main():
    if len(sys.argv) < 3:
        say("用法: pth_to_onnx.py <输入.pth> <输出.onnx>")
        return 1
    src, dst = sys.argv[1], sys.argv[2]
    if not os.path.isfile(src):
        say("找不到输入文件: " + src)
        return 1

    import torch

    # torch>=2.6 的 torch.load 默认 weights_only=True，会拦 checkpoint 里的自定义类。
    # 转换阶段读的是完整 checkpoint，显式关掉。
    _orig = torch.load

    def _load(*a, **kw):
        kw.setdefault("weights_only", False)
        return _orig(*a, **kw)

    torch.load = _load

    say("torch " + torch.__version__)
    say("读 " + os.path.basename(src) + "（" + str(round(os.path.getsize(src) / 1048576, 1)) + " MB）")

    ck = torch.load(src, map_location="cpu")
    weight = ck.get("weight") or ck.get("model") or ck
    if not isinstance(weight, dict):
        say("这个文件里没有权重字典")
        return 1

    # 版本靠 emb_phone 的维度判断：256 = v1，768 = v2。
    # 报错信息不会告诉你是版本不对，只会说 size mismatch，所以这里自己认。
    version = "v2"
    for k in weight:
        if k.endswith("enc_p.emb_phone.weight"):
            dim = int(weight[k].shape[1])
            version = "v1" if dim == 256 else "v2"
            say("emb_phone 维度 " + str(dim) + " → " + version)
            break
    else:
        say("没找到 emb_phone，按 v2 试")

    # 采样率和 f0 标志在 checkpoint 顶层，不在 weight 里。
    # sr 可能是数字，也可能是 "48k" 这种字符串，两种都要认。
    raw_sr = ck.get("sr") or 40000
    if isinstance(raw_sr, str):
        s = raw_sr.strip().lower()
        if s.endswith("k"):
            sr = int(float(s[:-1]) * 1000)
        else:
            sr = int(float(s))
    else:
        sr = int(raw_sr)
    f0 = int(ck.get("f0") or 1)
    say("sr=" + str(sr) + " f0=" + str(f0))

    # 构造参数的权威来源就是 checkpoint 里的 config，直接 *cfg 解包。
    # 别按签名手填 18 个位置参数——错一个是 `dropout probability ... but got 3` 这种荒唐报错。
    cfg = ck.get("config")
    if not isinstance(cfg, (list, tuple)) or len(cfg) < 10:
        say("这个 checkpoint 没有 config，认不出模型结构")
        return 1
    cfg = list(cfg)

    # n_spk 的权威在权重里（emb_g），config[-3] 那个位置经常是占位的 1。
    n_spk = 1
    for k, v in weight.items():
        if k.endswith("emb_g.weight"):
            n_spk = int(v.shape[0])
            break
    if len(cfg) >= 3:
        cfg[-3] = n_spk
    say("说话人数 " + str(n_spk) + "  config 长度 " + str(len(cfg)))

    from fish_rvc_model.infer_pack.models_onnx import SynthesizerTrnMsNSFsidM

    # 用官方给 ONNX 准备的那个类：它的 forward 正好是 6 个输入
    # （phone, phone_lengths, pitch, pitchf, ds, rnd），推理路径，不含训练分支。
    # 用普通的 SynthesizerTrnMs768NSFsid 会报 forward() missing 2 required positional arguments。
    try:
        net = SynthesizerTrnMsNSFsidM(*cfg, is_half=False, version=version)
    except TypeError:
        net = SynthesizerTrnMsNSFsidM(*cfg, is_half=False)
    net.eval()
    say("建好网络，开始灌权重")
    missing, unexpected = net.load_state_dict(weight, strict=False)
    if missing:
        say("缺 %d 项（前 3 个: %s）" % (len(missing), ", ".join(list(missing)[:3])))
    if unexpected:
        say("多 %d 项（前 3 个: %s）" % (len(unexpected), ", ".join(list(unexpected)[:3])))
    say("权重灌完（" + str(round(time.time() - t0, 1)) + "s）")

    # 导出用的假输入。vec 通道数 v1=256 / v2=768。
    import torch as T

    vec_ch = 256 if version == "v1" else 768
    n = 200
    phone = T.rand(1, n, vec_ch)
    lengths = T.tensor([n]).long()
    pitch = T.randint(size=(1, n), low=5, high=255)
    pitchf = T.rand(1, n)
    ds = T.LongTensor([0])
    rnd = T.rand(1, 192, n)

    os.makedirs(os.path.dirname(os.path.abspath(dst)) or ".", exist_ok=True)
    say("导出中…")
    # torch 2.5+ 的 onnx.export 默认走 dynamo 新路径，需要额外的 onnxscript 包；
    # 老版（2.1.x，一键安装装的就是这个）没有这个参数。
    # 这里优先用老 tracing 路径：行为一致，也不给用户多加一个依赖。
    kw = dict(
        dynamic_axes={
            "phone": [1],
            "pitch": [1],
            "pitchf": [1],
            "rnd": [2],
        },
        do_constant_folding=False,
        opset_version=13,
        verbose=False,
        input_names=["phone", "phone_lengths", "pitch", "pitchf", "ds", "rnd"],
        output_names=["audio"],
    )
    try:
        _ = T.onnx.export.__doc__ or ""
        with T.no_grad():
            T.onnx.export(net, (phone, lengths, pitch, pitchf, ds, rnd), dst, dynamo=False, **kw)
        say("（用了新版 tracing）")
    except TypeError:
        with T.no_grad():
            T.onnx.export(net, (phone, lengths, pitch, pitchf, ds, rnd), dst, **kw)

    size = os.path.getsize(dst) / 1048576 if os.path.isfile(dst) else 0
    say("完成 " + os.path.basename(dst) + "  " + str(round(size, 1)) + " MB  用时 " + str(round(time.time() - t0, 1)) + "s")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:
        _msg = type(e).__name__ + ": " + str(e)[:400]
        # 缺包这类错误把它翻译成「该怎么办」，不然用户看到
        # "Module onnx is not installed!" 只会一脸茫然。
        if "onnxscript" in str(e):
            _msg = "缺 onnxscript（新版 torch 需要），在设置里点一次「一键安装」会装上"
        elif "Module onnx is not installed" in str(e) or "No module named 'onnx'" in str(e):
            _msg = "缺 onnx 包，在设置里点一次「一键安装」会装上"
        elif "No module named 'torch'" in str(e):
            _msg = "这个 Python 里没有 torch，设置里点一次「一键安装」"
        say("失败: " + _msg)
        traceback.print_exc()
        sys.exit(1)
