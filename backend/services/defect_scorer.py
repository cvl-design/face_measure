"""
几何规则引擎 — Phase 2
接收 478 个 MediaPipe 关键点，计算美学指标并输出初步缺陷列表。
纯计算模块，无 IO，无 ORM 依赖。

MediaPipe 478-point FaceMesh 关键点索引（Face Landmarker Task）:
  鼻尖:             1
  鼻根（眉间）:      6
  发际近似点:        9
  下颌底:           152
  左眉内角:         55    右眉内角:      285
  左眉峰:           105   右眉峰:        334
  左眼内角:         133   右眼内角:      362
  左眼外角:         33    右眼外角:      263
  左眼上眼睑中:     159   右眼上眼睑中:  386
  左眼下眼睑中:     145   右眼下眼睑中:  374
  左颧骨高点:       116   右颧骨高点:    345
  左面颊外缘:       234   右面颊外缘:    454
  嘴角左:           61    嘴角右:        291
  上唇中:           0     下唇中:        17
  鼻底左:           2     鼻底右:        94
"""
from __future__ import annotations

import uuid
import math
from typing import Any


# ── 关键点索引常量 ────────────────────────────────────────────────

# 纵轴参考
IDX_HAIRLINE      = 9    # 发际近似（用于三庭上边界）
IDX_NOSE_TIP      = 1
IDX_NOSE_ROOT     = 6
IDX_NOSE_BOTTOM   = 2    # 鼻底（三庭中/下分界）
IDX_CHIN          = 152  # 下颌底

# 眉毛
IDX_L_BROW_INNER  = 55
IDX_R_BROW_INNER  = 285
IDX_L_BROW_PEAK   = 105
IDX_R_BROW_PEAK   = 334

# 眼睛
IDX_L_EYE_INNER   = 133   # 左眼内角（靠鼻侧）
IDX_L_EYE_OUTER   = 33    # 左眼外角
IDX_R_EYE_INNER   = 362   # 右眼内角
IDX_R_EYE_OUTER   = 263   # 右眼外角
IDX_L_EYE_TOP     = 159
IDX_L_EYE_BOT     = 145
IDX_R_EYE_TOP     = 386
IDX_R_EYE_BOT     = 374

# 颧骨 / 面颊
IDX_L_MALAR       = 116
IDX_R_MALAR       = 345
IDX_L_CHEEK       = 234   # 面颊外缘（最宽处）
IDX_R_CHEEK       = 454

# 嘴唇
IDX_MOUTH_L       = 61
IDX_MOUTH_R       = 291
IDX_UPPER_LIP     = 0
IDX_LOWER_LIP     = 17


# ── 辅助函数 ─────────────────────────────────────────────────────

def _pt(lm: list[dict], idx: int) -> tuple[float, float]:
    """取第 idx 个关键点的 (x, y) 归一化坐标。"""
    p = lm[idx]
    return float(p["x"]), float(p["y"])


def _dist(a: tuple[float, float], b: tuple[float, float]) -> float:
    return math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2)


def _clamp(v: float, lo: float = 0.0, hi: float = 100.0) -> float:
    return max(lo, min(hi, v))


# ── 三庭分析 ─────────────────────────────────────────────────────

def _calc_three_sections(lm: list[dict]) -> dict[str, Any]:
    """
    三庭：
      上庭 = 发际线(9) → 眉间中点
      中庭 = 眉间中点  → 鼻底(2)
      下庭 = 鼻底(2)  → 下颌底(152)
    理想：1:1:1
    """
    hairline_y  = _pt(lm, IDX_HAIRLINE)[1]
    brow_mid_y  = (_pt(lm, IDX_L_BROW_INNER)[1] + _pt(lm, IDX_R_BROW_INNER)[1]) / 2
    nose_bot_y  = _pt(lm, IDX_NOSE_BOTTOM)[1]
    chin_y      = _pt(lm, IDX_CHIN)[1]

    upper  = abs(brow_mid_y  - hairline_y)
    middle = abs(nose_bot_y  - brow_mid_y)
    lower  = abs(chin_y      - nose_bot_y)
    total  = upper + middle + lower

    if total < 1e-6:
        total = 1.0

    u_r = upper  / total
    m_r = middle / total
    l_r = lower  / total

    # 偏差越小分越高（每偏离 1/3 扣分，最多 200*0.333 ≈ 66分）
    deviation = abs(u_r - 1/3) + abs(m_r - 1/3) + abs(l_r - 1/3)
    score = _clamp(100.0 - 200.0 * deviation)

    if score >= 80:
        advice = "三庭比例协调，面部纵向分布均衡"
    elif score >= 60:
        advice = "三庭比例略有偏差，可通过微调改善"
    else:
        advice = "三庭比例失调较明显，建议重点改善"

    return {
        "upper":  round(upper,  4),
        "middle": round(middle, 4),
        "lower":  round(lower,  4),
        "ratios": {
            "upper":  round(u_r, 4),
            "middle": round(m_r, 4),
            "lower":  round(l_r, 4),
        },
        "score":  round(score, 1),
        "advice": advice,
        # 用于缺陷评估
        "_lower_ratio": l_r,
    }


# ── 五眼分析 ─────────────────────────────────────────────────────

def _calc_five_eyes(lm: list[dict]) -> dict[str, Any]:
    """
    五眼：面宽（颊外缘） / 单眼宽 ≈ 5
    左眼宽 = 左眼外角(33) → 左眼内角(133)
    """
    l_outer = _pt(lm, IDX_L_EYE_OUTER)
    l_inner = _pt(lm, IDX_L_EYE_INNER)
    l_cheek = _pt(lm, IDX_L_CHEEK)
    r_cheek = _pt(lm, IDX_R_CHEEK)

    eye_width  = abs(l_inner[0] - l_outer[0])
    face_width = abs(r_cheek[0] - l_cheek[0])

    if eye_width < 1e-6:
        ratio = 5.0
    else:
        ratio = face_width / eye_width

    score = _clamp(100.0 - 40.0 * abs(ratio - 5.0))

    if score >= 80:
        advice = "五眼宽度比例良好"
    elif score >= 60:
        advice = "五眼比例略偏，可考虑适当调整"
    else:
        advice = "五眼比例偏差较大，面宽或眼宽需关注"

    return {
        "eye_width":  round(eye_width,  4),
        "face_width": round(face_width, 4),
        "ratio":      round(ratio, 3),
        "score":      round(score, 1),
        "advice":     advice,
    }


# ── 面型分类 ─────────────────────────────────────────────────────

def _calc_face_shape(lm: list[dict]) -> dict[str, Any]:
    """
    面宽/面高 宽高比分类：
      < 0.75  → 长形
      0.75–0.85 → 鹅蛋形
      0.85–0.95 → 瓜子形
      0.95–1.05 → 心形
      ≥ 1.05  → 方形
    """
    l_cheek = _pt(lm, IDX_L_CHEEK)
    r_cheek = _pt(lm, IDX_R_CHEEK)
    hairline_y = _pt(lm, IDX_HAIRLINE)[1]
    chin_y     = _pt(lm, IDX_CHIN)[1]

    face_w = abs(r_cheek[0] - l_cheek[0])
    face_h = abs(chin_y - hairline_y)

    if face_h < 1e-6:
        ratio = 0.88
    else:
        ratio = face_w / face_h

    if ratio < 0.75:
        classification = "长形"
    elif ratio < 0.85:
        classification = "鹅蛋形"
    elif ratio < 0.95:
        classification = "瓜子形"
    elif ratio < 1.05:
        classification = "心形"
    else:
        classification = "方形"

    # 以 0.88（鹅蛋/瓜子交界）为理想中心，±0.10 内满分
    excess = max(0.0, abs(ratio - 0.88) - 0.10)
    score = _clamp(100.0 - 100.0 * excess / 0.20)

    return {
        "classification":    classification,
        "width_height_ratio": round(ratio, 3),
        "score":             round(score, 1),
    }


# ── 对称性分析 ───────────────────────────────────────────────────

def _calc_symmetry(lm: list[dict]) -> dict[str, Any]:
    """
    用成对关键点的 x 坐标偏差评估对称性。
    理想：x_left + x_right == 1.0（归一化时面部中轴 = 0.5）
    """
    pairs = [
        (IDX_L_BROW_INNER, IDX_R_BROW_INNER, "眉内角"),
        (IDX_L_BROW_PEAK,  IDX_R_BROW_PEAK,  "眉峰"),
        (IDX_L_EYE_OUTER,  IDX_R_EYE_OUTER,  "眼外角"),
        (IDX_L_EYE_INNER,  IDX_R_BROW_INNER, "眼内角"),
        (IDX_L_MALAR,      IDX_R_MALAR,      "颧骨高点"),
        (IDX_L_CHEEK,      IDX_R_CHEEK,      "面颊外缘"),
        (IDX_MOUTH_L,      IDX_MOUTH_R,      "嘴角"),
    ]

    deviations: list[float] = []
    asymmetric_features: list[str] = []

    for l_idx, r_idx, name in pairs:
        lx = _pt(lm, l_idx)[0]
        rx = _pt(lm, r_idx)[0]
        dev = abs(lx + rx - 1.0)
        deviations.append(dev)
        if dev > 0.03:
            asymmetric_features.append(name)

    mean_dev = sum(deviations) / len(deviations) if deviations else 0.0
    score = _clamp(100.0 - 200.0 * mean_dev)

    return {
        "score":               round(score, 1),
        "mean_deviation":      round(mean_dev, 4),
        "asymmetric_features": asymmetric_features,
    }


# ── 苹果肌（颧骨高点）分析 ────────────────────────────────────────

def _calc_malar(lm: list[dict]) -> dict[str, Any]:
    """
    苹果肌丰满度：颧骨宽 / 面宽，理想 0.60–0.65
    """
    l_malar = _pt(lm, IDX_L_MALAR)
    r_malar = _pt(lm, IDX_R_MALAR)
    l_cheek = _pt(lm, IDX_L_CHEEK)
    r_cheek = _pt(lm, IDX_R_CHEEK)

    malar_w = abs(r_malar[0] - l_malar[0])
    face_w  = abs(r_cheek[0] - l_cheek[0])

    if face_w < 1e-6:
        malar_ratio = 0.62
    else:
        malar_ratio = malar_w / face_w

    # 理想中心 0.625，±0.025 内满分
    excess = max(0.0, abs(malar_ratio - 0.625) - 0.025)
    score  = _clamp(100.0 - 200.0 * excess)

    if malar_ratio < 0.58:
        advice = "苹果肌较扁平，建议玻尿酸填充改善轮廓"
    elif malar_ratio > 0.68:
        advice = "颧骨略宽，可考虑轮廓微调"
    else:
        advice = "苹果肌丰满度良好"

    return {
        "malar_width": round(malar_w,     4),
        "face_width":  round(face_w,      4),
        "ratio":       round(malar_ratio, 4),
        "score":       round(score, 1),
        "advice":      advice,
    }


# ── 眉弓分析 ─────────────────────────────────────────────────────

def _calc_brow_arch(lm: list[dict]) -> dict[str, Any]:
    """
    眉弓：眉峰相对眉内角的高度差 / 面高 → 理想 0.03–0.05
    Q点偏移描述眉弓弧线，正值表示眉峰高于眉内角（理想）。
    """
    l_inner = _pt(lm, IDX_L_BROW_INNER)
    r_inner = _pt(lm, IDX_R_BROW_INNER)
    l_peak  = _pt(lm, IDX_L_BROW_PEAK)
    r_peak  = _pt(lm, IDX_R_BROW_PEAK)
    hairline_y = _pt(lm, IDX_HAIRLINE)[1]
    chin_y     = _pt(lm, IDX_CHIN)[1]

    face_h = abs(chin_y - hairline_y) or 1.0

    # 眉峰高于眉内角为正（y 轴向下，peak_y < inner_y → 正弓）
    l_arch = (l_inner[1] - l_peak[1]) / face_h
    r_arch = (r_inner[1] - r_peak[1]) / face_h
    mean_arch = (l_arch + r_arch) / 2

    # 理想 0.03–0.05
    ideal_mid = 0.04
    excess = max(0.0, abs(mean_arch - ideal_mid) - 0.01)
    score  = _clamp(100.0 - 200.0 * excess / 0.03)

    return {
        "left_q_point":  round(l_arch,    4),
        "right_q_point": round(r_arch,    4),
        "mean_arch":     round(mean_arch, 4),
        "score":         round(score, 1),
    }


# ── 高光点 ──────────────────────────────────────────────────────

def _calc_highlight_points(lm: list[dict]) -> dict[str, Any]:
    """记录关键美学高光坐标（Phase 3 VLM / 可视化用）。"""
    l_malar = _pt(lm, IDX_L_MALAR)
    r_malar = _pt(lm, IDX_R_MALAR)
    l_brow  = _pt(lm, IDX_L_BROW_PEAK)
    r_brow  = _pt(lm, IDX_R_BROW_PEAK)
    nose_tip= _pt(lm, IDX_NOSE_TIP)
    return {
        "malar_left":  {"x": round(l_malar[0], 4), "y": round(l_malar[1], 4)},
        "malar_right": {"x": round(r_malar[0], 4), "y": round(r_malar[1], 4)},
        "brow_left":   {"x": round(l_brow[0],  4), "y": round(l_brow[1],  4)},
        "brow_right":  {"x": round(r_brow[0],  4), "y": round(r_brow[1],  4)},
        "nose_tip":    {"x": round(nose_tip[0], 4), "y": round(nose_tip[1], 4)},
    }


# ── 缺陷评分 ─────────────────────────────────────────────────────

def _build_defects(
    three_s: dict,
    five_e:  dict,
    symmetry: dict,
    malar:   dict,
) -> list[dict]:
    defects: list[dict] = []

    def _sev(base: float, delta: float, step: float) -> int:
        return min(5, max(1, int(1 + (base - delta) / step)))

    # 三庭失调
    ts = three_s["score"]
    if ts < 70:
        defects.append({
            "defect_id":   str(uuid.uuid4()),
            "name_zh":     "三庭比例失调",
            "category":    "contour",
            "severity":    _sev(70, ts, 15),
            "confidence":  0.85,
            "landmark_refs": [9, 55, 285, 2, 152],
            "clinical_description": f"面部纵向三庭比例得分 {ts:.0f}/100，理想值 ≥70",
            "treatment_suggestion": "下庭过长可考虑肉毒素咬肌/颏部调整；上庭短可通过发型弥补",
            "anatomical_regions": ["前额", "鼻区", "下颌"],
        })

    # 下庭松弛初评（下庭占比 > 38%）
    if three_s.get("_lower_ratio", 0) > 0.38:
        defects.append({
            "defect_id":   str(uuid.uuid4()),
            "name_zh":     "下颌缘松弛（初步）",
            "category":    "ptosis",
            "severity":    1,
            "confidence":  0.70,
            "landmark_refs": [152, 234, 454],
            "clinical_description": "下庭比例偏大，可能存在面颊或颈部松弛",
            "treatment_suggestion": "建议医生评估下颌提升方案（线雕 / 热玛吉）",
            "anatomical_regions": ["下颌", "面颊"],
        })

    # 五眼欠佳
    fe = five_e["score"]
    if fe < 70:
        defects.append({
            "defect_id":   str(uuid.uuid4()),
            "name_zh":     "五眼宽度比例欠佳",
            "category":    "contour",
            "severity":    _sev(70, fe, 15),
            "confidence":  0.80,
            "landmark_refs": [33, 133, 234, 362, 454],
            "clinical_description": f"五眼比例得分 {fe:.0f}/100（实际面宽/眼宽 = {five_e['ratio']:.2f}，理想 5.0）",
            "treatment_suggestion": "若眼宽偏小，可考虑双眼皮/开眼角；若面宽过宽，可考虑颧骨修整",
            "anatomical_regions": ["眼部", "面颊"],
        })

    # 面部不对称
    sym = symmetry["score"]
    if sym < 75:
        defects.append({
            "defect_id":   str(uuid.uuid4()),
            "name_zh":     "面部不对称",
            "category":    "contour",
            "severity":    _sev(75, sym, 12),
            "confidence":  0.80,
            "landmark_refs": [105, 334, 116, 345, 55, 285],
            "clinical_description": (
                f"对称性得分 {sym:.0f}/100；"
                f"不对称区域：{', '.join(symmetry['asymmetric_features']) or '无'}"
            ),
            "treatment_suggestion": "轻度不对称属正常；严重者可通过注射填充或手术调整",
            "anatomical_regions": symmetry["asymmetric_features"] or ["面部整体"],
        })

    # 苹果肌不足
    if malar["ratio"] < 0.58:
        defects.append({
            "defect_id":   str(uuid.uuid4()),
            "name_zh":     "苹果肌不足",
            "category":    "volume_loss",
            "severity":    2,
            "confidence":  0.75,
            "landmark_refs": [116, 345],
            "clinical_description": f"苹果肌区宽高比 {malar['ratio']:.3f}（理想 0.60–0.65）",
            "treatment_suggestion": "玻尿酸苹果肌填充，建议 0.5–1.0mL 每侧",
            "anatomical_regions": ["苹果肌", "颧骨区"],
        })

    return defects


# ── 主入口 ───────────────────────────────────────────────────────

def score_from_landmarks(
    landmarks: list[dict],
    gender: str = "female",
    age_group: str = "30-39",
) -> tuple[dict[str, Any], list[dict]]:
    """
    对 478 关键点运行几何规则引擎。

    Args:
        landmarks:  list[{x, y, z}]，长度应为 478
        gender:     'male' | 'female'（当前版本评分与性别无关，留扩展）
        age_group:  '20-29' | '30-39' | ...（留扩展）

    Returns:
        (aesthetic_metrics_dict, defects_list)
        aesthetic_metrics_dict 匹配 schemas.AestheticMetricsResult 结构
    """
    three_s  = _calc_three_sections(landmarks)
    five_e   = _calc_five_eyes(landmarks)
    face_sh  = _calc_face_shape(landmarks)
    symmetry = _calc_symmetry(landmarks)
    malar    = _calc_malar(landmarks)
    brow     = _calc_brow_arch(landmarks)
    hilight  = _calc_highlight_points(landmarks)

    composite_score = int(_clamp(
        0.30 * three_s["score"]
        + 0.25 * five_e["score"]
        + 0.20 * symmetry["score"]
        + 0.15 * face_sh["score"]
        + 0.10 * malar["score"]
    ))

    # 清理仅内部用的下划线字段
    three_s_clean = {k: v for k, v in three_s.items() if not k.startswith("_")}

    aesthetic_metrics: dict[str, Any] = {
        "three_sections":    three_s_clean,
        "five_eyes":         five_e,
        "face_shape":        face_sh,
        "malar_prominence":  malar,
        "brow_arch":         brow,
        "highlight_points":  hilight,
        "symmetry":          symmetry,
        "composite_score":   composite_score,
    }

    defects = _build_defects(three_s, five_e, symmetry, malar)
    return aesthetic_metrics, defects
