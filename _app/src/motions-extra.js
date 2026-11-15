// 大肥鱼动作库 · 扩展包
// motions.js 是生成文件（82 个基础动作），这里不手改它，只在它后面补一层。
// 约定和基础库一致：
//   1. 只用基础库已有的 11 个参数，不碰 Movement1/2/3；
//   2. 不做「眼睛变纯色 + 头歪」，歪头一律配正常五官；
//   3. 每个动作首尾都回中，交给 renderer 的淡入淡出接前后；
//   4. 时长控制在 1.2–3.0 秒，给动作衔接留出余韵。
(function () {
  const M = window.FishMotions || (window.FishMotions = {});
  const S = window.FishMotionScenes || (window.FishMotionScenes = {});

  const extra = {
    // ---------- 招呼 / 告别 ----------
    "greetNod": [
      ["ParamAngleY", [[0, 0], [0.22, 8], [0.44, 9.5], [0.72, -1], [1.5, 0]]],
      ["ParamAngleZ", [[0, 0], [0.24, -2.2], [0.7, -1.4], [1.5, 0]]],
      ["ParamEyeLOpen", [[0, 1], [0.36, 0.9], [0.8, 1], [1.5, 1]]],
      ["ParamEyeROpen", [[0, 1], [0.36, 0.9], [0.8, 1], [1.5, 1]]],
      ["ParamBodyAngleX", [[0, 0], [0.4, -1.4], [0.9, 0.4], [1.5, 0]]],
      ["ParamMouthForm", [[0, 0], [0.3, 0.28], [1.1, 0.18], [1.5, 0]]],
    ],
    "greetTilt": [
      ["ParamAngleZ", [[0, 0], [0.3, -8], [0.6, -12], [1.2, -10.5], [1.7, 0]]],
      ["ParamAngleX", [[0, 0], [0.45, 4], [1.1, 5], [1.7, 0]]],
      ["ParamAngleY", [[0, 0], [0.42, 3], [1.2, 2], [1.7, 0]]],
      ["ParamEyeLOpen", [[0, 1], [0.36, 1.08], [1.2, 1.04], [1.7, 1]]],
      ["ParamEyeROpen", [[0, 1], [0.36, 1.08], [1.2, 1.04], [1.7, 1]]],
      ["ParamEyeBallX", [[0, 0], [0.5, 0.18], [1.2, 0.12], [1.7, 0]]],
      ["ParamMouthOpenY", [[0, 0], [0.5, 0.14], [1.2, 0.08], [1.7, 0]]],
    ],
    "welcome": [
      ["ParamAngleY", [[0, 0], [0.3, 5], [0.62, 7], [1.1, 2], [1.8, 0]]],
      ["ParamAngleZ", [[0, 0], [0.3, 3], [0.9, -3], [1.8, 0]]],
      ["ParamBodyAngleX", [[0, 0], [0.4, -2], [1.1, -1], [1.8, 0]]],
      ["ParamEyeLOpen", [[0, 1], [0.4, 1.06], [1.3, 1.02], [1.8, 1]]],
      ["ParamEyeROpen", [[0, 1], [0.4, 1.06], [1.3, 1.02], [1.8, 1]]],
      ["ParamMouthForm", [[0, 0], [0.4, 0.32], [1.3, 0.24], [1.8, 0]]],
    ],
    "farewell": [
      ["ParamAngleX", [[0, 0], [0.32, 5], [0.7, 9], [1.3, 8], [1.9, 0]]],
      ["ParamEyeBallX", [[0, 0], [0.4, -0.3], [1.3, -0.26], [1.9, 0]]],
      ["ParamAngleY", [[0, 0], [0.4, -3], [1.2, -2], [1.9, 0]]],
      ["ParamBodyAngleX", [[0, 0], [0.5, 1.5], [1.4, 1], [1.9, 0]]],
      ["ParamMouthForm", [[0, 0], [0.4, -0.12], [1.3, -0.18], [1.9, 0]]],
    ],

    // ---------- 同意 / 犹豫 / 明白 ----------
    "agreeSoft": [
      ["ParamAngleY", [[0, 0], [0.22, 5], [0.42, 6.5], [0.7, -0.5], [1.25, 0]]],
      ["ParamEyeLOpen", [[0, 1], [0.38, 0.92], [0.86, 1], [1.25, 1]]],
      ["ParamEyeROpen", [[0, 1], [0.38, 0.92], [0.86, 1], [1.25, 1]]],
      ["ParamBodyAngleX", [[0, 0], [0.36, -0.8], [0.8, 0.2], [1.25, 0]]],
      ["ParamMouthForm", [[0, 0], [0.4, 0.22], [1.25, 0]]],
    ],
    "disagreeSoft": [
      ["ParamAngleX", [[0, 0], [0.2, -6], [0.46, 6], [0.72, -4], [1.0, 2], [1.35, 0]]],
      ["ParamAngleZ", [[0, 0], [0.2, 2], [0.46, -1.5], [1.35, 0]]],
      ["ParamMouthForm", [[0, 0], [0.3, -0.25], [1.0, -0.18], [1.35, 0]]],
      ["ParamEyeLOpen", [[0, 1], [0.4, 0.9], [1.35, 1]]],
      ["ParamEyeROpen", [[0, 1], [0.4, 0.9], [1.35, 1]]],
    ],
    "maybeTilt": [
      ["ParamAngleZ", [[0, 0], [0.3, -10], [0.62, -12], [1.2, -10], [1.8, 0]]],
      ["ParamAngleX", [[0, 0], [0.45, 3], [1.2, 4], [1.8, 0]]],
      ["ParamEyeBallX", [[0, 0], [0.4, 0.2], [0.9, -0.1], [1.5, -0.05], [1.8, 0]]],
      ["ParamMouthForm", [[0, 0], [0.45, -0.05], [1.5, 0.08], [1.8, 0]]],
      ["ParamEyeLOpen", [[0, 1], [0.4, 1.05], [1.5, 1], [1.8, 1]]],
      ["ParamEyeROpen", [[0, 1], [0.4, 1.05], [1.5, 1], [1.8, 1]]],
    ],
    "realize": [
      ["ParamAngleY", [[0, 0], [0.18, -4], [0.4, 6], [0.62, 8], [0.95, 3], [1.5, 0]]],
      ["ParamEyeLOpen", [[0, 1], [0.2, 0.75], [0.45, 1.15], [0.75, 1.05], [1.5, 1]]],
      ["ParamEyeROpen", [[0, 1], [0.2, 0.75], [0.45, 1.15], [0.75, 1.05], [1.5, 1]]],
      ["ParamMouthOpenY", [[0, 0], [0.3, 0], [0.5, 0.28], [0.8, 0.18], [1.5, 0]]],
      ["ParamBodyAngleX", [[0, 0], [0.4, -1], [0.9, 0], [1.5, 0]]],
    ],
    "remember": [
      ["ParamAngleY", [[0, 0], [0.4, 6], [0.9, 7], [1.4, 5], [2.0, 0]]],
      ["ParamEyeBallY", [[0, 0], [0.4, 0.35], [1.2, 0.3], [2.0, 0]]],
      ["ParamEyeLOpen", [[0, 1], [0.4, 0.8], [1.2, 0.85], [2.0, 1]]],
      ["ParamEyeROpen", [[0, 1], [0.4, 0.8], [1.2, 0.85], [2.0, 1]]],
      ["ParamAngleZ", [[0, 0], [0.5, -3], [1.3, -2], [2.0, 0]]],
      ["ParamMouthForm", [[0, 0], [0.5, 0.1], [1.5, 0.16], [2.0, 0]]],
    ],
    "confusedBlink": [
      ["ParamEyeLOpen", [[0, 1], [0.2, 0.2], [0.34, 1], [0.52, 0.2], [0.68, 1], [1.7, 1]]],
      ["ParamEyeROpen", [[0, 1], [0.2, 0.2], [0.34, 1], [0.52, 0.2], [0.68, 1], [1.7, 1]]],
      ["ParamAngleZ", [[0, 0], [0.3, -7], [0.8, -9], [1.3, -8], [1.7, 0]]],
      ["ParamAngleX", [[0, 0], [0.5, 4], [1.3, 5], [1.7, 0]]],
      ["ParamMouthForm", [[0, 0], [0.4, -0.2], [1.3, -0.14], [1.7, 0]]],
    ],

    // ---------- 思考 / 倾听 ----------
    "thinkingHum": [
      ["ParamAngleZ", [[0, 0], [0.4, -4], [0.9, -7], [1.5, -6], [2.2, 0]]],
      ["ParamAngleY", [[0, 0], [0.5, 3], [1.4, 4], [2.2, 0]]],
      ["ParamEyeBallY", [[0, 0], [0.5, 0.3], [1.5, 0.26], [2.2, 0]]],
      ["ParamEyeBallX", [[0, 0], [0.5, -0.25], [1.4, -0.2], [2.2, 0]]],
      ["ParamMouthForm", [[0, 0], [0.6, -0.1], [1.6, -0.16], [2.2, 0]]],
      ["ParamEyeLOpen", [[0, 1], [0.6, 0.86], [1.6, 0.9], [2.2, 1]]],
      ["ParamEyeROpen", [[0, 1], [0.6, 0.86], [1.6, 0.9], [2.2, 1]]],
    ],
    "thinkingAha": [
      ["ParamAngleY", [[0, 0], [0.2, -2], [0.45, 8], [0.7, 10], [1.0, 4], [1.4, 0]]],
      ["ParamEyeLOpen", [[0, 1], [0.25, 1], [0.5, 1.15], [0.9, 1.05], [1.4, 1]]],
      ["ParamEyeROpen", [[0, 1], [0.25, 1], [0.5, 1.15], [0.9, 1.05], [1.4, 1]]],
      ["ParamMouthOpenY", [[0, 0], [0.3, 0], [0.55, 0.3], [0.85, 0.22], [1.4, 0]]],
      ["ParamAngleZ", [[0, 0], [0.35, 2], [0.7, -2], [1.4, 0]]],
      ["ParamBodyAngleX", [[0, 0], [0.4, -2], [0.9, 0], [1.4, 0]]],
    ],
    "listeningTilt": [
      ["ParamAngleZ", [[0, 0], [0.45, -9], [0.9, -11], [1.5, -10], [2.0, 0]]],
      ["ParamAngleX", [[0, 0], [0.55, 5], [1.5, 5], [2.0, 0]]],
      ["ParamEyeLOpen", [[0, 1], [0.45, 1.06], [1.5, 1.04], [2.0, 1]]],
      ["ParamEyeROpen", [[0, 1], [0.45, 1.06], [1.5, 1.04], [2.0, 1]]],
      ["ParamEyeBallX", [[0, 0], [0.5, 0.12], [1.5, 0.1], [2.0, 0]]],
      ["ParamMouthOpenY", [[0, 0], [0.6, 0.1], [1.5, 0.06], [2.0, 0]]],
    ],
    "listeningNod": [
      ["ParamAngleY", [[0, 0], [0.24, 4], [0.46, 6], [0.72, 1], [1.6, 0]]],
      ["ParamEyeLOpen", [[0, 1], [0.4, 0.95], [0.9, 1], [1.6, 1]]],
      ["ParamEyeROpen", [[0, 1], [0.4, 0.95], [0.9, 1], [1.6, 1]]],
      ["ParamBodyAngleX", [[0, 0], [0.4, -0.8], [1.0, 0], [1.6, 0]]],
      ["ParamMouthForm", [[0, 0], [0.4, 0.14], [1.6, 0]]],
    ],

    // ---------- 安慰 / 道歉 ----------
    "encourage": [
      ["ParamAngleY", [[0, 0], [0.3, 5], [0.6, 7], [1.1, 2], [1.8, 0]]],
      ["ParamAngleZ", [[0, 0], [0.35, 3], [0.9, -2], [1.8, 0]]],
      ["ParamEyeLOpen", [[0, 1], [0.4, 1.1], [1.2, 1.04], [1.8, 1]]],
      ["ParamEyeROpen", [[0, 1], [0.4, 1.1], [1.2, 1.04], [1.8, 1]]],
      ["ParamMouthForm", [[0, 0], [0.45, 0.35], [1.3, 0.25], [1.8, 0]]],
      ["ParamMouthOpenY", [[0, 0], [0.5, 0.12], [1.2, 0.08], [1.8, 0]]],
      ["ParamBodyAngleX", [[0, 0], [0.5, -2.5], [1.2, -1], [1.8, 0]]],
    ],
    "comfortPat": [
      ["ParamAngleZ", [[0, 0], [0.4, 6], [0.9, 8], [1.5, 7], [2.2, 0]]],
      ["ParamAngleX", [[0, 0], [0.5, -3], [1.5, -4], [2.2, 0]]],
      ["ParamAngleY", [[0, 0], [0.5, -2], [1.6, -3], [2.2, 0]]],
      ["ParamEyeLOpen", [[0, 1], [0.5, 0.85], [1.6, 0.9], [2.2, 1]]],
      ["ParamEyeROpen", [[0, 1], [0.5, 0.85], [1.6, 0.9], [2.2, 1]]],
      ["ParamMouthForm", [[0, 0], [0.6, 0.2], [1.7, 0.16], [2.2, 0]]],
      ["ParamBodyAngleX", [[0, 0], [0.6, 1], [1.6, 0.6], [2.2, 0]]],
    ],
    "reassure": [
      ["ParamAngleY", [[0, 0], [0.3, 4], [0.7, 5], [1.3, 2], [1.9, 0]]],
      ["ParamEyeLOpen", [[0, 1], [0.45, 0.95], [1.4, 0.98], [1.9, 1]]],
      ["ParamEyeROpen", [[0, 1], [0.45, 0.95], [1.4, 0.98], [1.9, 1]]],
      ["ParamMouthForm", [[0, 0], [0.5, 0.25], [1.4, 0.18], [1.9, 0]]],
      ["ParamAngleZ", [[0, 0], [0.4, -2], [1.4, 0], [1.9, 0]]],
      ["ParamBodyAngleX", [[0, 0], [0.5, -1], [1.4, 0], [1.9, 0]]],
    ],
    "apologizeSoft": [
      ["ParamAngleY", [[0, 0], [0.35, -6], [0.7, -8], [1.4, -6], [2.0, 0]]],
      ["ParamEyeLOpen", [[0, 1], [0.4, 0.7], [1.4, 0.75], [2.0, 1]]],
      ["ParamEyeROpen", [[0, 1], [0.4, 0.7], [1.4, 0.75], [2.0, 1]]],
      ["ParamMouthForm", [[0, 0], [0.4, -0.3], [1.4, -0.2], [2.0, 0]]],
      ["ParamAngleZ", [[0, 0], [0.5, 3], [1.5, 2], [2.0, 0]]],
      ["ParamBodyAngleX", [[0, 0], [0.5, 1.5], [1.5, 1], [2.0, 0]]],
    ],
    "forgive": [
      ["ParamAngleY", [[0, 0], [0.3, 3], [0.62, 5], [1.2, 2], [1.8, 0]]],
      ["ParamEyeLOpen", [[0, 1], [0.4, 0.9], [1.1, 1], [1.8, 1]]],
      ["ParamEyeROpen", [[0, 1], [0.4, 0.9], [1.1, 1], [1.8, 1]]],
      ["ParamMouthForm", [[0, 0], [0.45, 0.3], [1.3, 0.22], [1.8, 0]]],
      ["ParamAngleZ", [[0, 0], [0.4, -2], [1.2, 0], [1.8, 0]]],
    ],

    // ---------- 害羞 / 撒娇 ----------
    "shyWave": [
      ["ParamAngleX", [[0, 0], [0.3, -4], [0.6, 6], [1.0, 4], [1.5, 1], [2.0, 0]]],
      ["ParamAngleZ", [[0, 0], [0.4, -6], [0.9, -9], [1.5, -7], [2.0, 0]]],
      ["ParamEyeLOpen", [[0, 1], [0.4, 0.8], [1.1, 0.9], [2.0, 1]]],
      ["ParamEyeROpen", [[0, 1], [0.4, 0.8], [1.1, 0.9], [2.0, 1]]],
      ["ParamMouthForm", [[0, 0], [0.4, 0.2], [1.4, 0.28], [2.0, 0]]],
      ["ParamEyeBallX", [[0, 0], [0.4, 0.4], [1.1, 0.3], [2.0, 0]]],
      ["ParamBodyAngleX", [[0, 0], [0.5, -1], [1.4, 0], [2.0, 0]]],
    ],
    "shyHide": [
      ["ParamAngleY", [[0, 0], [0.4, -8], [0.9, -10], [1.5, -8], [2.2, 0]]],
      ["ParamEyeLOpen", [[0, 1], [0.45, 0.4], [0.8, 0.35], [1.2, 0.5], [2.2, 1]]],
      ["ParamEyeROpen", [[0, 1], [0.45, 0.4], [0.8, 0.35], [1.2, 0.5], [2.2, 1]]],
      ["ParamMouthForm", [[0, 0], [0.45, 0.1], [1.5, 0.16], [2.2, 0]]],
      ["ParamAngleZ", [[0, 0], [0.4, 8], [0.9, 10], [1.6, 8], [2.2, 0]]],
      ["ParamBodyAngleX", [[0, 0], [0.5, 2], [1.6, 1.4], [2.2, 0]]],
    ],
    "peekUp": [
      ["ParamAngleY", [[0, 0], [0.35, -4], [0.7, 6], [1.1, 7], [1.5, 2], [1.9, 0]]],
      ["ParamEyeLOpen", [[0, 1], [0.3, 0.3], [0.6, 1], [1.2, 1.05], [1.9, 1]]],
      ["ParamEyeROpen", [[0, 1], [0.3, 0.3], [0.6, 1], [1.2, 1.05], [1.9, 1]]],
      ["ParamEyeBallY", [[0, 0], [0.4, 0.4], [1.2, 0.35], [1.9, 0]]],
      ["ParamMouthOpenY", [[0, 0], [0.6, 0.1], [1.2, 0.06], [1.9, 0]]],
    ],
    "poutSoft": [
      ["ParamMouthForm", [[0, 0], [0.3, -0.35], [0.9, -0.3], [1.7, 0]]],
      ["ParamAngleZ", [[0, 0], [0.4, 4], [0.9, 6], [1.7, 0]]],
      ["ParamAngleY", [[0, 0], [0.4, -3], [1.1, -2], [1.7, 0]]],
      ["ParamEyeLOpen", [[0, 1], [0.4, 0.9], [1.7, 1]]],
      ["ParamEyeROpen", [[0, 1], [0.4, 0.9], [1.7, 1]]],
    ],
    "sulkTurn": [
      ["ParamAngleX", [[0, 0], [0.4, -10], [0.9, -13], [1.5, -12], [2.2, 0]]],
      ["ParamAngleZ", [[0, 0], [0.4, 6], [1.2, 8], [2.2, 0]]],
      ["ParamEyeBallX", [[0, 0], [0.4, 0.5], [1.4, 0.45], [2.2, 0]]],
      ["ParamMouthForm", [[0, 0], [0.4, -0.3], [1.5, -0.24], [2.2, 0]]],
      ["ParamBodyAngleX", [[0, 0], [0.5, 2], [1.5, 1.5], [2.2, 0]]],
    ],

    // ---------- 开心 / 笑 ----------
    "cheerBounce": [
      ["ParamAngleY", [[0, 0], [0.18, 6], [0.36, 9], [0.55, -2], [0.75, 1], [1.4, 0]]],
      ["ParamBodyAngleX", [[0, 0], [0.2, -3], [0.46, 2], [0.8, -0.5], [1.4, 0]]],
      ["ParamEyeLOpen", [[0, 1], [0.3, 1.1], [1.4, 1]]],
      ["ParamEyeROpen", [[0, 1], [0.3, 1.1], [1.4, 1]]],
      ["ParamMouthOpenY", [[0, 0], [0.28, 0.25], [0.9, 0.15], [1.4, 0]]],
      ["ParamAngleZ", [[0, 0], [0.2, -3], [0.55, 2], [1.4, 0]]],
    ],
    "celebrate": [
      ["ParamAngleY", [[0, 0], [0.25, 5], [0.55, 8], [0.9, 2], [1.5, 0], [2.0, 0]]],
      ["ParamAngleZ", [[0, 0], [0.25, -5], [0.7, 5], [1.15, -3], [2.0, 0]]],
      ["ParamBodyAngleX", [[0, 0], [0.25, -4], [0.7, 3], [1.2, -1], [2.0, 0]]],
      ["ParamEyeLOpen", [[0, 1], [0.35, 1.15], [1.5, 1.05], [2.0, 1]]],
      ["ParamEyeROpen", [[0, 1], [0.35, 1.15], [1.5, 1.05], [2.0, 1]]],
      ["ParamMouthForm", [[0, 0], [0.35, 0.45], [1.5, 0.3], [2.0, 0]]],
      ["ParamMouthOpenY", [[0, 0], [0.35, 0.2], [1.5, 0.12], [2.0, 0]]],
    ],
    "laughSoft": [
      ["ParamAngleY", [[0, 0], [0.2, 4], [0.42, 7], [0.66, 5], [1.0, 2], [1.6, 0]]],
      ["ParamBodyAngleX", [[0, 0], [0.24, -2], [0.6, 1], [1.2, 0], [1.6, 0]]],
      ["ParamEyeLOpen", [[0, 1], [0.3, 0.7], [0.7, 1], [1.6, 1]]],
      ["ParamEyeROpen", [[0, 1], [0.3, 0.7], [0.7, 1], [1.6, 1]]],
      ["ParamMouthOpenY", [[0, 0], [0.3, 0.2], [0.55, 0.3], [0.9, 0.15], [1.6, 0]]],
      ["ParamMouthForm", [[0, 0], [0.4, 0.4], [1.1, 0.3], [1.6, 0]]],
    ],
    "giggleTurn": [
      ["ParamAngleX", [[0, 0], [0.24, -3], [0.55, 5], [0.9, 3], [1.4, 1], [1.8, 0]]],
      ["ParamAngleZ", [[0, 0], [0.3, -4], [0.7, -6], [1.8, 0]]],
      ["ParamEyeLOpen", [[0, 1], [0.3, 1], [0.5, 0.8], [0.75, 1], [1.8, 1]]],
      ["ParamEyeROpen", [[0, 1], [0.3, 1], [0.5, 0.8], [0.75, 1], [1.8, 1]]],
      ["ParamMouthOpenY", [[0, 0], [0.4, 0.15], [0.65, 0.25], [0.95, 0.1], [1.8, 0]]],
      ["ParamBodyAngleX", [[0, 0], [0.4, -1], [1.2, 0], [1.8, 0]]],
    ],

    // ---------- 困 / 醒 / 放松 ----------
    "yawnSoft": [
      ["ParamMouthOpenY", [[0, 0], [0.5, 0.2], [0.9, 0.35], [1.4, 0.4], [1.9, 0.1], [2.4, 0]]],
      ["ParamEyeLOpen", [[0, 1], [0.5, 0.6], [1.2, 0.3], [1.7, 0.35], [2.1, 0.6], [2.4, 1]]],
      ["ParamEyeROpen", [[0, 1], [0.5, 0.6], [1.2, 0.3], [1.7, 0.35], [2.1, 0.6], [2.4, 1]]],
      ["ParamAngleY", [[0, 0], [0.6, 2], [1.2, 6], [1.8, 5], [2.4, 0]]],
      ["ParamAngleZ", [[0, 0], [0.6, -2], [1.4, 2], [2.4, 0]]],
      ["ParamBodyAngleX", [[0, 0], [0.7, -1.5], [1.7, -1], [2.4, 0]]],
    ],
    "stretchNeck": [
      ["ParamAngleY", [[0, 0], [0.4, 8], [0.8, 12], [1.3, 10], [2.2, 0]]],
      ["ParamAngleZ", [[0, 0], [0.5, 2], [1.2, -2], [2.2, 0]]],
      ["ParamBodyAngleX", [[0, 0], [0.5, -2], [1.3, -1], [2.2, 0]]],
      ["ParamEyeLOpen", [[0, 1], [0.5, 0.9], [1.3, 0.95], [2.2, 1]]],
      ["ParamEyeROpen", [[0, 1], [0.5, 0.9], [1.3, 0.95], [2.2, 1]]],
    ],
    "settleDown": [
      ["ParamAngleY", [[0, 0], [0.4, 3], [0.9, 1], [1.4, -1], [2.0, 0]]],
      ["ParamBodyAngleX", [[0, 0], [0.5, -2], [1.3, -1], [2.0, 0]]],
      ["ParamEyeLOpen", [[0, 1], [0.5, 0.95], [1.3, 0.9], [2.0, 1]]],
      ["ParamEyeROpen", [[0, 1], [0.5, 0.95], [1.3, 0.9], [2.0, 1]]],
      ["ParamMouthForm", [[0, 0], [0.6, 0.05], [1.6, 0.08], [2.0, 0]]],
    ],
    "perkUp": [
      ["ParamAngleY", [[0, 0], [0.18, -2], [0.42, 7], [0.7, 5], [1.5, 0]]],
      ["ParamEyeLOpen", [[0, 1], [0.25, 1.15], [0.7, 1.05], [1.5, 1]]],
      ["ParamEyeROpen", [[0, 1], [0.25, 1.15], [0.7, 1.05], [1.5, 1]]],
      ["ParamBodyAngleX", [[0, 0], [0.35, -2], [0.8, -1], [1.5, 0]]],
      ["ParamMouthOpenY", [[0, 0], [0.35, 0.08], [0.9, 0.05], [1.5, 0]]],
    ],
    "relaxShoulder": [
      ["ParamAngleX", [[0, 0], [0.5, 3], [1.2, 1], [2.2, 0]]],
      ["ParamBodyAngleX", [[0, 0], [0.5, 2], [1.4, 1], [2.2, 0]]],
      ["ParamEyeLOpen", [[0, 1], [0.5, 0.95], [1.5, 0.9], [2.2, 1]]],
      ["ParamEyeROpen", [[0, 1], [0.5, 0.95], [1.5, 0.9], [2.2, 1]]],
      ["ParamMouthForm", [[0, 0], [0.6, 0.12], [1.6, 0.18], [2.2, 0]]],
      ["ParamAngleY", [[0, 0], [0.6, -1], [1.8, 0], [2.2, 0]]],
    ],
    "lookAround": [
      ["ParamAngleX", [[0, 0], [0.4, -8], [0.9, 8], [1.4, -6], [1.9, 3], [2.4, 0]]],
      ["ParamEyeBallX", [[0, 0], [0.4, -0.5], [0.9, 0.5], [1.4, -0.35], [1.9, 0.2], [2.4, 0]]],
      ["ParamAngleZ", [[0, 0], [0.5, -2], [1.2, 2], [2.4, 0]]],
      ["ParamEyeLOpen", [[0, 1], [0.5, 0.95], [1.5, 0.95], [2.4, 1]]],
      ["ParamEyeROpen", [[0, 1], [0.5, 0.95], [1.5, 0.95], [2.4, 1]]],
    ],
    "glanceUp": [
      ["ParamAngleY", [[0, 0], [0.28, 7], [0.6, 10], [1.1, 9], [1.6, 0]]],
      ["ParamEyeBallY", [[0, 0], [0.3, 0.45], [1.1, 0.4], [1.6, 0]]],
      ["ParamEyeLOpen", [[0, 1], [0.4, 1.05], [1.6, 1]]],
      ["ParamEyeROpen", [[0, 1], [0.4, 1.05], [1.6, 1]]],
      ["ParamMouthOpenY", [[0, 0], [0.4, 0.08], [1.6, 0]]],
    ],
    "glanceDown": [
      ["ParamAngleY", [[0, 0], [0.3, -5], [0.7, -8], [1.2, -7], [1.6, 0]]],
      ["ParamEyeBallY", [[0, 0], [0.3, -0.4], [1.2, -0.35], [1.6, 0]]],
      ["ParamEyeLOpen", [[0, 1], [0.4, 0.85], [1.6, 1]]],
      ["ParamEyeROpen", [[0, 1], [0.4, 0.85], [1.6, 1]]],
      ["ParamMouthForm", [[0, 0], [0.4, -0.1], [1.6, 0]]],
    ],
    "leanCurious": [
      ["ParamBodyAngleX", [[0, 0], [0.4, -3], [0.9, -4], [1.5, -3], [2.0, 0]]],
      ["ParamAngleX", [[0, 0], [0.4, 4], [1.0, 6], [2.0, 0]]],
      ["ParamAngleZ", [[0, 0], [0.45, -6], [1.2, -8], [2.0, 0]]],
      ["ParamEyeLOpen", [[0, 1], [0.4, 1.08], [1.5, 1.04], [2.0, 1]]],
      ["ParamEyeROpen", [[0, 1], [0.4, 1.08], [1.5, 1.04], [2.0, 1]]],
      ["ParamEyeBallX", [[0, 0], [0.5, 0.15], [1.5, 0.1], [2.0, 0]]],
    ],
    "leanBackSoft": [
      ["ParamBodyAngleX", [[0, 0], [0.35, 3], [0.8, 4], [1.3, 2], [1.8, 0]]],
      ["ParamAngleY", [[0, 0], [0.35, 4], [0.9, 6], [1.8, 0]]],
      ["ParamAngleZ", [[0, 0], [0.4, 2], [1.2, 0], [1.8, 0]]],
      ["ParamEyeLOpen", [[0, 1], [0.5, 0.95], [1.8, 1]]],
      ["ParamEyeROpen", [[0, 1], [0.5, 0.95], [1.8, 1]]],
      ["ParamMouthForm", [[0, 0], [0.5, 0.08], [1.8, 0]]],
    ],
    "swayGentle": [
      ["ParamBodyAngleX", [[0, 0], [0.7, -2], [1.4, 2], [2.1, -1], [2.6, 0]]],
      ["ParamAngleZ", [[0, 0], [0.6, -2], [1.3, 2], [2.0, 1], [2.6, 0]]],
      ["ParamAngleX", [[0, 0], [0.8, 1], [1.8, -1], [2.6, 0]]],
      ["ParamEyeLOpen", [[0, 1], [1.2, 0.98], [2.6, 1]]],
      ["ParamEyeROpen", [[0, 1], [1.2, 0.98], [2.6, 1]]],
    ],
    "breatheDeep": [
      ["ParamAngleY", [[0, 0], [0.8, 1], [1.5, 3], [2.2, 2], [3.0, 0]]],
      ["ParamBodyAngleX", [[0, 0], [0.8, -1], [1.6, 1], [3.0, 0]]],
      ["ParamEyeLOpen", [[0, 1], [1.2, 0.9], [2.2, 0.95], [3.0, 1]]],
      ["ParamEyeROpen", [[0, 1], [1.2, 0.9], [2.2, 0.95], [3.0, 1]]],
      ["ParamMouthOpenY", [[0, 0], [1.4, 0.04], [2.3, 0.06], [3.0, 0]]],
    ],
    "blinkTwice": [
      ["ParamEyeLOpen", [[0, 1], [0.22, 0.15], [0.4, 1], [0.58, 0.2], [0.76, 1], [1.2, 1]]],
      ["ParamEyeROpen", [[0, 1], [0.22, 0.15], [0.4, 1], [0.58, 0.2], [0.76, 1], [1.2, 1]]],
      ["ParamAngleZ", [[0, 0], [0.3, -0.8], [0.8, 0.4], [1.2, 0]]],
    ],
    "sleepyTilt": [
      ["ParamAngleZ", [[0, 0], [0.5, 6], [1.1, 9], [1.7, 8], [2.4, 0]]],
      ["ParamAngleY", [[0, 0], [0.5, -3], [1.4, -5], [2.4, 0]]],
      ["ParamEyeLOpen", [[0, 1], [0.5, 0.6], [1.4, 0.55], [2.0, 0.7], [2.4, 1]]],
      ["ParamEyeROpen", [[0, 1], [0.5, 0.6], [1.4, 0.55], [2.0, 0.7], [2.4, 1]]],
      ["ParamMouthForm", [[0, 0], [0.6, -0.05], [1.7, 0.02], [2.4, 0]]],
    ],
    "wakeStretch": [
      ["ParamAngleY", [[0, 0], [0.35, 5], [0.7, 9], [1.2, 8], [2.2, 0]]],
      ["ParamAngleZ", [[0, 0], [0.4, -3], [1.0, 3], [2.2, 0]]],
      ["ParamBodyAngleX", [[0, 0], [0.4, -2], [1.0, 2], [2.2, 0]]],
      ["ParamEyeLOpen", [[0, 1], [0.3, 0.5], [0.7, 1], [1.3, 1.05], [2.2, 1]]],
      ["ParamEyeROpen", [[0, 1], [0.3, 0.5], [0.7, 1], [1.3, 1.05], [2.2, 1]]],
      ["ParamMouthOpenY", [[0, 0], [0.5, 0.1], [1.1, 0.2], [2.2, 0]]],
    ],
    "focusNarrow": [
      ["ParamEyeLOpen", [[0, 1], [0.4, 0.8], [1.0, 0.75], [1.5, 0.8], [1.8, 1]]],
      ["ParamEyeROpen", [[0, 1], [0.4, 0.8], [1.0, 0.75], [1.5, 0.8], [1.8, 1]]],
      ["ParamAngleY", [[0, 0], [0.4, 2], [1.0, 3], [1.8, 0]]],
      ["ParamMouthForm", [[0, 0], [0.5, -0.08], [1.5, -0.05], [1.8, 0]]],
    ],
    "dazeSoft": [
      ["ParamAngleZ", [[0, 0], [0.8, -3], [1.6, -4], [2.6, 0]]],
      ["ParamAngleY", [[0, 0], [0.8, 2], [1.8, 1], [2.6, 0]]],
      ["ParamEyeLOpen", [[0, 1], [0.8, 0.7], [1.8, 0.65], [2.3, 0.75], [2.6, 1]]],
      ["ParamEyeROpen", [[0, 1], [0.8, 0.7], [1.8, 0.65], [2.3, 0.75], [2.6, 1]]],
      ["ParamEyeBallY", [[0, 0], [0.8, 0.15], [2.0, 0.1], [2.6, 0]]],
      ["ParamMouthForm", [[0, 0], [0.9, 0.02], [2.0, 0.04], [2.6, 0]]],
    ],
    "nodSlow": [
      ["ParamAngleY", [[0, 0], [0.45, 6], [0.9, 8], [1.3, 2], [1.8, 0]]],
      ["ParamEyeLOpen", [[0, 1], [0.5, 0.95], [1.0, 0.9], [1.8, 1]]],
      ["ParamEyeROpen", [[0, 1], [0.5, 0.95], [1.0, 0.9], [1.8, 1]]],
      ["ParamBodyAngleX", [[0, 0], [0.6, -0.8], [1.3, 0.2], [1.8, 0]]],
      ["ParamMouthForm", [[0, 0], [0.6, 0.15], [1.8, 0]]],
    ],
    "shakeSoft": [
      ["ParamAngleX", [[0, 0], [0.28, -5], [0.62, 5], [0.95, -3], [1.2, 1], [1.6, 0]]],
      ["ParamAngleZ", [[0, 0], [0.28, 1], [0.7, -1], [1.6, 0]]],
      ["ParamMouthForm", [[0, 0], [0.4, -0.15], [1.6, 0]]],
      ["ParamEyeLOpen", [[0, 1], [0.5, 0.92], [1.6, 1]]],
      ["ParamEyeROpen", [[0, 1], [0.5, 0.92], [1.6, 1]]],
    ],
    "tiltHold": [
      ["ParamAngleZ", [[0, 0], [0.5, -8], [1.0, -11], [1.7, -10], [2.4, 0]]],
      ["ParamAngleX", [[0, 0], [0.5, 3], [1.7, 4], [2.4, 0]]],
      ["ParamEyeLOpen", [[0, 1], [0.5, 1.05], [1.8, 1.02], [2.4, 1]]],
      ["ParamEyeROpen", [[0, 1], [0.5, 1.05], [1.8, 1.02], [2.4, 1]]],
      ["ParamEyeBallX", [[0, 0], [0.6, 0.1], [1.8, 0.08], [2.4, 0]]],
      ["ParamMouthOpenY", [[0, 0], [0.6, 0.08], [1.8, 0.05], [2.4, 0]]],
    ],
    "lookSideSoft": [
      ["ParamAngleX", [[0, 0], [0.45, -6], [1.0, -8], [1.6, -7], [2.2, 0]]],
      ["ParamEyeBallX", [[0, 0], [0.5, 0.35], [1.6, 0.3], [2.2, 0]]],
      ["ParamAngleZ", [[0, 0], [0.6, 2], [1.6, 0], [2.2, 0]]],
      ["ParamEyeLOpen", [[0, 1], [0.5, 0.92], [2.2, 1]]],
      ["ParamEyeROpen", [[0, 1], [0.5, 0.92], [2.2, 1]]],
      ["ParamMouthForm", [[0, 0], [0.6, 0.05], [2.2, 0]]],
    ],
    "peekDown": [
      ["ParamAngleY", [[0, 0], [0.35, -5], [0.8, -7], [1.3, -4], [1.8, 0]]],
      ["ParamEyeBallY", [[0, 0], [0.4, -0.3], [1.3, -0.26], [1.8, 0]]],
      ["ParamEyeLOpen", [[0, 1], [0.4, 0.8], [1.3, 0.85], [1.8, 1]]],
      ["ParamEyeROpen", [[0, 1], [0.4, 0.8], [1.3, 0.85], [1.8, 1]]],
      ["ParamMouthForm", [[0, 0], [0.5, 0.1], [1.8, 0]]],
    ],
  };

  for (const k of Object.keys(extra)) {
    if (!M[k]) M[k] = extra[k];
  }

  const add = (scene, names) => {
    const cur = Array.isArray(S[scene]) ? S[scene] : (S[scene] = []);
    for (const n of names) if (!cur.includes(n)) cur.push(n);
  };

  add("idle", ["swayGentle", "breatheDeep", "blinkTwice", "dazeSoft", "glanceUp", "glanceDown", "tiltHold", "lookSideSoft"]);
  add("idleSoft", ["breatheDeep", "blinkTwice", "swayGentle", "dazeSoft", "lookSideSoft"]);
  add("petHead", ["greetNod", "greetTilt", "tiltHold", "peekUp", "shyHide"]);
  add("petFace", ["shyWave", "giggleTurn", "laughSoft", "peekUp", "reassure"]);
  add("petBody", ["poutSoft", "sulkTurn", "settleDown", "perkUp", "shakeSoft"]);
  add("more", ["cheerBounce", "celebrate", "laughSoft", "shyHide", "lookAround"]);
  add("dshThinking", ["thinkingHum", "thinkingAha", "remember", "focusNarrow", "confusedBlink"]);
  add("dshDone", ["nodSlow", "realize", "agreeSoft", "cheerBounce"]);
  add("wake", ["wakeStretch", "stretchNeck", "perkUp", "blinkTwice"]);
  add("sleep", ["sleepyTilt", "breatheDeep", "settleDown", "yawnSoft"]);
  add("actStart", ["greetNod", "listeningTilt", "perkUp", "peekUp"]);
  add("actDone", ["nodSlow", "agreeSoft", "cheerBounce", "relaxShoulder"]);
  add("feed", ["agreeSoft", "cheerBounce"]);

  // 新场景：给过渡和情绪余韵留一套更细的入口，场景名由调用方决定。
  S.greet = ["greetNod", "greetTilt", "welcome", "peekUp"];
  S.farewell = ["farewell", "nodSlow", "glanceDown"];
  S.listenSoft = ["listeningTilt", "listeningNod", "nodSlow", "tiltHold"];
  S.thinkSoft = ["thinkingHum", "thinkingAha", "remember", "focusNarrow", "confusedBlink"];
  S.comfort = ["comfortPat", "reassure", "encourage", "forgive"];
  S.apologize = ["apologizeSoft", "shyHide", "glanceDown", "nodSlow"];
  S.celebrateSoft = ["cheerBounce", "celebrate", "laughSoft", "giggleTurn"];
  S.shySoft = ["shyWave", "shyHide", "peekUp", "poutSoft"];
  S.sleepySoft = ["sleepyTilt", "yawnSoft", "blinkTwice", "settleDown"];
  S.curiousSoft = ["leanCurious", "tiltHold", "lookAround", "peekUp"];
  S.relax = ["relaxShoulder", "breatheDeep", "settleDown", "dazeSoft"];
  S.agree = ["agreeSoft", "nodSlow", "realize"];
  S.disagree = ["disagreeSoft", "shakeSoft", "maybeTilt", "sulkTurn"];

  // 主人不喜欢「大小眼」：tease 整个下架；peek / peekR / confused 保留动作，
  // 但把左右眼开合改成同步（取更收的那只），表情还在，只是不再一高一低。
  delete M.tease;
  for (const sc of Object.keys(S)) {
    if (Array.isArray(S[sc])) S[sc] = S[sc].filter((n) => n !== "tease");
  }
  const syncEyes = (name) => {
    const c = M[name];
    if (!Array.isArray(c)) return;
    const l = c.find((cv) => cv[0] === "ParamEyeLOpen");
    const r = c.find((cv) => cv[0] === "ParamEyeROpen");
    if (!l || !r || !Array.isArray(l[1]) || !Array.isArray(r[1])) return;
    const rm = new Map(r[1].map(([t, v]) => [t, v]));
    const pts = l[1].map(([t, v]) => [t, Math.min(v, rm.has(t) ? rm.get(t) : v)]);
    l[1] = pts.map((p) => [p[0], p[1]]);
    r[1] = pts.map((p) => [p[0], p[1]]);
  };
  ["peek", "peekR", "confused"].forEach(syncEyes);
})();
