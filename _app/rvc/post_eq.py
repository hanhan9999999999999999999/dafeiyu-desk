# -*- coding: utf-8 -*-
"""后处理校正：把 RVC 输出拉回接近原声的频段分布。

三条：
1. 高通 85Hz —— 砍掉模型多出来的低频轰隆（那部分是「闷」的来源）
2. 4.2kHz 窄带轻削 —— 压一点中高频的沙（-2.5dB，Q 别太高，否则出相位声）
3. 9kHz 高通架轻微提升 —— 补回空气感

原则：全是缓坡（一阶高通 / 宽 Q），宁可少做也不要做出「调过声」的假。
"""

import numpy as np
from scipy.signal import butter, sosfilt, iirpeak

SR = 48000


def highpass(x, fc=85.0, order=2):
    sos = butter(order, fc / (SR / 2), btype="highpass", output="sos")
    return sosfilt(sos, x).astype("float32")


def peaking_cut(x, fc, gain_db, q=1.0):
    """在 fc 附近做一个可调的凹陷。用二阶 peak 的补集近似。"""
    from scipy.signal import iirfilter, sosfilt

    b, a = iirpeak(fc / (SR / 2), q)
    # iirpeak 是带通；用原信号减去一部分带通 = 削掉这一段
    band = sosfilt([b], x) if False else None
    return x


def peaking(x, fc, gain_db, q=1.0):
    """标准 RBJ peaking EQ（双二阶）。"""
    A = 10 ** (gain_db / 40.0)
    w0 = 2 * np.pi * fc / SR
    alpha = np.sin(w0) / (2 * q)
    b0 = 1 + alpha * A
    b1 = -2 * np.cos(w0)
    b2 = 1 - alpha * A
    a0 = 1 + alpha / A
    a1 = -2 * np.cos(w0)
    a2 = 1 - alpha / A
    b = np.array([b0 / a0, b1 / a0, b2 / a0])
    a = np.array([1.0, a1 / a0, a2 / a0])
    from scipy.signal import lfilter

    return lfilter(b, a, x).astype("float32")


def high_shelf(x, fc=9000.0, gain_db=2.5, slope=0.8):
    A = 10 ** (gain_db / 40.0)
    w0 = 2 * np.pi * fc / SR
    cw = np.cos(w0)
    sw = np.sin(w0)
    alpha = sw / 2 * np.sqrt((A + 1 / A) * (1 / slope - 1) + 2)
    b0 = A * ((A + 1) + (A - 1) * cw + 2 * np.sqrt(A) * alpha)
    b1 = -2 * A * ((A - 1) + (A + 1) * cw)
    b2 = A * ((A + 1) + (A - 1) * cw - 2 * np.sqrt(A) * alpha)
    a0 = (A + 1) - (A - 1) * cw + 2 * np.sqrt(A) * alpha
    a1 = 2 * ((A - 1) - (A + 1) * cw)
    a2 = (A + 1) - (A - 1) * cw - 2 * np.sqrt(A) * alpha
    from scipy.signal import lfilter

    return lfilter(np.array([b0 / a0, b1 / a0, b2 / a0]),
                   np.array([1.0, a1 / a0, a2 / a0]), x).astype("float32")


def condition(x, sr=None):
    """对 RVC 输出做整套校正。输入输出都是 float32 一维。

    参数是拿 Warma 这个模型实测扫出来的（见 _test/diag_sweep.py）：
    扫了 27 组高通/削峰/提架的组合，按「和原声频段分布的欧氏距离」排序，
    hp=140 / cut=-2.5dB@4.2k / shelf=+5.5dB@9k 这一组最接近原声。

    低频那块（0-300Hz 比原声多约 10 个百分点）故意不动：
    女声基频就在 165-255Hz，硬砍会把音色本身砍掉，得不偿失。
    """
    if x is None or len(x) < 512:
        return x
    y = np.asarray(x, dtype="float32")
    if sr and sr != SR:
        # 校正参数是按 48k 设计的；别的采样率就别硬套了
        return y
    y = highpass(y, 140.0, 2)
    y = peaking(y, 4200.0, -2.5, 0.9)
    y = high_shelf(y, 9000.0, 5.5, 0.8)
    # 校正可能把峰值推过 1，统一压回来（不做归一化，只防削波）
    peak = float(np.max(np.abs(y)))
    if peak > 0.98:
        y = y * (0.98 / peak)
    return y.astype("float32")
