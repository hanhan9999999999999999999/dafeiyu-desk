# -*- coding: utf-8 -*-
"""一个只够用的 torch 替身，全部用 numpy / scipy 实现。

## 为什么要这个

RVC 的运行时（onnx 推理）其实只用 torch 做**一件事**：把音频转成 mel 频谱，
一共五步 —— hann 窗、STFT、取模、matmul、log。剩下就是 rms 混合里的插值和乘方。

而 torch 一个包就占 1031MB，是整个 Python 环境里最大的一块（总共 1.9GB）。
换成 numpy 之后安装包能瘦一大截，用户那边也不用再为这点计算下一个深度学习框架。

## 精度

和真 torch 对拍过（`_test/cmp_mel.py`）：
形状完全一致 (128, 201)、最大绝对差 0.000039、相关性 1.00000000。

## 注意

这个 shim **只实现被用到的那几个函数**，不是通用替代品。
真正需要 torch 的地方（把 .pth 导出成 .onnx，那要跑完整的网络前向）
不能走这里，得用真 torch —— `pth_to_onnx.py` 会自己找。
"""
from __future__ import annotations

import math

import numpy as np

__all__ = [
    "Tensor", "from_numpy", "tensor", "zeros", "ones",
    "stft", "hann_window", "matmul", "clamp", "log", "pow", "maximum", "abs",
    "nn", "no_grad", "is_available", "float32", "float64", "int64", "device",
]


# ── Tensor ────────────────────────────────────────────────────────────
class _Device(object):
    """真 torch 的 device 有 .index / .type，这里只需要不炸。"""
    type = "cpu"
    index = None

    def __str__(self):
        return "cpu"


device = _Device()
float32 = np.float32
float64 = np.float64
int64 = np.int64


class Tensor(object):
    """薄薄一层 ndarray 包装，只为支持代码里那些链式调用。"""

    __slots__ = ("_a",)

    def __init__(self, a):
        self._a = np.asarray(a)

    # —— 属性 ——
    @property
    def shape(self):
        return self._a.shape

    @property
    def dtype(self):
        return self._a.dtype

    @property
    def ndim(self):
        return self._a.ndim

    @property
    def device(self):
        return device

    @property
    def T(self):
        return Tensor(self._a.T)

    # —— 形状 ——
    def dim(self):
        return self._a.ndim

    def ndimension(self):
        return self._a.ndim

    def size(self, i=None):
        if i is None:
            return self._a.shape
        return self._a.shape[i]

    def squeeze(self, axis=None):
        return Tensor(np.squeeze(self._a, axis=axis))

    def unsqueeze(self, axis):
        return Tensor(np.expand_dims(self._a, axis))

    def reshape(self, *shape):
        if len(shape) == 1 and isinstance(shape[0], (tuple, list)):
            shape = tuple(shape[0])
        return Tensor(self._a.reshape(shape))

    def view(self, *shape):
        return self.reshape(*shape)

    def flatten(self):
        return Tensor(self._a.ravel())

    def transpose(self, a, b):
        return Tensor(np.swapaxes(self._a, a, b))

    def permute(self, *axes):
        if len(axes) == 1 and isinstance(axes[0], (tuple, list)):
            axes = tuple(axes[0])
        return Tensor(np.transpose(self._a, axes))

    # —— 类型 ——
    def float(self):
        return Tensor(self._a.astype(np.float32))

    def double(self):
        return Tensor(self._a.astype(np.float64))

    def long(self):
        return Tensor(self._a.astype(np.int64))

    def to(self, *a, **kw):
        return self

    def cpu(self):
        return self

    def numpy(self):
        return self._a

    def detach(self):
        return self

    def clone(self):
        return Tensor(self._a.copy())

    def contiguous(self):
        return Tensor(np.ascontiguousarray(self._a))

    def item(self):
        return self._a.item()

    def tolist(self):
        return self._a.tolist()

    # —— 数学 ——
    def abs(self):
        return Tensor(np.abs(self._a))

    def sqrt(self):
        return Tensor(np.sqrt(self._a))

    def mean(self, axis=None, keepdims=False):
        return Tensor(np.mean(self._a, axis=axis, keepdims=keepdims))

    def sum(self, axis=None, keepdims=False):
        return Tensor(np.sum(self._a, axis=axis, keepdims=keepdims))

    def max(self, axis=None, keepdims=False):
        return Tensor(np.max(self._a, axis=axis, keepdims=keepdims))

    def min(self, axis=None, keepdims=False):
        return Tensor(np.min(self._a, axis=axis, keepdims=keepdims))

    def exp(self):
        return Tensor(np.exp(self._a))

    def log(self):
        return Tensor(np.log(self._a))

    def pow(self, e):
        return Tensor(np.power(self._a, e))

    def clamp(self, min=None, max=None):
        return Tensor(np.clip(self._a, min, max))

    def clip(self, min=None, max=None):
        return self.clamp(min, max)

    def __len__(self):
        return len(self._a)

    def __iter__(self):
        for x in self._a:
            yield Tensor(x)

    def __getitem__(self, k):
        return Tensor(self._a[k])

    def __setitem__(self, k, v):
        self._a[k] = v._a if isinstance(v, Tensor) else v

    def __add__(self, o):
        return Tensor(self._a + (o._a if isinstance(o, Tensor) else o))

    __radd__ = __add__

    def __sub__(self, o):
        return Tensor(self._a - (o._a if isinstance(o, Tensor) else o))

    def __rsub__(self, o):
        return Tensor((o._a if isinstance(o, Tensor) else o) - self._a)

    def __mul__(self, o):
        return Tensor(self._a * (o._a if isinstance(o, Tensor) else o))

    __rmul__ = __mul__

    def __truediv__(self, o):
        return Tensor(self._a / (o._a if isinstance(o, Tensor) else o))

    def __rtruediv__(self, o):
        return Tensor((o._a if isinstance(o, Tensor) else o) / self._a)

    def __neg__(self):
        return Tensor(-self._a)

    def __repr__(self):
        return "Tensor(%r)" % (self._a,)


# ── 构造 ──────────────────────────────────────────────────────────────
def from_numpy(a):
    return Tensor(np.asarray(a))


def tensor(data, dtype=None, device=None, **kw):
    a = np.asarray(data)
    if dtype is not None:
        a = a.astype(dtype)
    return Tensor(a)


def zeros(*shape, **kw):
    if len(shape) == 1 and isinstance(shape[0], (tuple, list)):
        shape = tuple(shape[0])
    return Tensor(np.zeros(shape, dtype=kw.get("dtype", np.float32)))


def ones(*shape, **kw):
    if len(shape) == 1 and isinstance(shape[0], (tuple, list)):
        shape = tuple(shape[0])
    return Tensor(np.ones(shape, dtype=kw.get("dtype", np.float32)))


# ── 窗口 / 变换 ───────────────────────────────────────────────────────
def hann_window(n, periodic=True, **kw):
    """torch.hann_window 默认 periodic=True，等价于 numpy 的 hanning(n+1)[:-1]。"""
    if periodic:
        w = np.hanning(n + 1)[:-1]
    else:
        w = np.hanning(n)
    return Tensor(w.astype(np.float32))


def stft(x, n_fft, hop_length=None, win_length=None, window=None,
         center=True, pad_mode="reflect", normalized=False,
         onesided=True, return_complex=True, **kw):
    """对齐 torch.stft(return_complex=True) 的行为：返回 (batch, freq, frames)。"""
    a = x._a if isinstance(x, Tensor) else np.asarray(x)
    a = np.asarray(a, dtype=np.float32)
    if a.ndim == 1:
        a = a[None, :]
    hop = hop_length or (win_length or n_fft) // 4
    win = win_length or n_fft
    if window is None:
        w = np.hanning(win + 1)[:-1].astype(np.float32)
    else:
        w = (window._a if isinstance(window, Tensor) else np.asarray(window)).astype(np.float32)
        if len(w) != win:
            # torch 会把 window 居中裁/补到 win_length
            if len(w) > win:
                off = (len(w) - win) // 2
                w = w[off:off + win]
            else:
                pad = win - len(w)
                w = np.pad(w, (pad // 2, pad - pad // 2))

    if center:
        p = win // 2
        a = np.pad(a, ((0, 0), (p, p)), mode=pad_mode)

    if a.shape[1] < win:
        a = np.pad(a, ((0, 0), (0, win - a.shape[1])), mode=pad_mode)

    n_frames = 1 + (a.shape[1] - win) // hop
    idx = np.arange(win)[None, :] + hop * np.arange(n_frames)[:, None]
    frames = a[:, idx] * w[None, None, :]                 # (batch, frames, win)

    if normalized:
        frames = frames / np.sqrt(np.sum(w ** 2))

    # 注意用 scipy.fft 而不是 np.fft：
    # np.fft 会把 float32 输入升成 complex128（numpy 的 FFT 不支持单精度），
    # 后面每一步都跟着变双精度，实测整个转换从 3.9s 拖到 7.5s。
    try:
        from scipy import fft as _sfft
        if onesided:
            spec = _sfft.rfft(frames, n=n_fft, axis=-1, workers=1)
        else:
            spec = _sfft.fft(frames, n=n_fft, axis=-1, workers=1)
    except Exception:
        spec = np.fft.rfft(frames, n=n_fft, axis=-1) if onesided \
            else np.fft.fft(frames, n=n_fft, axis=-1)
    # (batch, frames, freq) -> (batch, freq, frames)
    return Tensor(np.ascontiguousarray(spec.transpose(0, 2, 1)))


# ── 数学函数 ──────────────────────────────────────────────────────────
def _arr(x):
    return x._a if isinstance(x, Tensor) else x


def matmul(a, b):
    return Tensor(np.matmul(_arr(a), _arr(b)))


def clamp(x, min=None, max=None):
    a = _arr(x)
    # 保持原 dtype：np.clip 遇到 Python float 标量会把 float32 提升成 float64，
    # 下游每一步都跟着变慢（实测整个转换从 3.9s 拖到 7.5s）。
    lo = None if min is None else (np.float32(min) if a.dtype == np.float32 else min)
    hi = None if max is None else (np.float32(max) if a.dtype == np.float32 else max)
    return Tensor(np.clip(a, lo, hi).astype(a.dtype, copy=False))


def log(x):
    a = _arr(x)
    return Tensor(np.log(a).astype(a.dtype, copy=False))


def pow(x, e):
    return Tensor(np.power(_arr(x), _arr(e) if isinstance(e, Tensor) else e))


def maximum(a, b):
    return Tensor(np.maximum(_arr(a), _arr(b)))


def minimum(a, b):
    return Tensor(np.minimum(_arr(a), _arr(b)))


def abs(x):                                    # noqa: A001  和 torch.abs 同名
    return Tensor(np.abs(_arr(x)))


def cat(xs, dim=0):
    return Tensor(np.concatenate([_arr(x) for x in xs], axis=dim))


def stack(xs, dim=0):
    return Tensor(np.stack([_arr(x) for x in xs], axis=dim))


def interpolate(x, size=None, scale_factor=None, mode="nearest", align_corners=None, **kw):
    """只做 1D/2D 线性（含 bilinear）插值——RVC 里只用到这两条路。"""
    a = np.asarray(_arr(x), dtype=np.float32)
    if size is None:
        return Tensor(a)

    # size 可能是 int，也可能是 (h, w)
    if isinstance(size, int):
        target = (size,)
    else:
        target = tuple(int(v) for v in size)

    # 把待缩放的那几维对齐到 target；前导的 batch/channel 维保持不动
    n_extra = a.ndim - len(target)
    if n_extra < 0:
        raise ValueError("interpolate: size 维度比输入多")

    src_shape = a.shape[n_extra:]
    out = a
    for d in range(len(target)):
        if src_shape[d] == target[d]:
            continue
        axis = n_extra + d
        n_in, n_out = out.shape[axis], target[d]
        # 沿 axis 做线性插值
        if n_in == 1:
            out = np.repeat(out, n_out, axis=axis)
            continue
        if align_corners:
            pos = np.linspace(0, n_in - 1, n_out)
        else:
            # 和 torch 的 align_corners=False 一致：半个像素偏移
            pos = (np.arange(n_out) + 0.5) * (n_in / n_out) - 0.5
            pos = np.clip(pos, 0, n_in - 1)
        lo = np.floor(pos).astype(np.int64)
        hi = np.minimum(lo + 1, n_in - 1)
        w = (pos - lo).astype(np.float32)

        # 把要插值的那一维搬到末尾、压成二维再做索引。
        # 直接在原 axis 上用 np.take 走的是非连续内存，768xT 这种会慢一个数量级
        # （实测 apply_protection 从 1.8s 降到 0.1s）。
        moved = np.moveaxis(out, axis, -1)
        flat = moved.reshape(-1, n_in)
        res = flat[:, lo] * (1.0 - w)[None, :] + flat[:, hi] * w[None, :]
        out = np.moveaxis(res.reshape(moved.shape[:-1] + (n_out,)), -1, axis)
    return Tensor(out)


# ── nn 命名空间（只够 Module / functional 有点样子）───────────────────
class Module(object):
    """最小可用的 Module：只支持 register_buffer 和 forward 被子类覆盖。"""

    def __init__(self, *a, **kw):
        object.__setattr__(self, "_buffers", {})

    def register_buffer(self, name, t, persistent=True):
        if isinstance(t, Tensor):
            self._buffers[name] = t
            object.__setattr__(self, name, t)
        else:
            tt = Tensor(np.asarray(t))
            self._buffers[name] = tt
            object.__setattr__(self, name, tt)

    def __call__(self, *a, **kw):
        return self.forward(*a, **kw)

    def forward(self, *a, **kw):
        raise NotImplementedError

    def eval(self):
        return self

    def to(self, *a, **kw):
        return self

    def cuda(self):
        return self

    def cpu(self):
        return self


class _Functional(object):
    interpolate = staticmethod(interpolate)

    @staticmethod
    def pad(x, pad, mode="constant", value=0.0):
        a = np.asarray(_arr(x), dtype=np.float32)
        # pad 是 (left, right) 或 (left, right, top, bottom)
        if len(pad) == 2:
            a = np.pad(a, ((0, 0), (pad[0], pad[1])), mode="constant", constant_values=value)
        elif len(pad) == 4:
            a = np.pad(a, ((0, 0), (0, 0), (pad[2], pad[3]), (pad[0], pad[1])),
                       mode="constant", constant_values=value)
        return Tensor(a)

    @staticmethod
    def relu(x):
        return Tensor(np.maximum(_arr(x), 0))

    @staticmethod
    def softmax(x, dim=-1):
        a = np.asarray(_arr(x), dtype=np.float32)
        e = np.exp(a - a.max(axis=dim, keepdims=True))
        return Tensor(e / e.sum(axis=dim, keepdims=True))


class _NN(object):
    Module = Module
    functional = _Functional()

    class Parameter(object):
        def __init__(self, a):
            self._a = np.asarray(a)

    @staticmethod
    def Linear(*a, **kw):
        raise NotImplementedError("shim 只支持推理路径，没有 Linear")


nn = _NN()


class no_grad(object):
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def __call__(self, fn):
        def wrapper(*a, **kw):
            return fn(*a, **kw)
        return wrapper


def is_available():
    return False


def manual_seed(seed):
    np.random.seed(int(seed) % (2 ** 32))


# 让 `torch.Tensor.dtype == torch.float32` 这类比较能成立
Tensor.__module__ = "torch_shim"
