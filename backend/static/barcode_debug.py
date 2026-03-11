#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
条码解码调试器 — 千问AI辅助 + 并行暴力搜索最佳配置
===================================================
功能:
  1. 千问VL分析图片：识别码的类型、位置、角度、遮挡情况
  2. 并行测试所有 预处理×区域×缩放×旋转 组合 (200+种)
  3. 输出: 最佳配置(2码率最高) + 最快配置(速度优先)
  4. 生成优化建议

用法:
  python barcode_debug.py debug_frames/              # 测试目录下所有图片
  python barcode_debug.py some_image.png             # 测试单张图片
  python barcode_debug.py debug_frames/ --no-ai      # 跳过AI分析
"""

import os, sys, time, json, glob, base64, traceback
from concurrent.futures import ThreadPoolExecutor, as_completed
from collections import defaultdict

import cv2
import numpy as np


def imread_safe(path, flags=cv2.IMREAD_GRAYSCALE):
    """cv2.imread 不支持中文路径，用 np.fromfile + imdecode 绕过"""
    try:
        data = np.fromfile(path, dtype=np.uint8)
        return cv2.imdecode(data, flags)
    except Exception:
        return None

ZXING_OK = PYZBAR_OK = False
try:
    import zxingcpp; ZXING_OK = True
except Exception:
    try:
        from pyzbar.pyzbar import decode as pyzbar_decode; PYZBAR_OK = True
    except Exception: pass

import requests

# ── 千问配置 ──
QWEN_API_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions"
QWEN_API_KEY = "sk-b121d7a1020f4c4e9740ec130f359333"
QWEN_VL_MODEL = "qwen-vl-max"
QWEN_TEXT_MODEL = "qwen-turbo"


# ════════════════════════════════════════════════════════════
# 千问AI视觉分析
# ════════════════════════════════════════════════════════════
def ai_analyze_image(image_path):
    """用千问VL分析图片中的条码特征"""
    print("\n🤖 正在调用千问VL分析图片...")

    with open(image_path, 'rb') as f:
        b64 = base64.b64encode(f.read()).decode()

    ext = os.path.splitext(image_path)[1].lower()
    mime = {'png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.bmp':'image/bmp'}.get(ext, 'image/png')

    prompt = """请仔细分析这张工业扫码图片，回答以下问题：

1. 图片中有几个条码/二维码？分别是什么类型（QR码、Code128、Code39、EAN等）？
2. 每个码在图片中的大致位置（左上/右上/左下/右下/中间）？
3. 每个码的大致倾斜角度（水平=0°，顺时针为正）？
4. 有没有码被部分遮挡、模糊、或有签字覆盖？
5. 图片整体亮度如何？对比度如何？
6. 你建议用什么图像预处理策略来提高识别率？

请用JSON格式回答，格式如下：
{
  "code_count": 2,
  "codes": [
    {"type": "QR", "position": "左上", "angle": -15, "size": "大", "quality": "清晰"},
    {"type": "Code128", "position": "右上", "angle": -15, "size": "小", "quality": "有签字遮挡"}
  ],
  "brightness": "适中",
  "contrast": "良好",
  "suggestions": ["建议先做CLAHE增强对比度", "条码区域建议放大2倍", "建议旋转15度校正"]
}"""

    try:
        resp = requests.post(QWEN_API_URL, headers={
            "Authorization": f"Bearer {QWEN_API_KEY}", "Content-Type": "application/json"
        }, json={
            "model": QWEN_VL_MODEL,
            "messages": [{"role": "user", "content": [
                {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{b64}"}},
                {"type": "text", "text": prompt}
            ]}],
            "max_tokens": 2048, "temperature": 0.1
        }, timeout=60)

        data = resp.json()
        answer = data["choices"][0]["message"]["content"]
        print(f"\n📋 千问VL分析结果:\n{answer}\n")
        return answer
    except Exception as e:
        print(f"⚠ AI分析失败: {e}")
        return None


def ai_generate_report(results_summary, ai_analysis=None):
    """用千问文本模型生成最终优化建议"""
    print("\n🤖 正在生成AI优化报告...")

    prompt = f"""你是一个工业条码识别专家。根据以下测试数据，给出最优配置建议。

## 测试结果摘要
{results_summary}

## AI图像分析（如有）
{ai_analysis or '无'}

请给出：
1. 推荐的最佳配置组合（检测率优先）
2. 推荐的最快配置组合（速度优先，检测率>80%）
3. 为什么某些配置能检测到而其他不能
4. 针对这个场景的3条具体优化建议

用中文回答，简洁实用。"""

    try:
        resp = requests.post(QWEN_API_URL, headers={
            "Authorization": f"Bearer {QWEN_API_KEY}", "Content-Type": "application/json"
        }, json={
            "model": QWEN_TEXT_MODEL,
            "messages": [{"role": "user", "content": prompt}],
            "max_tokens": 2048, "temperature": 0.3
        }, timeout=30)
        data = resp.json()
        return data["choices"][0]["message"]["content"]
    except Exception as e:
        return f"AI报告生成失败: {e}"


# ════════════════════════════════════════════════════════════
# 解码引擎
# ════════════════════════════════════════════════════════════
def _valid_bc(t):
    if not t or len(t) < 3 or len(t) > 50: return False
    return sum(1 for c in t if 32 <= ord(c) <= 126) / len(t) >= 0.7

def scan_image(img, label=""):
    """对一张图调用 zxingcpp / pyzbar，返回 {text: format}"""
    found = {}
    if ZXING_OK:
        try:
            for r in zxingcpp.read_barcodes(img, try_rotate=True, try_downscale=True, try_invert=True):
                t = r.text.strip()
                if _valid_bc(t): found[t] = str(r.format)
        except Exception: pass
    if PYZBAR_OK:
        try:
            for r in pyzbar_decode(img):
                t = r.data.decode('utf-8', errors='ignore').strip()
                if _valid_bc(t) and t not in found: found[t] = r.type
        except Exception: pass
    return found


# ════════════════════════════════════════════════════════════
# 配置生成器 — 生成所有可能的解码配置组合
# ════════════════════════════════════════════════════════════
def generate_configs():
    """生成所有 预处理×区域×缩放×旋转 组合"""
    configs = []

    # 预处理
    preprocessors = {
        "原图": lambda im: im,
        "CLAHE": lambda im: cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8)).apply(im),
        "CLAHE_5": lambda im: cv2.createCLAHE(clipLimit=5.0, tileGridSize=(8, 8)).apply(im),
        "锐化": lambda im: cv2.addWeighted(
            cv2.createCLAHE(3.0, (8,8)).apply(im), 1.5,
            cv2.GaussianBlur(cv2.createCLAHE(3.0,(8,8)).apply(im), (3,3), 0), -0.5, 0),
        "Gamma": lambda im: cv2.LUT(im, np.array([((i/255.0)**0.5)*255 for i in range(256)]).astype("uint8")),
        "二值化": lambda im: cv2.adaptiveThreshold(
            cv2.createCLAHE(3.0,(8,8)).apply(im), 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 21, 5),
        "形态闭": lambda im: cv2.morphologyEx(im, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_RECT, (1, 5))),
    }

    # 区域
    regions = {
        "全图": lambda im: im,
        "右半": lambda im: im[:, im.shape[1]//2:],
        "左半": lambda im: im[:, :im.shape[1]//2],
        "右上1/4": lambda im: im[:im.shape[0]//2, im.shape[1]//2:],
        "右下1/4": lambda im: im[im.shape[0]//2:, im.shape[1]//2:],
        "上半": lambda im: im[:im.shape[0]//2, :],
        "下半": lambda im: im[im.shape[0]//2:, :],
        "中间60%": lambda im: im[im.shape[0]//5:4*im.shape[0]//5, im.shape[1]//5:4*im.shape[1]//5],
    }

    # 缩放
    scales = {
        "1600w": lambda im: _resize_w(im, 1600),
        "1200w": lambda im: _resize_w(im, 1200),
        "800w": lambda im: _resize_w(im, 800),
        "2x": lambda im: cv2.resize(im, None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC),
        "原始": lambda im: im,
    }

    # 旋转
    rotations = {
        "0°": None,
        "-20°": -20, "-15°": -15, "-10°": -10, "-5°": -5,
        "5°": 5, "10°": 10, "15°": 15, "20°": 20,
    }

    # 生成重要组合（不是全排列，而是有策略的组合）
    # 第1组: 全图 × 各预处理 × 各缩放 × 0°
    for pp_name, pp_fn in preprocessors.items():
        for sc_name, sc_fn in scales.items():
            if sc_name == "2x" and pp_name not in ("原图", "CLAHE"): continue
            configs.append((f"{pp_name}|全图|{sc_name}|0°", pp_fn, regions["全图"], sc_fn, None))

    # 第2组: 各区域 × CLAHE/原图 × 合理缩放 × 0°
    for rg_name, rg_fn in regions.items():
        if rg_name == "全图": continue
        for pp_name in ["CLAHE", "原图", "锐化"]:
            for sc_name in ["1600w", "1200w", "2x"]:
                if sc_name == "2x" and rg_name in ("全图", "上半", "下半"): continue
                configs.append((f"{pp_name}|{rg_name}|{sc_name}|0°",
                                preprocessors[pp_name], rg_fn, scales[sc_name], None))

    # 第3组: 旋转 × 右半/右上 × CLAHE × 合理缩放
    for rot_name, rot_val in rotations.items():
        if rot_val is None: continue
        for rg_name in ["右半", "右上1/4", "全图"]:
            for sc_name in ["1200w", "2x"]:
                configs.append((f"CLAHE|{rg_name}|{sc_name}|{rot_name}",
                                preprocessors["CLAHE"], regions[rg_name], scales[sc_name], rot_val))

    # 第4组: 形态学 + 放大 + 右半
    for rg_name in ["右半", "右上1/4"]:
        configs.append((f"形态闭|{rg_name}|2x|0°",
                        preprocessors["形态闭"], regions[rg_name], scales["2x"], None))
        for rot in [-15, -10, 10, 15]:
            configs.append((f"形态闭|{rg_name}|2x|{rot}°",
                            preprocessors["形态闭"], regions[rg_name], scales["2x"], rot))

    return configs


def _resize_w(img, max_w):
    h, w = img.shape[:2]
    if w <= max_w: return img
    sc = max_w / w
    return cv2.resize(img, (max_w, int(h * sc)), interpolation=cv2.INTER_AREA)


def _rotate(img, angle):
    h, w = img.shape[:2]
    M = cv2.getRotationMatrix2D((w / 2, h / 2), angle, 1.0)
    return cv2.warpAffine(img, M, (w, h), borderValue=int(img.mean()))


# ════════════════════════════════════════════════════════════
# 单配置测试
# ════════════════════════════════════════════════════════════
def test_config(config, image):
    """测试单个配置，返回 (config_name, found_dict, elapsed_ms)"""
    name, pp_fn, rg_fn, sc_fn, rot = config
    try:
        img = image.copy()
        img = rg_fn(img)
        img = sc_fn(img)
        img = pp_fn(img)
        if rot is not None:
            img = _rotate(img, rot)
        if img.size == 0 or img.shape[0] < 10 or img.shape[1] < 10:
            return (name, {}, 0)
        t0 = time.time()
        found = scan_image(img, name)
        elapsed = (time.time() - t0) * 1000
        return (name, found, elapsed)
    except Exception as e:
        return (name, {}, 0)


# ════════════════════════════════════════════════════════════
# 并行暴力搜索
# ════════════════════════════════════════════════════════════
def parallel_search(image, configs, max_workers=8):
    """并行测试所有配置"""
    results = []
    total = len(configs)

    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        futures = {pool.submit(test_config, cfg, image): cfg[0] for cfg in configs}
        done = 0
        for future in as_completed(futures):
            done += 1
            try:
                name, found, elapsed = future.result(timeout=30)
                results.append((name, found, elapsed))
            except Exception:
                results.append((futures[future], {}, 0))

            if done % 20 == 0 or done == total:
                print(f"  进度: {done}/{total} ({done*100//total}%)", end='\r')

    print(f"  完成: {total}/{total} (100%)        ")
    return results


# ════════════════════════════════════════════════════════════
# 主流程
# ════════════════════════════════════════════════════════════
def run(path, use_ai=True):
    if os.path.isdir(path):
        all_imgs = sorted(glob.glob(os.path.join(path, "*.png")) + glob.glob(os.path.join(path, "*.jpg")) +
                           glob.glob(os.path.join(path, "*.bmp")))
        files = [f for f in all_imgs if '_annotated' not in f and '_detail' not in f
                 and '_CLAHE' not in f and '_sharp' not in f and '_bright' not in f and '_raw' not in f]
        if not files:
            files = all_imgs
        if len(files) < len(all_imgs):
            print(f"  ℹ 过滤掉 {len(all_imgs)-len(files)} 个标注/预处理文件，保留 {len(files)} 张原始帧")
    else:
        files = [path]

    if not files:
        print(f"❌ 未找到图片: {path}")
        return

    print(f"\n{'═'*70}")
    print(f"  🔍 果管扫码调试器 — 千问AI辅助 + 并行暴力搜索")
    print(f"  图片数: {len(files)}  |  zxingcpp: {'✓' if ZXING_OK else '✗'}  |  pyzbar: {'✓' if PYZBAR_OK else '✗'}")
    print(f"{'═'*70}")

    configs = generate_configs()
    print(f"  生成了 {len(configs)} 种配置组合")

    all_results = defaultdict(lambda: {'total':0, 'found_any':0, 'found_2':0, 'time_sum':0, 'codes_seen':set()})
    ai_analysis = None

    for fi, fpath in enumerate(files):
        img = imread_safe(fpath, cv2.IMREAD_GRAYSCALE)
        if img is None:
            print(f"  ⚠ 跳过: {fpath}")
            continue

        h, w = img.shape[:2]
        fname = os.path.basename(fpath)
        print(f"\n{'─'*70}")
        print(f"  [{fi+1}/{len(files)}] {fname} ({w}x{h})  亮度={int(img.mean())}")

        # AI分析（只对第一张图做）
        if use_ai and fi == 0:
            ai_analysis = ai_analyze_image(fpath)

        # 并行搜索
        print(f"  🚀 并行测试 {len(configs)} 种配置...")
        results = parallel_search(img, configs, max_workers=os.cpu_count() or 4)

        # 分析结果
        found_2_configs = []
        found_1_configs = []
        found_0_count = 0

        for name, found, elapsed in results:
            n = len(found)
            r = all_results[name]
            r['total'] += 1
            r['time_sum'] += elapsed
            if n > 0: r['found_any'] += 1
            if n >= 2: r['found_2'] += 1
            for k in found: r['codes_seen'].add(k)

            if n >= 2:
                found_2_configs.append((name, found, elapsed))
            elif n == 1:
                found_1_configs.append((name, found, elapsed))
            else:
                found_0_count += 1

        print(f"\n  📊 本图结果:")
        print(f"     找到2码: {len(found_2_configs)} 种配置")
        print(f"     找到1码: {len(found_1_configs)} 种配置")
        print(f"     找到0码: {found_0_count} 种配置")

        # 显示找到2码的配置（按速度排序）
        if found_2_configs:
            found_2_configs.sort(key=lambda x: x[2])
            print(f"\n  ✅ 找到2码的配置 (按速度排序，前20):")
            print(f"     {'配置':<45} {'耗时':>7}  码")
            for name, found, elapsed in found_2_configs[:20]:
                codes = ", ".join(f"[{v}]{k[:15]}" for k, v in found.items())
                print(f"     {name:<45} {elapsed:>6.0f}ms  {codes}")

            fastest = found_2_configs[0]
            print(f"\n  🏆 最快的2码配置: {fastest[0]}  ({fastest[2]:.0f}ms)")
        else:
            # 只找到1码时分析哪些码被找到
            if found_1_configs:
                qr_configs = [(n,f,e) for n,f,e in found_1_configs if any('QR' in v.upper() for v in f.values())]
                oned_configs = [(n,f,e) for n,f,e in found_1_configs if not any('QR' in v.upper() for v in f.values())]
                print(f"\n  ⚠ 无任何配置找到2码！")
                print(f"     找到QR码的配置: {len(qr_configs)}种")
                print(f"     找到1D码的配置: {len(oned_configs)}种")

                if qr_configs:
                    qr_configs.sort(key=lambda x: x[2])
                    print(f"\n     QR码最快: {qr_configs[0][0]} ({qr_configs[0][2]:.0f}ms)")
                    codes = ", ".join(f"[{v}]{k}" for k,v in qr_configs[0][1].items())
                    print(f"       码: {codes}")

                if oned_configs:
                    oned_configs.sort(key=lambda x: x[2])
                    print(f"\n     1D码最快: {oned_configs[0][0]} ({oned_configs[0][2]:.0f}ms)")
                    codes = ", ".join(f"[{v}]{k}" for k,v in oned_configs[0][1].items())
                    print(f"       码: {codes}")

        # 所有发现的唯一码
        all_codes = set()
        for name, found, elapsed in results:
            all_codes.update(found.keys())
        if all_codes:
            print(f"\n  🔢 本图发现的所有唯一码 ({len(all_codes)}个):")
            for code in sorted(all_codes):
                fmt_list = set()
                for name, found, elapsed in results:
                    if code in found: fmt_list.add(found[code])
                print(f"     [{'/'.join(fmt_list)}] {code}")

    # ════════════════════════════════════════════════════════════
    # 汇总排名
    # ════════════════════════════════════════════════════════════
    print(f"\n{'═'*70}")
    print(f"  📊 全局排名 (共 {len(files)} 张图)")
    print(f"{'═'*70}")

    ranked = sorted(all_results.items(),
                     key=lambda x: (-x[1]['found_2']/max(x[1]['total'],1),
                                     -x[1]['found_any']/max(x[1]['total'],1),
                                     x[1]['time_sum']/max(x[1]['total'],1)))

    # 最佳配置（2码率最高）
    best_2 = [(k,v) for k,v in ranked if v['found_2']>0]
    if best_2:
        print(f"\n  🏆 最佳配置 (2码检测率最高，前15):")
        print(f"     {'配置':<45} {'≥2码':>5} {'≥1码':>5} {'平均ms':>8}")
        for name, r in best_2[:15]:
            n = r['total']
            print(f"     {name:<45} {r['found_2']/n*100:>4.0f}% {r['found_any']/n*100:>4.0f}% {r['time_sum']/n:>7.0f}")

    # 最快配置（有2码且速度快）
    fast_2 = [(k,v) for k,v in ranked if v['found_2']>0]
    if fast_2:
        fast_2.sort(key=lambda x: x[1]['time_sum']/max(x[1]['total'],1))
        print(f"\n  ⚡ 最快配置 (能找到2码，按速度排序，前10):")
        print(f"     {'配置':<45} {'平均ms':>8} {'2码率':>5}")
        for name, r in fast_2[:10]:
            n = r['total']
            print(f"     {name:<45} {r['time_sum']/n:>7.0f} {r['found_2']/n*100:>4.0f}%")

    # 只找到1码的最佳配置
    only_1 = [(k,v) for k,v in ranked if v['found_any']>0 and v['found_2']==0]
    if only_1:
        print(f"\n  ⚠ 只能找到1码的配置 (前5):")
        print(f"     {'配置':<45} {'1码率':>5} {'平均ms':>8} {'发现的码'}")
        for name, r in only_1[:5]:
            n = r['total']
            codes = ", ".join(sorted(r['codes_seen']))[:40]
            print(f"     {name:<45} {r['found_any']/n*100:>4.0f}% {r['time_sum']/n:>7.0f} {codes}")

    # 生成摘要给AI
    summary_lines = []
    if best_2:
        summary_lines.append("最佳2码配置:")
        for name, r in best_2[:5]:
            n = r['total']
            summary_lines.append(f"  {name}: 2码率={r['found_2']/n*100:.0f}% 平均{r['time_sum']/n:.0f}ms")
    if fast_2:
        summary_lines.append("最快2码配置:")
        for name, r in fast_2[:3]:
            n = r['total']
            summary_lines.append(f"  {name}: {r['time_sum']/n:.0f}ms 2码率={r['found_2']/n*100:.0f}%")
    if only_1:
        summary_lines.append("只有1码的配置:")
        for name, r in only_1[:3]:
            n = r['total']
            summary_lines.append(f"  {name}: 发现码={','.join(sorted(r['codes_seen']))[:50]}")

    summary = "\n".join(summary_lines)

    # AI生成报告
    if use_ai:
        report = ai_generate_report(summary, ai_analysis)
        print(f"\n{'═'*70}")
        print(f"  🤖 千问AI优化建议")
        print(f"{'═'*70}")
        print(report)

    # 保存报告
    report_path = "barcode_debug_report.txt"
    try:
        with open(report_path, 'w', encoding='utf-8') as f:
            f.write(f"果管扫码调试报告\n{'='*50}\n")
            f.write(f"时间: {time.strftime('%Y-%m-%d %H:%M:%S')}\n")
            f.write(f"图片数: {len(files)}\n")
            f.write(f"配置数: {len(configs)}\n\n")
            f.write(f"摘要:\n{summary}\n")
            if use_ai and ai_analysis:
                f.write(f"\nAI图像分析:\n{ai_analysis}\n")
            if use_ai:
                f.write(f"\nAI建议:\n{report}\n")
        print(f"\n  📄 报告已保存: {report_path}")
    except Exception: pass

    print(f"\n{'═'*70}")
    print(f"  调试完成!")
    print(f"{'═'*70}\n")


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("用法: python barcode_debug.py <图片或目录> [--no-ai]")
        print("  python barcode_debug.py debug_frames/")
        print("  python barcode_debug.py image.png")
        print("  python barcode_debug.py debug_frames/ --no-ai")
        sys.exit(1)

    path = sys.argv[1]
    use_ai = "--no-ai" not in sys.argv

    try:
        run(path, use_ai)
    except Exception as e:
        print(f"❌ 错误: {e}")
        traceback.print_exc()
    try: input("\n按回车退出...")
    except Exception: pass
