#!/usr/bin/env python3
"""
条码识别开源库对比测试工具
用法: python barcode_test_libs.py <图片路径>

测试项目:
  1. zxingcpp — 直接读 / CLAHE / 旋转 / 放大 / 区域裁切
  2. pyzbar (ZBar) — 直接读 / CLAHE / 旋转 / 放大
  3. OpenCV BarcodeDetector — 内置1D检测
  4. 梯度定位法 — 先定位条码区域+角度，再矫正解码
"""
import sys, os, time
import cv2
import numpy as np

# ── 加载可用库 ──
try:
    import zxingcpp
    HAS_ZXING = True
except ImportError:
    HAS_ZXING = False

try:
    from pyzbar.pyzbar import decode as pyzbar_decode
    HAS_PYZBAR = True
except ImportError:
    HAS_PYZBAR = False

HAS_CV_BARCODE = hasattr(cv2, 'barcode') and hasattr(cv2.barcode, 'BarcodeDetector')


def imread_safe(path):
    data = np.fromfile(path, dtype=np.uint8)
    return cv2.imdecode(data, cv2.IMREAD_GRAYSCALE)


def shrink(img, max_w):
    h, w = img.shape[:2]
    if w <= max_w:
        return img
    sc = max_w / w
    return cv2.resize(img, None, fx=sc, fy=sc, interpolation=cv2.INTER_AREA)


def rotate_img(img, angle):
    h, w = img.shape[:2]
    cx, cy = w // 2, h // 2
    M = cv2.getRotationMatrix2D((cx, cy), angle, 1.0)
    cos_a, sin_a = abs(M[0, 0]), abs(M[0, 1])
    nw = int(h * sin_a + w * cos_a)
    nh = int(h * cos_a + w * sin_a)
    M[0, 2] += (nw - w) / 2
    M[1, 2] += (nh - h) / 2
    return cv2.warpAffine(img, M, (nw, nh), flags=cv2.INTER_LINEAR, borderValue=255)


def apply_clahe(img):
    return cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8)).apply(img)


def make_variants(img):
    """生成各种预处理变体"""
    h, w = img.shape[:2]
    variants = []

    # 基础
    variants.append(("原图", img))
    variants.append(("CLAHE", apply_clahe(img)))

    # 缩放
    for sz in [1200, 800, 600]:
        s = shrink(img, sz)
        variants.append((f"缩{sz}", s))
        variants.append((f"缩{sz}+CLAHE", apply_clahe(s)))

    # 右半
    rh = img[:, w // 2:]
    rh_s = shrink(rh, 800)
    rh_cl = apply_clahe(rh_s)
    variants.append(("右半800", rh_s))
    variants.append(("右半800+CLAHE", rh_cl))

    # 右半2x
    rh_2x = cv2.resize(rh_cl, None, fx=2.0, fy=2.0, interpolation=cv2.INTER_LINEAR)
    variants.append(("右半2x", rh_2x))

    # 旋转 (右半2x)
    for angle in [5, 10, 15, 20, 25, 30, -5, -10, -15, -20, -25, -30]:
        variants.append((f"右半2x@{angle}°", rotate_img(rh_2x, angle)))

    # 全图旋转 (缩1200+CLAHE)
    base = apply_clahe(shrink(img, 1200))
    for angle in [10, 15, 20, 25, -10, -15, -20, -25]:
        variants.append((f"全图1200@{angle}°", rotate_img(base, angle)))

    # 全图2x旋转
    base_2x = cv2.resize(base, None, fx=2.0, fy=2.0, interpolation=cv2.INTER_LINEAR)
    for angle in [15, 20, 25, -15, -20, -25]:
        variants.append((f"全图2x@{angle}°", rotate_img(base_2x, angle)))

    # 锐化
    bl = cv2.GaussianBlur(apply_clahe(img), (3, 3), 0)
    sharp = cv2.addWeighted(apply_clahe(img), 1.5, bl, -0.5, 0)
    variants.append(("锐化", shrink(sharp, 1200)))

    # 二值化
    _, otsu = cv2.threshold(apply_clahe(shrink(img, 1200)), 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    variants.append(("OTSU二值化", otsu))

    # 形态学闭运算
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (1, 5))
    morph = cv2.morphologyEx(rh_cl, cv2.MORPH_CLOSE, kernel)
    morph_2x = cv2.resize(morph, None, fx=2.0, fy=2.0, interpolation=cv2.INTER_LINEAR)
    variants.append(("形态闭右半2x", morph_2x))
    for angle in [15, 20, 25, -15, -20, -25]:
        variants.append((f"形态闭右半2x@{angle}°", rotate_img(morph_2x, angle)))

    return variants


def locate_barcode_regions(gray):
    """梯度方向一致性定位条码"""
    work = shrink(gray, 800)
    scale = gray.shape[1] / work.shape[1]

    grad_x = cv2.Scharr(work, cv2.CV_64F, 1, 0)
    grad_y = cv2.Scharr(work, cv2.CV_64F, 0, 1)
    mag = cv2.magnitude(grad_x, grad_y)
    angle = cv2.phase(grad_x, grad_y, angleInDegrees=True) % 180.0

    mag_thresh = np.percentile(mag, 70)
    mask = (mag > mag_thresh).astype(np.uint8) * 255

    k_close = cv2.getStructuringElement(cv2.MORPH_RECT, (21, 7))
    k_open = cv2.getStructuringElement(cv2.MORPH_RECT, (7, 7))
    morphed = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, k_close)
    morphed = cv2.morphologyEx(morphed, cv2.MORPH_OPEN, k_open)

    contours, _ = cv2.findContours(morphed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    regions = []
    wh, ww = work.shape[:2]
    min_area = ww * wh * 0.001
    for cnt in contours:
        area = cv2.contourArea(cnt)
        if area < min_area:
            continue
        rect = cv2.minAreaRect(cnt)
        (cx, cy), (rw, rh), _ = rect
        if rw < 8 or rh < 8:
            continue
        aspect = max(rw, rh) / (min(rw, rh) + 1e-6)
        if aspect < 1.5:
            continue

        region_mask = np.zeros(work.shape[:2], dtype=np.uint8)
        cv2.drawContours(region_mask, [cnt], -1, 255, -1)
        region_angles = angle[region_mask > 0]
        if len(region_angles) < 10:
            continue

        median_angle = np.median(region_angles)
        barcode_angle = median_angle - 90.0
        if barcode_angle > 90: barcode_angle -= 180
        if barcode_angle < -90: barcode_angle += 180

        ox, oy = int(cx * scale), int(cy * scale)
        orw = int(max(rw, rh) * scale * 1.5)
        orh = int(min(rw, rh) * scale * 2.5)
        x1 = max(0, ox - orw // 2)
        y1 = max(0, oy - orh // 2)
        x2 = min(gray.shape[1], ox + orw // 2)
        y2 = min(gray.shape[0], oy + orh // 2)
        if x2 - x1 < 20 or y2 - y1 < 10:
            continue
        crop = gray[y1:y2, x1:x2]
        regions.append({
            'crop': crop,
            'angle': barcode_angle,
            'area': area,
            'bbox': (x1, y1, x2, y2),
            'aspect': aspect,
        })

    regions.sort(key=lambda x: x['area'], reverse=True)
    return regions[:8]


def test_zxingcpp(variants):
    print(f"\n{'='*70}")
    print(f"  📦 测试 zxingcpp v{zxingcpp.__version__}")
    print(f"{'='*70}")
    all_codes = {}
    for name, img in variants:
        t0 = time.time()
        try:
            results = zxingcpp.read_barcodes(img, try_rotate=True,
                                              try_downscale=True, try_invert=True)
            dt = time.time() - t0
            codes = [(r.text.strip(), str(r.format)) for r in results if r.text.strip()]
            if codes:
                for txt, fmt in codes:
                    if txt not in all_codes:
                        all_codes[txt] = (fmt, name, dt)
                print(f"  ✅ {name:30s} {img.shape[1]:4d}x{img.shape[0]:4d} {dt:.3f}s → {codes}")
            else:
                if dt > 0.5:
                    print(f"  ❌ {name:30s} {img.shape[1]:4d}x{img.shape[0]:4d} {dt:.3f}s (慢)")
        except Exception as e:
            print(f"  ❌ {name:30s} 异常: {e}")

    print(f"\n  总计发现 {len(all_codes)} 个不同码:")
    for txt, (fmt, vname, dt) in all_codes.items():
        print(f"    [{fmt}] {txt}  (首次在: {vname}, {dt:.3f}s)")
    return all_codes


def test_pyzbar(variants):
    print(f"\n{'='*70}")
    print(f"  📦 测试 pyzbar (ZBar)")
    print(f"{'='*70}")
    all_codes = {}
    for name, img in variants:
        t0 = time.time()
        try:
            results = pyzbar_decode(img)
            dt = time.time() - t0
            codes = [(obj.data.decode('utf-8', errors='replace').strip(), obj.type)
                     for obj in results if obj.data]
            if codes:
                for txt, fmt in codes:
                    if txt not in all_codes:
                        all_codes[txt] = (fmt, name, dt)
                print(f"  ✅ {name:30s} {img.shape[1]:4d}x{img.shape[0]:4d} {dt:.3f}s → {codes}")
        except Exception as e:
            pass

    print(f"\n  总计发现 {len(all_codes)} 个不同码:")
    for txt, (fmt, vname, dt) in all_codes.items():
        print(f"    [{fmt}] {txt}  (首次在: {vname}, {dt:.3f}s)")
    return all_codes


def test_opencv_barcode(img):
    print(f"\n{'='*70}")
    print(f"  📦 测试 OpenCV BarcodeDetector")
    print(f"{'='*70}")
    try:
        detector = cv2.barcode.BarcodeDetector()
        for sz in [None, 1200, 800, 600]:
            work = shrink(img, sz) if sz else img
            t0 = time.time()
            ok, decoded, types, points = detector.detectAndDecode(work)
            dt = time.time() - t0
            label = f"原图{work.shape[1]}x{work.shape[0]}" if sz is None else f"缩{sz}"
            if ok and decoded:
                codes = [(d, t) for d, t in zip(decoded, types) if d]
                if codes:
                    print(f"  ✅ {label:20s} {dt:.3f}s → {codes}")
                else:
                    print(f"  ❌ {label:20s} {dt:.3f}s 检测到框但未解码")
            else:
                print(f"  ❌ {label:20s} {dt:.3f}s")

        # CLAHE 版本
        for sz in [1200, 800]:
            work = apply_clahe(shrink(img, sz))
            t0 = time.time()
            ok, decoded, types, points = detector.detectAndDecode(work)
            dt = time.time() - t0
            if ok and decoded:
                codes = [(d, t) for d, t in zip(decoded, types) if d]
                if codes:
                    print(f"  ✅ {'CLAHE+缩'+str(sz):20s} {dt:.3f}s → {codes}")
    except Exception as e:
        print(f"  ❌ 不可用: {e}")


def test_gradient_locate(img):
    print(f"\n{'='*70}")
    print(f"  📦 测试 梯度定位法 (Scharr + 轮廓)")
    print(f"{'='*70}")

    t0 = time.time()
    regions = locate_barcode_regions(img)
    dt_locate = time.time() - t0
    print(f"  定位耗时: {dt_locate:.3f}s, 找到 {len(regions)} 个候选区域")

    all_codes = {}
    for i, reg in enumerate(regions):
        crop = reg['crop']
        angle = reg['angle']
        bbox = reg['bbox']
        aspect = reg['aspect']
        ch, cw = crop.shape[:2]
        print(f"\n  区域{i}: bbox={bbox}, 角度={angle:.1f}°, 长宽比={aspect:.1f}, 尺寸={cw}x{ch}")

        test_imgs = []
        # 原始裁切
        test_imgs.append(("原始裁切", crop))
        test_imgs.append(("裁切+CLAHE", apply_clahe(crop)))

        # 角度矫正
        if abs(angle) > 2:
            corrected = rotate_img(apply_clahe(crop), angle)
            test_imgs.append((f"矫正{angle:.0f}°", corrected))
            # 微调
            for da in [-5, 5, -10, 10]:
                test_imgs.append((f"矫正{angle:.0f}{da:+d}°", rotate_img(apply_clahe(crop), angle + da)))

        # 放大
        for name, base in list(test_imgs):
            up2 = cv2.resize(base, None, fx=2.0, fy=2.0, interpolation=cv2.INTER_LINEAR)
            test_imgs.append((f"{name}+2x", up2))
            up3 = cv2.resize(base, None, fx=3.0, fy=3.0, interpolation=cv2.INTER_LINEAR)
            test_imgs.append((f"{name}+3x", up3))

        for name, timg in test_imgs:
            if HAS_ZXING:
                try:
                    results = zxingcpp.read_barcodes(timg, try_rotate=True,
                                                      try_downscale=True, try_invert=True)
                    for r in results:
                        txt = r.text.strip()
                        fmt = str(r.format)
                        if txt and txt not in all_codes:
                            all_codes[txt] = (fmt, f"区域{i}/{name}")
                            print(f"    ✅ zxing {name:25s} → [{fmt}] {txt}")
                except Exception:
                    pass

            if HAS_PYZBAR:
                try:
                    for obj in pyzbar_decode(timg):
                        txt = obj.data.decode('utf-8', errors='replace').strip()
                        fmt = obj.type
                        if txt and txt not in all_codes:
                            all_codes[txt] = (fmt, f"区域{i}/{name}")
                            print(f"    ✅ pyzbar {name:25s} → [{fmt}] {txt}")
                except Exception:
                    pass

    print(f"\n  梯度定位法总计发现 {len(all_codes)} 个不同码:")
    for txt, (fmt, loc) in all_codes.items():
        print(f"    [{fmt}] {txt}  ({loc})")
    return all_codes


def main():
    if len(sys.argv) < 2:
        print("用法: python barcode_test_libs.py <图片路径>")
        print("  测试所有可用的开源条码库对同一张图的识别能力")
        sys.exit(1)

    path = sys.argv[1]
    img = imread_safe(path)
    if img is None:
        print(f"❌ 无法读取: {path}")
        sys.exit(1)

    h, w = img.shape[:2]
    print(f"{'═'*70}")
    print(f"  条码识别开源库对比测试")
    print(f"  图片: {os.path.basename(path)}  尺寸: {w}x{h}")
    print(f"  可用库: zxingcpp={'✓' if HAS_ZXING else '✗'}  pyzbar={'✓' if HAS_PYZBAR else '✗'}  cv_barcode={'✓' if HAS_CV_BARCODE else '✗'}")
    print(f"{'═'*70}")

    variants = make_variants(img)
    print(f"  生成了 {len(variants)} 种预处理变体")

    summary = {}

    # 1. zxingcpp
    if HAS_ZXING:
        codes = test_zxingcpp(variants)
        summary['zxingcpp'] = codes

    # 2. pyzbar
    if HAS_PYZBAR:
        codes = test_pyzbar(variants)
        summary['pyzbar'] = codes

    # 3. OpenCV BarcodeDetector
    if HAS_CV_BARCODE:
        test_opencv_barcode(img)

    # 4. 梯度定位法
    codes = test_gradient_locate(img)
    summary['梯度定位'] = codes

    # 汇总
    print(f"\n{'═'*70}")
    print(f"  📊 汇总")
    print(f"{'═'*70}")
    all_unique = set()
    for lib_name, codes in summary.items():
        print(f"  {lib_name}: {len(codes)} 个码 — {list(codes.keys())}")
        all_unique.update(codes.keys())
    print(f"\n  所有库合计找到 {len(all_unique)} 个不同码: {all_unique}")

    if len(all_unique) < 2:
        print(f"\n  ⚠ 未能找到2个码！可能原因:")
        print(f"    1. 1D条码物理损坏（墨水/签名遮挡）")
        print(f"    2. 条码太小，分辨率不足")
        print(f"    3. 倾斜角度超出所有库能力范围")
        print(f"    4. 条码类型不被支持")
        print(f"\n  建议: 把图片发给开发者分析")

    input("\n按回车退出...")


if __name__ == "__main__":
    main()
