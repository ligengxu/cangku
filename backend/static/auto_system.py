#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
全自动扫码称重滚筒控制系统
===========================
AI驱动的全自动测试+生产系统
- 自动探测所有硬件（读码器、电子秤、滚筒）
- 通义千问AI分析测试结果
- 完整的扫码-称重-滚筒控制流程
- 自动生成测试报告

使用: python auto_system.py
依赖: pip install zxing-cpp opencv-python numpy pyserial requests
备选: pip install pyzbar  (如果zxing-cpp安装失败)
"""
VERSION = "9.8"

import os
import sys
import subprocess

def _pip_install(*packages):
    subprocess.check_call([sys.executable, "-m", "pip", "install"] + list(packages))

def _ensure_deps():
    """启动时自动安装缺失的依赖"""
    core_pkgs = {
        "cv2": "opencv-python",
        "numpy": "numpy",
        "serial": "pyserial",
        "requests": "requests",
    }
    missing = []
    for mod, pip_name in core_pkgs.items():
        try:
            __import__(mod)
        except ImportError:
            missing.append(pip_name)

    if missing:
        print(f"\n  正在自动安装缺失依赖: {', '.join(missing)} ...")
        try:
            subprocess.check_call(
                [sys.executable, "-m", "pip", "install", "--upgrade", "pip"],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            )
        except Exception:
            pass
        _pip_install(*missing)
        print("  基础依赖安装完成!")

    try:
        __import__("zxingcpp")
    except ImportError:
        print("\n  正在安装条码解码库 zxing-cpp ...")
        try:
            _pip_install("zxing-cpp")
            print("  zxing-cpp 安装成功!")
        except Exception:
            print("  ⚠ zxing-cpp 安装失败，尝试安装备用库 pyzbar ...")
            try:
                _pip_install("pyzbar")
                print("  pyzbar 安装成功（备用方案）!")
                print("  提示: pyzbar 需要 Visual C++ Redistributable")
                print("  下载地址: https://aka.ms/vs/17/release/vc_redist.x64.exe")
            except Exception as e:
                print(f"  ⚠ 备用库也安装失败: {e}")
                print("  请手动运行: pip install zxing-cpp")

    print()

_ensure_deps()

import time
import json
import socket
import threading
import traceback
import requests
import numpy as np
import base64
from ctypes import *
from datetime import datetime
from dataclasses import dataclass, field
from typing import Optional, List, Dict, Any

# ============================================================
# 全局配置
# ============================================================
QWEN_API_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions"
QWEN_API_KEY = "sk-b121d7a1020f4c4e9740ec130f359333"
QWEN_MODEL = "qwen-turbo"

COOLDOWN_SECONDS = 10
ALARM_MAX_SECONDS = 60
ALARM_REPEAT_INTERVAL = 5
WEIGHT_MIN_KG = 0.5
WEIGHT_MAX_KG = 6.0
REQUIRED_CODES = 2

ROLLER_START = bytes([0x85, 0x41, 0x7F, 0x00, 0x1E, 0x00, 0x7F, 0x5F])
ROLLER_STOP  = bytes([0x8A, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01])
ROLLER_DURATION_MS = 300

BACKEND_URL = "http://36.134.229.82:8000"
MACHINE_NUMBER = "1"

_EXPRESS_PREFIXES = ("YT", "SF", "JD", "JT", "DPK", "YD", "STO", "ZTO", "EMS", "EA", "EB", "EC", "ED")

ROLLER_COMMANDS = {
    '428_left':  bytes([0x85,0x41,0x64,0x00,0x28,0x00,0x5A,0x57,0x8A,0x01,0x00,0x00,0x00,0x00,0x00,0x01]),
    '428_right': bytes([0x85,0x01,0x64,0x00,0x28,0x00,0x5A,0x17,0x8A,0x01,0x00,0x00,0x00,0x00,0x00,0x01]),
    '600_left':  bytes([0x85,0x41,0x64,0x00,0x42,0x00,0x6F,0x08,0x8A,0x01,0x00,0x00,0x00,0x00,0x09,0x08]),
    '600_right': bytes([0x85,0x01,0x64,0x00,0x42,0x00,0x6F,0x48,0x8A,0x01,0x00,0x00,0x00,0x00,0x09,0x08]),
}

COMMON_BAUDRATES = [9600, 19200, 38400, 57600, 115200]
CONFIG_FILE = "hw_config.json"
UPLOAD_QUEUE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "pending_uploads.json")
UPDATE_CHECK_URL = BACKEND_URL + "/api/device/scan-monitor-download-py"


# ============================================================
# 自动更新
# ============================================================
def _check_and_update():
    """启动时检查服务器是否有新版本，有则自动下载替换并重启"""
    try:
        # 优先从本地配置读取服务器地址
        update_url = UPDATE_CHECK_URL
        try:
            if os.path.exists(CONFIG_FILE):
                with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
                    cfg = json.load(f)
                    server = cfg.get('backend_url', '')
                    if server:
                        update_url = server + "/api/device/scan-monitor-download-py"
        except Exception:
            pass

        print(f"  [更新] 当前版本 v{VERSION}，检查服务器...")
        resp = requests.head(update_url, timeout=5)
        if resp.status_code != 200:
            print(f"  [更新] 服务器不可达({resp.status_code})，跳过更新")
            return

        resp = requests.get(update_url, timeout=15)
        if resp.status_code != 200:
            print(f"  [更新] 下载失败({resp.status_code})")
            return

        content = resp.content
        remote_ver = None
        for line in content.decode('utf-8', errors='replace').split('\n')[:30]:
            line = line.strip()
            if line.startswith('VERSION') and '=' in line:
                raw = line.split('=', 1)[1].strip().strip('"').strip("'")
                remote_ver = raw
                break

        if not remote_ver:
            print("  [更新] 无法解析远程版本号，跳过")
            return

        if remote_ver == VERSION:
            print(f"  [更新] 已是最新版 v{VERSION}")
            return

        print(f"  [更新] 发现新版本 v{remote_ver} (当前 v{VERSION})，正在更新...")
        my_path = os.path.abspath(__file__)
        bak_path = my_path + ".bak"
        try:
            if os.path.exists(bak_path):
                os.remove(bak_path)
            os.rename(my_path, bak_path)
        except Exception:
            pass

        with open(my_path, 'wb') as f:
            f.write(content)
        print(f"  [更新] v{remote_ver} 下载完成，正在重启...")

        python = sys.executable
        os.execv(python, [python] + sys.argv)
    except requests.exceptions.RequestException:
        print("  [更新] 网络不可用，跳过更新检查")
    except Exception as e:
        print(f"  [更新] 检查失败: {e}，继续运行当前版本")


# ============================================================
# 串口冲突处理
# ============================================================
def _kill_port_holder(port):
    """Windows: 杀掉占用指定串口的进程"""
    if sys.platform != 'win32':
        return False
    try:
        import re
        result = subprocess.run(
            ['powershell', '-Command',
             f'Get-Process | Where-Object {{ $_.Modules.FileName -like "*serial*" -or $_.ProcessName -like "*python*" }} | Select-Object Id,ProcessName'],
            capture_output=True, text=True, timeout=5
        )
        # 通过尝试打开端口来确认是否占用
        import serial
        try:
            ser = serial.Serial(port=port, baudrate=9600, timeout=0.5)
            ser.close()
            return True  # 没被占用
        except serial.SerialException:
            pass

        # 杀掉其他 python 进程（排除自身）
        my_pid = os.getpid()
        killed = False
        for line in result.stdout.strip().split('\n'):
            parts = line.split()
            if len(parts) >= 2 and parts[0].isdigit():
                pid = int(parts[0])
                name = parts[1].lower()
                if pid != my_pid and 'python' in name:
                    try:
                        subprocess.run(['taskkill', '/F', '/PID', str(pid)],
                                       capture_output=True, timeout=5)
                        print(f"  [端口] 已终止占用进程 PID={pid} ({name})")
                        killed = True
                    except Exception:
                        pass
        if killed:
            time.sleep(1)
        return killed
    except Exception as e:
        print(f"  [端口] 进程查杀失败: {e}")
        return False


class UploadQueue:
    """本地持久化上传队列：保存待解码+上传的任务，重启后自动恢复"""

    def __init__(self, path=UPLOAD_QUEUE_FILE):
        self._path = path
        self._lock = threading.Lock()
        self._queue = self._load()

    def _load(self):
        try:
            if os.path.exists(self._path):
                with open(self._path, 'r', encoding='utf-8') as f:
                    return json.load(f)
        except Exception:
            pass
        return []

    def _save(self):
        try:
            tmp = self._path + '.tmp'
            with open(tmp, 'w', encoding='utf-8') as f:
                json.dump(self._queue, f, ensure_ascii=False)
            os.replace(tmp, self._path)
        except Exception:
            pass

    def add(self, task):
        with self._lock:
            self._queue.append(task)
            self._save()

    def pop(self):
        with self._lock:
            if self._queue:
                task = self._queue.pop(0)
                self._save()
                return task
        return None

    def remove(self, task_id):
        with self._lock:
            self._queue = [t for t in self._queue if t.get('id') != task_id]
            self._save()

    def __len__(self):
        with self._lock:
            return len(self._queue)

    def pending_count(self):
        return len(self)


# ============================================================
# 加载海康MVS SDK
# ============================================================
def setup_sdk():
    sdk_paths = [
        r"C:\Program Files (x86)\Common Files\MVS\Runtime\Win64_x64",
        r"C:\Program Files\Common Files\MVS\Runtime\Win64_x64",
        r"C:\Program Files (x86)\Common Files\MVS\Runtime\Win32_i86",
        r"D:\Program Files (x86)\Common Files\MVS\Runtime\Win64_x64",
    ]
    mvimport_paths = [
        r"C:\Program Files (x86)\MVS\Development\Samples\Python\MvImport",
        r"C:\Program Files\MVS\Development\Samples\Python\MvImport",
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "MvImport"),
        "MvImport",
    ]
    for path in sdk_paths:
        if os.path.exists(os.path.join(path, "MvCameraControl.dll")):
            os.environ["PATH"] = path + os.pathsep + os.environ.get("PATH", "")
            if hasattr(os, 'add_dll_directory'):
                os.add_dll_directory(path)
            break
    else:
        return False
    for path in mvimport_paths:
        if os.path.exists(path):
            parent = os.path.dirname(path) if os.path.basename(path) == "MvImport" else path
            if parent not in sys.path:
                sys.path.insert(0, parent)
            if path not in sys.path:
                sys.path.insert(0, path)
            return True
    return False

SDK_OK = setup_sdk()
if SDK_OK:
    from MvCameraControl_class import *

os.environ['ZBAR_VERBOSE'] = '0'
os.environ['ZBAR_DEBUG_LEVEL'] = '0'
if sys.platform == 'win32':
    try:
        import ctypes as _c
        _c.windll.msvcrt._set_abort_behavior(0, 0x0002)
    except Exception:
        pass

def _suppress_stderr():
    """临时屏蔽C层stderr（pyzbar WARNING）"""
    try:
        devnull = os.open(os.devnull, os.O_WRONLY)
        old = os.dup(2)
        os.dup2(devnull, 2)
        os.close(devnull)
        return old
    except Exception:
        return None

def _restore_stderr(old):
    if old is not None:
        try:
            os.dup2(old, 2)
            os.close(old)
        except Exception:
            pass

import cv2
import serial
import serial.tools.list_ports

# 优先使用zxing-cpp（支持旋转/倾斜条码），fallback到pyzbar
ZXING_OK = False
PYZBAR_OK = False
DYNAMSOFT_OK = False
_zxing_err = ""
try:
    import zxingcpp
    ZXING_OK = True
except Exception as _e:
    _zxing_err = str(_e)
    try:
        from pyzbar.pyzbar import decode as pyzbar_decode
        PYZBAR_OK = True
    except Exception:
        pass

# Dynamsoft Barcode Reader（降级链第二级）
_dynamsoft_cvr = None
try:
    from dynamsoft_barcode_reader_bundle import *
    _ds_err_code, _ds_err_msg = LicenseManager.init_license(
        "DLS2eyJvcmdhbml6YXRpb25JRCI6IjIwMDAwMSJ9")
    if _ds_err_code == EnumErrorCode.EC_OK or _ds_err_code == EnumErrorCode.EC_LICENSE_CACHE_USED:
        _dynamsoft_cvr = CaptureVisionRouter()
        DYNAMSOFT_OK = True
except Exception:
    pass

# 阿里云 OCR 面单识别配置（降级链第三级）
ALIYUN_OCR_AK = ""
ALIYUN_OCR_SK = ""
ALIYUN_OCR_OK = False


def _load_aliyun_config():
    """从 hw_config.json 加载阿里云 OCR 密钥"""
    global ALIYUN_OCR_AK, ALIYUN_OCR_SK, ALIYUN_OCR_OK
    try:
        if os.path.exists(CONFIG_FILE):
            with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
                cfg = json.load(f)
            ALIYUN_OCR_AK = cfg.get('aliyun_ocr_ak', '')
            ALIYUN_OCR_SK = cfg.get('aliyun_ocr_sk', '')
            if ALIYUN_OCR_AK and ALIYUN_OCR_SK:
                ALIYUN_OCR_OK = True
    except Exception:
        pass


_load_aliyun_config()


def _aliyun_ocr_waybill(img_bytes):
    """调用阿里云 OCR 通用文字识别，从面单图片中提取快递单号"""
    if not ALIYUN_OCR_OK:
        return None
    try:
        import hashlib, hmac, urllib.parse
        from datetime import timezone
        endpoint = "https://ocr-api.cn-hangzhou.aliyuncs.com"
        now_utc = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
        b64_body = base64.b64encode(img_bytes).decode()
        body_json = json.dumps({"body": b64_body})
        body_hash = hashlib.sha256(body_json.encode()).hexdigest()
        headers = {
            "Content-Type": "application/json",
            "x-acs-action": "RecognizeGeneral",
            "x-acs-version": "2021-07-07",
            "x-acs-date": now_utc,
            "x-acs-content-sha256": body_hash,
            "host": "ocr-api.cn-hangzhou.aliyuncs.com",
        }
        signed_headers = "content-type;host;x-acs-action;x-acs-content-sha256;x-acs-date;x-acs-version"
        canonical_headers = "\n".join(f"{k}:{headers[k]}" for k in sorted(headers.keys())) + "\n"
        canonical_request = f"POST\n/\n\n{canonical_headers}\n{signed_headers}\n{body_hash}"
        cr_hash = hashlib.sha256(canonical_request.encode()).hexdigest()
        string_to_sign = f"ACS3-HMAC-SHA256\n{cr_hash}"
        signature = hmac.new(ALIYUN_OCR_SK.encode(), string_to_sign.encode(), hashlib.sha256).hexdigest()
        headers["Authorization"] = f"ACS3-HMAC-SHA256 Credential={ALIYUN_OCR_AK},SignedHeaders={signed_headers},Signature={signature}"
        resp = requests.post(endpoint, headers=headers, data=body_json, timeout=10)
        if resp.status_code == 200:
            result = resp.json()
            data_str = result.get("Data", "")
            if isinstance(data_str, str):
                data = json.loads(data_str)
            else:
                data = data_str
            content = data.get("content", "")
            for line in content.split("\n"):
                line = line.strip()
                for prefix in _EXPRESS_PREFIXES:
                    if line.upper().startswith(prefix):
                        return line.strip()
                if line.isdigit() and len(line) >= 12:
                    return line
        return None
    except Exception as e:
        log(f"[阿里OCR] 调用失败: {e}")
        return None


def _dynamsoft_decode(img):
    """用 Dynamsoft Barcode Reader 解码图片，返回 {码文本: 格式} dict"""
    if not DYNAMSOFT_OK or _dynamsoft_cvr is None:
        return {}
    found = {}
    try:
        tmp_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_ds_tmp.png")
        cv2.imwrite(tmp_path, img)
        result = _dynamsoft_cvr.capture(tmp_path, "default")
        try:
            os.remove(tmp_path)
        except Exception:
            pass
        if result and result.get_items():
            for item in result.get_items():
                if hasattr(item, 'get_text') and hasattr(item, 'get_format_string'):
                    txt = item.get_text().strip()
                    if _is_valid_barcode(txt) and txt not in found:
                        found[txt] = item.get_format_string()
    except Exception as e:
        log(f"[Dynamsoft] 解码异常: {e}")
    return found


# ============================================================
# AI 助手 (通义千问)
# ============================================================
class AIAssistant:
    def __init__(self):
        self.history = []

    def ask(self, prompt, system_msg=None, max_tokens=1024):
        messages = []
        if system_msg:
            messages.append({"role": "system", "content": system_msg})
        messages.append({"role": "user", "content": prompt})
        try:
            resp = requests.post(
                QWEN_API_URL,
                headers={"Authorization": f"Bearer {QWEN_API_KEY}", "Content-Type": "application/json"},
                json={"model": QWEN_MODEL, "messages": messages, "max_tokens": max_tokens, "temperature": 0.3},
                timeout=30,
            )
            data = resp.json()
            answer = data["choices"][0]["message"]["content"]
            self.history.append({"prompt": prompt[:200], "answer": answer[:500]})
            return answer
        except Exception as e:
            err = f"AI调用失败: {e}"
            self.history.append({"prompt": prompt[:200], "answer": err})
            return err


# ============================================================
# 数据类
# ============================================================
@dataclass
class HardwareReport:
    camera_ok: bool = False
    camera_model: str = ""
    camera_ip: str = ""
    camera_sn: str = ""
    scale_ok: bool = False
    scale_port: str = ""
    scale_baudrate: int = 0
    scale_protocol: str = ""
    roller_ok: bool = False
    roller_port: str = ""
    roller_baudrate: int = 0
    roller_type: str = ""
    test_results: List[Dict[str, Any]] = field(default_factory=list)
    errors: List[str] = field(default_factory=list)


# ============================================================
# 图像处理 (复用 scanner_dual.py 逻辑)
# ============================================================
def convert_frame_to_image(data_buf, frame_info):
    frame_data = bytes(data_buf[:frame_info.nFrameLen])
    w, h = frame_info.nWidth, frame_info.nHeight
    pt = frame_info.enPixelType

    # Mono8
    if pt == 0x01080001:
        img = np.frombuffer(frame_data, dtype=np.uint8)
        return img.reshape((h, w)) if img.size == w * h else None

    # Mono10/12
    if pt in [0x01100003, 0x01100005, 0x010C0004, 0x010C0006]:
        img = np.frombuffer(frame_data, dtype=np.uint16)
        if img.size == w * h:
            return (img.reshape((h, w)) >> 2).astype(np.uint8)
        return None

    # Bayer
    bayer = {0x01080009: cv2.COLOR_BayerRG2GRAY, 0x0108000A: cv2.COLOR_BayerGR2GRAY,
             0x0108000B: cv2.COLOR_BayerGB2GRAY, 0x0108000C: cv2.COLOR_BayerBG2GRAY}
    if pt in bayer:
        img = np.frombuffer(frame_data, dtype=np.uint8)
        if img.size == w * h:
            return cv2.cvtColor(img.reshape((h, w)), bayer[pt])
        return None

    # YUV422 (YUYV/YUY2) — 0x02100032 等, 每2像素4字节: Y0 U Y1 V
    if pt in [0x02100032, 0x02100033, 0x02100034]:
        img = np.frombuffer(frame_data, dtype=np.uint8)
        expected = w * h * 2
        if img.size >= expected:
            # 直接提取Y通道（偶数字节位置），最高质量的灰度提取
            return img[:expected].reshape((h, w * 2))[:, 0::2].copy()
        return None

    # YUV422_Packed (UYVY)
    if pt in [0x02100030, 0x02100031]:
        img = np.frombuffer(frame_data, dtype=np.uint8)
        expected = w * h * 2
        if img.size >= expected:
            return img[:expected].reshape((h, w * 2))[:, 1::2].copy()
        return None

    # RGB/BGR 24bit
    if pt in [0x02180014, 0x02180015]:
        img = np.frombuffer(frame_data, dtype=np.uint8)
        if img.size == w * h * 3:
            img = img.reshape((h, w, 3))
            return cv2.cvtColor(img, cv2.COLOR_RGB2GRAY if pt == 0x02180014 else cv2.COLOR_BGR2GRAY)
        return None

    # 未知格式: 尝试按YUV422处理（帧长=w*h*2时）
    img = np.frombuffer(frame_data, dtype=np.uint8)
    if img.size == w * h * 2:
        return img.reshape((h, w * 2))[:, 0::2].copy()
    if img.size == w * h:
        return img.reshape((h, w))
    if img.size >= w * h:
        return img[:w * h].reshape((h, w))
    return None


def _is_valid_barcode(text):
    if not text or len(text) < 3:
        return False
    printable = sum(1 for c in text if c.isalnum() or c in '-_./: ')
    return printable / len(text) >= 0.7

_decode_dbg_count = 0


def _shrink(img, max_w):
    h, w = img.shape[:2]
    if w <= max_w:
        return img
    sc = max_w / w
    return cv2.resize(img, None, fx=sc, fy=sc, interpolation=cv2.INTER_AREA)


def _rotate_img(img, angle):
    h, w = img.shape[:2]
    cx, cy = w // 2, h // 2
    M = cv2.getRotationMatrix2D((cx, cy), angle, 1.0)
    cos_a, sin_a = abs(M[0, 0]), abs(M[0, 1])
    nw = int(h * sin_a + w * cos_a)
    nh = int(h * cos_a + w * sin_a)
    M[0, 2] += (nw - w) / 2
    M[1, 2] += (nh - h) / 2
    return cv2.warpAffine(img, M, (nw, nh), flags=cv2.INTER_LINEAR, borderValue=255)


def _apply_clahe(img):
    return cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8)).apply(img)


def _locate_barcode_regions(gray):
    """用梯度方向一致性定位1D条码区域，返回 [(cropped_img, angle), ...]"""
    work = _shrink(gray, 800)
    scale = gray.shape[1] / work.shape[1]

    grad_x = cv2.Scharr(work, cv2.CV_64F, 1, 0)
    grad_y = cv2.Scharr(work, cv2.CV_64F, 0, 1)
    mag = cv2.magnitude(grad_x, grad_y)
    angle = cv2.phase(grad_x, grad_y, angleInDegrees=True)
    angle = angle % 180.0

    mag_thresh = np.percentile(mag, 70)
    mask = (mag > mag_thresh).astype(np.uint8) * 255

    k_close = cv2.getStructuringElement(cv2.MORPH_RECT, (21, 7))
    k_open = cv2.getStructuringElement(cv2.MORPH_RECT, (7, 7))
    morphed = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, k_close)
    morphed = cv2.morphologyEx(morphed, cv2.MORPH_OPEN, k_open)

    contours, _ = cv2.findContours(morphed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    regions = []
    wh, ww = work.shape[:2]
    min_area = ww * wh * 0.002
    for cnt in contours:
        area = cv2.contourArea(cnt)
        if area < min_area:
            continue
        rect = cv2.minAreaRect(cnt)
        (cx, cy), (rw, rh), rect_angle = rect
        if rw < 10 or rh < 10:
            continue
        aspect = max(rw, rh) / (min(rw, rh) + 1e-6)
        if aspect < 2.0:
            continue

        region_mask = np.zeros(work.shape[:2], dtype=np.uint8)
        cv2.drawContours(region_mask, [cnt], -1, 255, -1)
        region_angles = angle[region_mask > 0]
        if len(region_angles) < 10:
            continue
        angle_std = np.std(region_angles)
        if angle_std > 35:
            continue

        median_angle = np.median(region_angles)
        barcode_angle = median_angle - 90.0
        if barcode_angle > 90:
            barcode_angle -= 180
        if barcode_angle < -90:
            barcode_angle += 180

        ox, oy = int(cx * scale), int(cy * scale)
        orw, orh = int(max(rw, rh) * scale * 1.5), int(min(rw, rh) * scale * 2.0)
        x1 = max(0, ox - orw // 2)
        y1 = max(0, oy - orh // 2)
        x2 = min(gray.shape[1], ox + orw // 2)
        y2 = min(gray.shape[0], oy + orh // 2)
        if x2 - x1 < 30 or y2 - y1 < 15:
            continue
        crop = gray[y1:y2, x1:x2]
        regions.append((crop, barcode_angle, area))

    regions.sort(key=lambda x: x[2], reverse=True)
    return [(r[0], r[1]) for r in regions[:5]]


def _enhance_for_barcode(img):
    """自适应图像增强：亮度矫正 + CLAHE + 锐化，让条码更清晰"""
    mean_b = img.mean()
    if mean_b < 100:
        gamma = min(0.5, 80.0 / max(mean_b, 1))
        lut = np.array([((i / 255.0) ** gamma) * 255 for i in range(256)]).astype("uint8")
        img = cv2.LUT(img, lut)
    cl = cv2.createCLAHE(clipLimit=4.0, tileGridSize=(8, 8)).apply(img)
    bl = cv2.GaussianBlur(cl, (3, 3), 0)
    return cv2.addWeighted(cl, 1.8, bl, -0.8, 0)


# 预构建格式常量，避免每次调用时创建
_FMT_QR = None      # QR码专用（快速扫描用）
_FMT_LINEAR = None   # 1D条码专用（深度解码用）
_FMT_ALL = None      # 所有格式
_BINARIZER_FAST = None  # 快速二值化器

def _init_zxing_formats():
    global _FMT_QR, _FMT_LINEAR, _FMT_ALL, _BINARIZER_FAST
    if not ZXING_OK:
        return
    try:
        _FMT_QR = zxingcpp.BarcodeFormat.QRCode
        _FMT_LINEAR = (zxingcpp.BarcodeFormat.Code128 |
                       zxingcpp.BarcodeFormat.Code39 |
                       zxingcpp.BarcodeFormat.Code93 |
                       zxingcpp.BarcodeFormat.EAN13 |
                       zxingcpp.BarcodeFormat.EAN8 |
                       zxingcpp.BarcodeFormat.ITF |
                       zxingcpp.BarcodeFormat.Codabar)
    except Exception:
        _FMT_QR = None
        _FMT_LINEAR = None
    try:
        _BINARIZER_FAST = zxingcpp.Binarizer.GlobalHistogram
    except Exception:
        _BINARIZER_FAST = None

if ZXING_OK:
    _init_zxing_formats()


def _zxing_scan(img, label="", dbg=False, fast=False, formats=None):
    """单次 zxingcpp 扫描，返回 {码文本: 格式} dict"""
    found = {}
    if not ZXING_OK:
        return found
    t0 = time.time()
    try:
        kwargs = {}
        if formats is not None:
            kwargs['formats'] = formats
        if fast:
            kwargs.update(try_rotate=False, try_downscale=False, try_invert=False)
            if _BINARIZER_FAST:
                kwargs['binarizer'] = _BINARIZER_FAST
        else:
            kwargs.update(try_rotate=True, try_downscale=True, try_invert=True)
        results = zxingcpp.read_barcodes(img, **kwargs)
        dt = time.time() - t0
        for r in results:
            txt = r.text.strip()
            if _is_valid_barcode(txt) and txt not in found:
                found[txt] = str(r.format)
        if dbg:
            log(f"[decode] {label}: {img.shape[1]}x{img.shape[0]} → {len(results)}码 ({dt:.3f}s)")
    except Exception as e:
        if dbg:
            log(f"[decode] {label}: err {e}")
    return found


def _zxing_single(img, label="", dbg=False, formats=None):
    """用 read_barcode (单数) 找第一个码就返回，比 read_barcodes 快"""
    if not ZXING_OK:
        return {}
    t0 = time.time()
    try:
        kwargs = dict(try_rotate=False, try_downscale=False, try_invert=False)
        if formats is not None:
            kwargs['formats'] = formats
        if _BINARIZER_FAST:
            kwargs['binarizer'] = _BINARIZER_FAST
        r = zxingcpp.read_barcode(img, **kwargs)
        dt = time.time() - t0
        if r and r.valid:
            txt = r.text.strip()
            if _is_valid_barcode(txt):
                if dbg:
                    log(f"[decode] {label}: {img.shape[1]}x{img.shape[0]} → 1码 ({dt:.3f}s)")
                return {txt: str(r.format)}
        if dbg:
            log(f"[decode] {label}: {img.shape[1]}x{img.shape[0]} → 0码 ({dt:.3f}s)")
    except Exception as e:
        if dbg:
            log(f"[decode] {label}: err {e}")
    return {}


def decode_barcodes(image, thorough=False):
    """快速扫描：极速QR识别 + CLAHE暗光兜底。thorough=True时增加更多尝试"""
    global _decode_dbg_count
    _decode_dbg_count += 1

    if not ZXING_OK and not PYZBAR_OK:
        return []

    dbg = _decode_dbg_count <= 3

    # 第1击：640px 极速QR（~30ms）
    tiny = _shrink(image, 640)
    hits = _zxing_single(tiny, "QR640", dbg, formats=_FMT_QR)
    if hits:
        return [{'data': k, 'type': v} for k, v in hits.items()]

    # 第2击：800px CLAHE + QR（~50ms）
    mid = _shrink(image, 800)
    hits = _zxing_single(_apply_clahe(mid), "QR800C", dbg, formats=_FMT_QR)
    if hits:
        return [{'data': k, 'type': v} for k, v in hits.items()]

    # 第3击：640px 不限格式
    hits = _zxing_single(tiny, "Any640", dbg)
    if hits:
        return [{'data': k, 'type': v} for k, v in hits.items()]

    if not thorough:
        return []

    # === 以下仅后台补识别时执行（thorough=True）===

    # 第4击：1200px 全格式 + try_rotate（捕获偏斜QR码）
    big = _shrink(image, 1200)
    hits = _zxing_scan(big, "All1200R", dbg)
    if hits:
        return [{'data': k, 'type': v} for k, v in hits.items()]

    # 第5击：1200px CLAHE + 全格式
    hits = _zxing_scan(_apply_clahe(big), "All1200CR", dbg)
    if hits:
        return [{'data': k, 'type': v} for k, v in hits.items()]

    # 第6击：全图增强 + 全格式
    enhanced = _enhance_for_barcode(image)
    hits = _zxing_scan(_shrink(enhanced, 1200), "Enh1200R", dbg)
    if hits:
        return [{'data': k, 'type': v} for k, v in hits.items()]

    return []


def decode_barcodes_deep(image, known_codes=None):
    """深度解码：高分辨率全图+分区+多角度+多二值化搜索1D快递条码"""
    all_found = dict(known_codes) if known_codes else {}

    if not ZXING_OK:
        return [{'data': k, 'type': v} for k, v in all_found.items()]

    fmt = _FMT_LINEAR
    h, w = image.shape[:2]

    def _done():
        return len(all_found) >= 2

    def _scan_update(img, label, use_fmt=None):
        f = use_fmt if use_fmt is not None else fmt
        hits = _zxing_scan(img, label, formats=f)
        all_found.update(hits)
        return _done()

    # Phase 0: 高分辨率全图 Code128 快速扫（利用原始清晰度）
    # 原图 3072x2048，先用 2000px 保持 1D 条码细节
    full_hi = _shrink(image, 2000)
    if _scan_update(full_hi, "D0全图2000"):
        return [{'data': k, 'type': v} for k, v in all_found.items()]

    enhanced = _enhance_for_barcode(image)

    # Phase 1: 多种增强的全图扫描
    for res, tag in [(1600, "1600"), (1200, "1200")]:
        full_s = _shrink(enhanced, res)
        if _scan_update(full_s, f"D1全图{tag}"):
            return [{'data': k, 'type': v} for k, v in all_found.items()]
        if _scan_update(_apply_clahe(full_s), f"D1全图{tag}C"):
            return [{'data': k, 'type': v} for k, v in all_found.items()]

    # Phase 1b: 全格式搜索（某些快递码可能不是 Code128）
    if _scan_update(_shrink(enhanced, 1600), "D1全图1600ALL", use_fmt=None):
        return [{'data': k, 'type': v} for k, v in all_found.items()]

    # Phase 2: 梯度定位 + 精确矫正（从原始高分辨率图裁剪）
    try:
        regions = _locate_barcode_regions(enhanced)
        for i, (crop, angle) in enumerate(regions):
            if _done():
                break
            crop_enh = _enhance_for_barcode(crop)
            corrected = _rotate_img(crop_enh, angle) if abs(angle) > 3 else crop_enh
            for sc in [2.0, 3.0, 4.0]:
                if _done():
                    break
                up = cv2.resize(corrected, None, fx=sc, fy=sc, interpolation=cv2.INTER_LINEAR)
                if _scan_update(up, f"D2区域{i}@{angle:.0f}x{sc:.0f}"):
                    break
                for da in [-5, 5, -10, 10, -15, 15]:
                    if _done():
                        break
                    if _scan_update(_rotate_img(up, da), f"D2@{angle:.0f}{da:+d}x{sc:.0f}"):
                        break
    except Exception:
        pass
    if _done():
        return [{'data': k, 'type': v} for k, v in all_found.items()]

    # Phase 3: 四象限分区扫描（快递条码位置不定）
    quadrants = [
        ("右上", enhanced[:h//2, w//2:]),
        ("左上", enhanced[:h//2, :w//2]),
        ("右下", enhanced[h//2:, w//2:]),
        ("左下", enhanced[h//2:, :w//2]),
        ("右半", enhanced[:, w//2:]),
        ("左半", enhanced[:, :w//2]),
        ("上半", enhanced[:h//2, :]),
        ("下半", enhanced[h//2:, :]),
    ]
    for label, region in quadrants:
        if _done():
            break
        rs = _shrink(region, 1000)
        if _scan_update(rs, f"D3{label}1000"):
            break
        r2x = cv2.resize(rs, None, fx=2.0, fy=2.0, interpolation=cv2.INTER_LINEAR)
        for angle in [0, 15, -15, 25, -25, 10, -10]:
            if _done():
                break
            img_try = _rotate_img(r2x, angle) if angle != 0 else r2x
            if _scan_update(img_try, f"D3{label}2x@{angle}"):
                break

    if _done():
        return [{'data': k, 'type': v} for k, v in all_found.items()]

    # Phase 4: 自适应二值化（Otsu + 固定阈值多种组合）
    try:
        gray = _shrink(image, 1600)
        _, otsu = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        if _scan_update(otsu, "D4Otsu1600"):
            return [{'data': k, 'type': v} for k, v in all_found.items()]
        adaptive = cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                                          cv2.THRESH_BINARY, 31, 10)
        if _scan_update(adaptive, "D4Adap1600"):
            return [{'data': k, 'type': v} for k, v in all_found.items()]
    except Exception:
        pass

    return [{'data': k, 'type': v} for k, v in all_found.items()]

def _decode_pyzbar(image, all_found):
    """pyzbar fallback，需要手动旋转"""
    def _try_decode(img):
        old_err = _suppress_stderr()
        try:
            for obj in pyzbar_decode(img):
                txt = obj.data.decode('utf-8', errors='replace').strip()
                if _is_valid_barcode(txt) and txt not in all_found:
                    all_found[txt] = obj.type
        except Exception:
            pass
        finally:
            _restore_stderr(old_err)

    def _try_preprocess(img):
        _try_decode(img)
        if len(all_found) >= 2:
            return True
        try:
            clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8))
            _try_decode(clahe.apply(img))
        except Exception:
            pass
        if len(all_found) >= 2:
            return True
        try:
            blurred = cv2.GaussianBlur(img, (3, 3), 0)
            sharp = cv2.addWeighted(img, 1.5, blurred, -0.5, 0)
            _try_decode(sharp)
        except Exception:
            pass
        if len(all_found) >= 2:
            return True
        try:
            _, otsu = cv2.threshold(img, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
            _try_decode(otsu)
        except Exception:
            pass
        return len(all_found) >= 2

    h, w = image.shape[:2]
    work = cv2.resize(image, None, fx=1600.0/w, fy=1600.0/w, interpolation=cv2.INTER_AREA) if w > 2000 else image

    _try_preprocess(work)
    if len(all_found) >= 2:
        return [{'data': k, 'type': v} for k, v in all_found.items()]

    # 旋转尝试
    for angle in [15, -15, 30, -30, 45, -45]:
        if len(all_found) >= 2:
            break
        h0, w0 = work.shape[:2]
        cx, cy = w0 // 2, h0 // 2
        M = cv2.getRotationMatrix2D((cx, cy), angle, 1.0)
        cos_a, sin_a = abs(M[0, 0]), abs(M[0, 1])
        nw = int(h0 * sin_a + w0 * cos_a)
        nh = int(h0 * cos_a + w0 * sin_a)
        M[0, 2] += (nw - w0) / 2
        M[1, 2] += (nh - h0) / 2
        rotated = cv2.warpAffine(work, M, (nw, nh), flags=cv2.INTER_LINEAR, borderValue=255)
        _try_preprocess(rotated)

    return [{'data': k, 'type': v} for k, v in all_found.items()]


# ============================================================
# 硬件探测模块
# ============================================================
class HardwareDetector:
    def __init__(self, ai: AIAssistant):
        self.ai = ai
        self.report = HardwareReport()

    def detect_all(self):
        log("=" * 60)
        log("  第一阶段: 自动探测所有硬件")
        log("=" * 60)

        # 尝试加载上次保存的配置
        if self._load_config():
            log("\n[配置] 找到上次保存的硬件配置，验证连接...")
            if self._verify_saved_config():
                log("[配置] 所有设备连接正常，跳过探测!")
                self._save_config()
                return self.report
            else:
                log("[配置] 部分设备连接失败，删除旧配置重新探测...")
                try:
                    os.remove(CONFIG_FILE)
                except Exception:
                    pass
                self.report = HardwareReport()

        self.detect_camera()
        self.detect_serial_devices()
        self._save_config()
        return self.report

    def _save_config(self):
        """保存硬件配置到本地文件"""
        config = {
            'camera_ok': self.report.camera_ok,
            'camera_model': self.report.camera_model,
            'camera_ip': self.report.camera_ip,
            'camera_sn': self.report.camera_sn,
            'scale_ok': self.report.scale_ok,
            'scale_port': self.report.scale_port,
            'scale_baudrate': self.report.scale_baudrate,
            'scale_protocol': self.report.scale_protocol,
            'roller_ok': self.report.roller_ok,
            'roller_port': self.report.roller_port,
            'roller_baudrate': self.report.roller_baudrate,
            'roller_type': self.report.roller_type,
            'saved_at': datetime.now().isoformat(),
        }
        try:
            with open(CONFIG_FILE, 'w', encoding='utf-8') as f:
                json.dump(config, f, ensure_ascii=False, indent=2)
            log(f"[配置] 已保存到 {CONFIG_FILE}")
        except Exception as e:
            log(f"[配置] 保存失败: {e}")

    def _load_config(self):
        """从本地文件加载硬件配置"""
        if not os.path.exists(CONFIG_FILE):
            return False
        try:
            with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
                config = json.load(f)
            self.report.camera_ok = config.get('camera_ok', False)
            self.report.camera_model = config.get('camera_model', '')
            self.report.camera_ip = config.get('camera_ip', '')
            self.report.camera_sn = config.get('camera_sn', '')
            self.report.scale_ok = config.get('scale_ok', False)
            self.report.scale_port = config.get('scale_port', '')
            self.report.scale_baudrate = config.get('scale_baudrate', 0)
            self.report.scale_protocol = config.get('scale_protocol', '')
            self.report.roller_ok = config.get('roller_ok', False)
            self.report.roller_port = config.get('roller_port', '')
            self.report.roller_baudrate = config.get('roller_baudrate', 0)
            self.report.roller_type = config.get('roller_type', '')
            saved = config.get('saved_at', '未知')
            log(f"[配置] 加载配置 (保存于 {saved})")
            log(f"  读码器: {self.report.camera_model} IP:{self.report.camera_ip}")
            log(f"  电子秤: {self.report.scale_port} @ {self.report.scale_baudrate}")
            log(f"  滚筒:   {self.report.roller_port} @ {self.report.roller_baudrate} 型号:{self.report.roller_type}")
            return True
        except Exception as e:
            log(f"[配置] 加载失败: {e}")
            return False

    def _verify_saved_config(self):
        """验证保存的配置是否仍然有效"""
        all_ok = True

        # 验证读码器
        if self.report.camera_ok and SDK_OK:
            deviceList = MV_CC_DEVICE_INFO_LIST()
            ret = MvCamera.MV_CC_EnumDevices(MV_GIGE_DEVICE | MV_USB_DEVICE, deviceList)
            if ret == 0 and deviceList.nDeviceNum > 0:
                log("[验证] 读码器: ✓ 在线")
            else:
                log("[验证] 读码器: × 离线")
                self.report.camera_ok = False
                all_ok = False
        elif self.report.camera_ok:
            log("[验证] 读码器: × SDK未加载")
            self.report.camera_ok = False
            all_ok = False

        # 验证电子秤
        if self.report.scale_ok and self.report.scale_port:
            if not self._try_open_port(self.report.scale_port, self.report.scale_baudrate, "电子秤", check_data=True):
                self.report.scale_ok = False
                all_ok = False

        # 验证滚筒
        if self.report.roller_ok and self.report.roller_port:
            if not self._try_open_port(self.report.roller_port, self.report.roller_baudrate, "滚筒"):
                self.report.roller_ok = False
                all_ok = False

        return all_ok

    def _try_open_port(self, port, baudrate, label, check_data=False):
        """尝试打开串口，失败则杀占用进程后重试，仍失败返回False"""
        for attempt in range(2):
            try:
                ser = serial.Serial(port=port, baudrate=baudrate, timeout=1.5)
                if check_data:
                    time.sleep(0.8)
                    has_data = ser.in_waiting > 0
                    ser.close()
                    extra = " 有数据" if has_data else " 已连接（无数据）"
                    log(f"[验证] {label}: ✓ {port}{extra}")
                else:
                    ser.close()
                    log(f"[验证] {label}: ✓ {port} 已连接")
                return True
            except Exception as e:
                if attempt == 0:
                    log(f"[验证] {label}: × {port} 打开失败({e})，尝试杀占用进程...")
                    _kill_port_holder(port)
                else:
                    log(f"[验证] {label}: × {port} 重试仍失败")
        return False

    # ---- 读码器 ----
    def detect_camera(self):
        log("\n[读码器] 正在搜索...")
        if not SDK_OK:
            log("[读码器] MVS SDK未加载，跳过")
            self.report.errors.append("MVS SDK未加载")
            return

        deviceList = MV_CC_DEVICE_INFO_LIST()
        ret = MvCamera.MV_CC_EnumDevices(MV_GIGE_DEVICE | MV_USB_DEVICE, deviceList)
        if ret != 0 or deviceList.nDeviceNum == 0:
            log("[读码器] 未发现设备")
            self.report.errors.append("未发现读码器")
            return

        dev = cast(deviceList.pDeviceInfo[0], POINTER(MV_CC_DEVICE_INFO)).contents
        if dev.nTLayerType == MV_GIGE_DEVICE:
            nip = dev.SpecialInfo.stGigEInfo.nCurrentIp
            self.report.camera_ip = f"{(nip>>24)&0xFF}.{(nip>>16)&0xFF}.{(nip>>8)&0xFF}.{nip&0xFF}"
            self.report.camera_model = bytes(dev.SpecialInfo.stGigEInfo.chModelName).decode('utf-8', errors='ignore').rstrip('\x00')
            self.report.camera_sn = bytes(dev.SpecialInfo.stGigEInfo.chSerialNumber).decode('utf-8', errors='ignore').rstrip('\x00')

        self.report.camera_ok = True
        log(f"[读码器] 找到: {self.report.camera_model} IP:{self.report.camera_ip} SN:{self.report.camera_sn}")

    # ---- 串口设备（秤+滚筒） ----
    def detect_serial_devices(self):
        ports = serial.tools.list_ports.comports()
        if not ports:
            log("\n[串口] 未发现串口设备")
            return

        log(f"\n[串口] 发现 {len(ports)} 个串口:")
        for p in ports:
            log(f"  {p.device} - {p.description}")

        port_data = {}
        for p in ports:
            log(f"\n[串口] 探测 {p.device} ({p.description})...")
            result = self._probe_serial_port(p.device, p.description)
            if result:
                port_data[p.device] = result

        if port_data:
            self._ai_classify_ports(port_data)

    def _probe_serial_port(self, port, desc):
        results = {}
        for baud in COMMON_BAUDRATES:
            try:
                ser = serial.Serial(port=port, baudrate=baud, timeout=1.5,
                                    bytesize=serial.EIGHTBITS, parity=serial.PARITY_NONE, stopbits=serial.STOPBITS_ONE)

                # 清空缓冲区
                ser.reset_input_buffer()

                # 等待自动发送的数据（秤通常会持续发送重量）
                time.sleep(1.0)
                passive_data = b''
                if ser.in_waiting > 0:
                    passive_data = ser.read(ser.in_waiting)

                # 主动发送常见称重协议命令
                active_responses = {}
                for cmd_name, cmd_bytes in [
                    ("CR/LF", b'\r\n'),
                    ("W", b'W\r\n'),
                    ("P", b'P\r\n'),
                    ("S", b'S\r\n'),
                    ("SI", b'SI\r\n'),
                    ("IP", b'IP\r\n'),
                ]:
                    try:
                        ser.reset_input_buffer()
                        ser.write(cmd_bytes)
                        time.sleep(0.3)
                        if ser.in_waiting > 0:
                            resp = ser.read(ser.in_waiting)
                            active_responses[cmd_name] = resp
                    except Exception:
                        pass

                # 尝试发送滚筒指令
                roller_responses = {}
                for cmd_name, cmd_bytes in ROLLER_COMMANDS.items():
                    try:
                        ser.reset_input_buffer()
                        ser.write(cmd_bytes)
                        time.sleep(0.3)
                        if ser.in_waiting > 0:
                            resp = ser.read(ser.in_waiting)
                            roller_responses[cmd_name] = resp
                    except Exception:
                        pass

                ser.close()

                has_data = passive_data or active_responses or roller_responses
                if has_data:
                    results[baud] = {
                        'passive': passive_data.hex() if passive_data else '',
                        'passive_ascii': passive_data.decode('ascii', errors='replace') if passive_data else '',
                        'active': {k: v.hex() for k, v in active_responses.items()},
                        'active_ascii': {k: v.decode('ascii', errors='replace') for k, v in active_responses.items()},
                        'roller': {k: v.hex() for k, v in roller_responses.items()},
                    }
                    log(f"  波特率 {baud}: 有数据响应")
                    break  # 找到有响应的波特率就停

            except serial.SerialException:
                continue
            except Exception:
                continue

        if not results:
            log(f"  所有波特率均无响应")
            return None

        return {'description': desc, 'data': results}

    def _ai_classify_ports(self, port_data):
        prompt = "你是工业自动化设备识别专家。请分析以下串口探测数据，判断每个串口连接的是什么设备。\n\n"
        prompt += "可能的设备类型：\n"
        prompt += "1. 电子秤（会持续发送重量数据，格式通常含数字和单位如kg/g/lb）\n"
        prompt += "2. 埃里犀滚筒控制器（对0x85开头的指令有响应）\n"
        prompt += "3. 其他/未知设备\n\n"

        for port, info in port_data.items():
            prompt += f"串口 {port} ({info['description']}):\n"
            for baud, data in info['data'].items():
                prompt += f"  波特率 {baud}:\n"
                if data['passive']:
                    prompt += f"    被动接收(HEX): {data['passive'][:200]}\n"
                    prompt += f"    被动接收(ASCII): {data['passive_ascii'][:200]}\n"
                if data['active']:
                    for cmd, resp in data['active'].items():
                        prompt += f"    命令'{cmd}'响应(HEX): {resp[:100]}\n"
                    for cmd, resp in data['active_ascii'].items():
                        prompt += f"    命令'{cmd}'响应(ASCII): {resp[:100]}\n"
                if data['roller']:
                    for cmd, resp in data['roller'].items():
                        prompt += f"    滚筒指令'{cmd}'响应(HEX): {resp[:100]}\n"

        prompt += "\n请用JSON格式回答，格式如下（只输出JSON，不要其他文字）：\n"
        prompt += '{"ports": [{"port": "COMx", "device": "scale/roller/unknown", "baudrate": 9600, '
        prompt += '"confidence": "high/medium/low", "roller_type": "428/600/unknown", "reason": "判断原因"}]}'

        log("\n[AI] 正在分析串口数据...")
        answer = self.ai.ask(prompt, system_msg="你是工业自动化设备识别专家，只输出JSON格式结果。")
        log(f"[AI] 分析结果:\n{answer}")

        try:
            json_str = answer
            if '```' in json_str:
                json_str = json_str.split('```')[1]
                if json_str.startswith('json'):
                    json_str = json_str[4:]
                json_str = json_str.strip()
            result = json.loads(json_str)

            for item in result.get('ports', []):
                port = item.get('port', '')
                device = item.get('device', 'unknown')
                baud = item.get('baudrate', 9600)

                if device == 'scale':
                    self.report.scale_ok = True
                    self.report.scale_port = port
                    self.report.scale_baudrate = baud
                    self.report.scale_protocol = item.get('reason', '')
                    log(f"[AI] 电子秤: {port} @ {baud}bps")
                elif device == 'roller':
                    self.report.roller_ok = True
                    self.report.roller_port = port
                    self.report.roller_baudrate = baud
                    self.report.roller_type = item.get('roller_type', 'unknown')
                    log(f"[AI] 滚筒: {port} @ {baud}bps 型号:{self.report.roller_type}")

        except (json.JSONDecodeError, KeyError) as e:
            log(f"[AI] JSON解析失败: {e}")
            self.report.errors.append(f"AI分析结果解析失败: {e}")


# ============================================================
# 自动测试模块
# ============================================================
class AutoTester:
    def __init__(self, ai: AIAssistant, hw: HardwareReport):
        self.ai = ai
        self.hw = hw
        self.results = []

    def run_all_tests(self):
        log("\n" + "=" * 60)
        log("  第二阶段: 自动功能测试")
        log("=" * 60)

        # 读码器已验证通过，跳过重复测试
        if self.hw.camera_ok:
            self._record("读码器扫码", True, f"已验证通过 (型号:{self.hw.camera_model} IP:{self.hw.camera_ip})")
            log("\n[测试] 读码器: 已验证通过，跳过")
        else:
            self._record("读码器扫码", False, "读码器未连接")

        self.test_scale()
        self.test_roller()
        return self.results

    def test_scale(self):
        log("\n[测试] 电子秤测试...")
        if not self.hw.scale_ok:
            log("[测试] 电子秤未探测到，使用虚拟称重")
            self._record("电子秤", False, "未探测到电子秤，将使用虚拟称重模式")
            return

        try:
            ser = serial.Serial(port=self.hw.scale_port, baudrate=self.hw.scale_baudrate, timeout=2)
            time.sleep(1)
            data = b''
            if ser.in_waiting > 0:
                data = ser.read(ser.in_waiting)
            ser.close()

            if data:
                ascii_data = data.decode('ascii', errors='replace')
                self._record("电子秤", True, f"收到数据: {ascii_data.strip()}")
                log(f"[测试] 秤数据: {ascii_data.strip()}")

                weight = self._ai_parse_weight(ascii_data)
                if weight is not None:
                    self._record("电子秤解析", True, f"解析重量: {weight}kg")
                    log(f"[测试] 解析重量: {weight}kg")
            else:
                self._record("电子秤", False, "未收到数据")

        except Exception as e:
            self._record("电子秤", False, str(e))

    def _ai_parse_weight(self, raw_data):
        prompt = f"以下是电子秤串口返回的原始数据，请提取重量数值（单位kg）。只回答一个数字，不要其他文字。\n数据: {raw_data[:500]}"
        answer = self.ai.ask(prompt, max_tokens=50)
        try:
            return float(answer.strip().replace('kg', '').replace('g', '').strip())
        except ValueError:
            return None

    def test_roller(self):
        log("\n[测试] 滚筒控制测试...")
        if not self.hw.roller_ok:
            log("[测试] 滚筒未探测到，尝试所有串口...")
            self._brute_force_roller()
            if not self.hw.roller_ok:
                self._record("滚筒控制", False, "未找到滚筒控制器")
                return

        try:
            ser = serial.Serial(port=self.hw.roller_port, baudrate=self.hw.roller_baudrate, timeout=1)

            for cmd_name, cmd_bytes in ROLLER_COMMANDS.items():
                ser.reset_input_buffer()
                ser.write(cmd_bytes)
                time.sleep(0.5)
                resp = b''
                if ser.in_waiting > 0:
                    resp = ser.read(ser.in_waiting)

                hex_cmd = ' '.join(f'{b:02X}' for b in cmd_bytes)
                hex_resp = ' '.join(f'{b:02X}' for b in resp) if resp else '无响应'
                log(f"  {cmd_name}: 发送 {hex_cmd[:30]}... 响应: {hex_resp}")
                self._record(f"滚筒-{cmd_name}", True, f"已发送, 响应: {hex_resp}")

            ser.close()
            log("[测试] 滚筒指令全部发送完成")

        except Exception as e:
            self._record("滚筒控制", False, str(e))

    def _brute_force_roller(self):
        ports = serial.tools.list_ports.comports()
        for p in ports:
            if p.device == self.hw.scale_port:
                continue
            for baud in COMMON_BAUDRATES:
                try:
                    ser = serial.Serial(port=p.device, baudrate=baud, timeout=1)
                    cmd = ROLLER_COMMANDS['428_left']
                    ser.write(cmd)
                    time.sleep(0.5)
                    if ser.in_waiting > 0:
                        resp = ser.read(ser.in_waiting)
                        if resp and not self._is_scale_response(resp):
                            self.hw.roller_ok = True
                            self.hw.roller_port = p.device
                            self.hw.roller_baudrate = baud
                            log(f"[测试] 滚筒找到: {p.device} @ {baud}bps")
                            ser.close()
                            return
                    ser.close()
                except Exception:
                    continue

    @staticmethod
    def _is_scale_response(data: bytes) -> bool:
        """判断响应是否来自电子秤（ASCII格式 =XX.XXXX）"""
        try:
            text = data.decode('ascii', errors='ignore')
            return '=' in text and '.' in text
        except Exception:
            return False

    def _record(self, name, success, detail):
        self.results.append({'name': name, 'success': success, 'detail': detail, 'time': datetime.now().isoformat()})


# ============================================================
# 生产模式
# ============================================================
class ProductionMode:
    def __init__(self, ai: AIAssistant, hw: HardwareReport):
        global _tui
        self.ai = ai
        self.hw = hw
        self.cam = None
        self.scale_ser = None
        self.roller_ser = None
        self.recent_codes = {}
        self._last_display_set = set()
        self.stats = {'total': 0, 'success': 0, 'alarm_code': 0, 'alarm_weight': 0}
        self.tui = TUI()
        self.tui.hw_cam = hw.camera_ok
        self.tui.hw_scale = hw.scale_ok
        self.tui.hw_roller = hw.roller_ok
        _tui = self.tui
        self.upload_queue = UploadQueue()
        self._upload_worker_running = True
        self._pause_until = 0  # 暂停截止时间戳（后台上传发现异常时设置）
        self._pause_reason = ""
        self._upload_thread = threading.Thread(target=self._upload_worker, daemon=True)
        self._upload_thread.start()

    def _trigger_pause(self, seconds, reason):
        """后台线程触发主循环暂停"""
        self._pause_until = time.time() + seconds
        self._pause_reason = reason
        self._beep_alarm()
        self._tts_speak(reason)
        log(f"⚠ 后台异常暂停{seconds}秒: {reason}")
        self.tui.set_state("ALARM", _alarm_reason=reason)

    def _auto_adjust_exposure(self, brightness):
        """根据当前帧亮度动态调节曝光+增益，保持最佳条码识别质量"""
        TARGET = 130
        LOW, HIGH = 90, 170
        if LOW <= brightness <= HIGH:
            return
        ratio = TARGET / max(brightness, 1)
        ratio = max(0.5, min(2.5, ratio))
        new_exp = max(2000, min(80000, self._exposure_time * ratio))
        if abs(new_exp - self._exposure_time) < 500:
            return
        self._exposure_time = new_exp
        try:
            self.cam.MV_CC_SetFloatValue("ExposureTime", self._exposure_time)
        except Exception:
            return
        if brightness < 60 and self._exposure_time > 50000:
            try:
                self.cam.MV_CC_SetFloatValue("Gain", min(20.0, 16.0))
            except Exception:
                pass
        elif brightness > 180:
            try:
                self.cam.MV_CC_SetFloatValue("Gain", 8.0)
            except Exception:
                pass
        log(f"[曝光] 亮度{brightness} → 曝光{self._exposure_time/1000:.1f}ms")

    def _upload_worker(self):
        """后台线程：全量识别（QR+快递码）+ 上传"""
        while self._upload_worker_running:
            task = self.upload_queue.pop()
            if task is None:
                time.sleep(1)
                continue
            try:
                hires_path = task.get('img_path', '')
                thumb_path = task.get('thumb_path', '')
                known = task.get('known_codes', [])
                weight = task.get('weight_kg', 0)
                km = {c['data']: c['type'] for c in known}

                final_codes = list(known)
                deep_decoded = []
                deep_ok = False
                qr_found_by_bg = False
                diag = {}

                if hires_path:
                    waited = 0
                    for _w in range(30):
                        if os.path.exists(hires_path):
                            break
                        time.sleep(0.5)
                        waited += 1

                    file_exists = os.path.exists(hires_path)
                    file_size = os.path.getsize(hires_path) if file_exists else 0
                    diag["waited_rounds"] = waited
                    diag["file_exists"] = file_exists
                    diag["file_bytes"] = file_size

                    if file_exists and file_size > 0:
                        try:
                            raw_buf = np.fromfile(hires_path, dtype=np.uint8)
                            img = cv2.imdecode(raw_buf, cv2.IMREAD_GRAYSCALE)
                            diag["imread_ok"] = img is not None
                            if img is not None:
                                diag["img_shape"] = f"{img.shape[1]}x{img.shape[0]}"

                                # 如果主循环没扫到QR码，后台全量扫（thorough模式，增加旋转/增强尝试）
                                if not known:
                                    qr_hits = decode_barcodes(img, thorough=True)
                                    for bc in qr_hits:
                                        if bc['data'] not in km:
                                            final_codes.append(bc)
                                            km[bc['data']] = bc['type']
                                            qr_found_by_bg = True
                                            log(f"[队列] 后台识别QR码: {bc['data']}")
                                    diag["bg_qr_count"] = len(qr_hits)

                                # === 降级链 Level 1: zxing-cpp 深度解码 ===
                                deep = decode_barcodes_deep(img, km)
                                deep_ok = True
                                diag["deep_raw_count"] = len(deep)
                                new_from_deep = 0
                                for bc in deep:
                                    if bc['data'] not in km:
                                        final_codes.append(bc)
                                        deep_decoded.append(bc)
                                        km[bc['data']] = bc['type']
                                        new_from_deep += 1
                                        log(f"[队列] zxing深度解码: {bc['data']}")

                                has_express = any(
                                    not _is_valid_barcode(c['data']) is False and
                                    any(c['data'].upper().startswith(p) for p in _EXPRESS_PREFIXES)
                                    or (c['data'].isdigit() and len(c['data']) >= 12)
                                    for c in final_codes
                                    if c.get('type', '') != 'QR Code'
                                )

                                # === 降级链 Level 2: Dynamsoft Barcode Reader ===
                                if not has_express and DYNAMSOFT_OK:
                                    try:
                                        ds_hits = _dynamsoft_decode(img)
                                        diag["dynamsoft_count"] = len(ds_hits)
                                        for txt, fmt in ds_hits.items():
                                            if txt not in km:
                                                bc_item = {'data': txt, 'type': f"DS:{fmt}"}
                                                final_codes.append(bc_item)
                                                deep_decoded.append(bc_item)
                                                km[txt] = f"DS:{fmt}"
                                                log(f"[队列] Dynamsoft解码: {txt}")
                                    except Exception as e:
                                        diag["dynamsoft_error"] = str(e)

                                # 重新检查是否有快递码
                                has_express = any(
                                    any(c['data'].upper().startswith(p) for p in _EXPRESS_PREFIXES)
                                    or (c['data'].isdigit() and len(c['data']) >= 12 and c.get('type', '') != 'QR Code')
                                    for c in final_codes
                                )

                                # === 降级链 Level 3: 阿里云 OCR 通用文字识别 ===
                                if not has_express and ALIYUN_OCR_OK:
                                    try:
                                        ok_enc, jpg_buf = cv2.imencode('.jpg', img, [cv2.IMWRITE_JPEG_QUALITY, 85])
                                        if ok_enc:
                                            ocr_result = _aliyun_ocr_waybill(jpg_buf.tobytes())
                                            diag["aliyun_ocr_result"] = ocr_result
                                            if ocr_result and ocr_result not in km:
                                                bc_item = {'data': ocr_result, 'type': 'OCR'}
                                                final_codes.append(bc_item)
                                                deep_decoded.append(bc_item)
                                                km[ocr_result] = 'OCR'
                                                log(f"[队列] 阿里云OCR识别: {ocr_result}")
                                    except Exception as e:
                                        diag["aliyun_ocr_error"] = str(e)

                                # === 失败图片采样上传 ===
                                _has_qr = any(c.get('type', '') == 'QR Code' or
                                              (c['data'].isdigit() and len(c['data']) <= 10)
                                              for c in final_codes)
                                _has_exp = any(
                                    any(c['data'].upper().startswith(p) for p in _EXPRESS_PREFIXES)
                                    or (c['data'].isdigit() and len(c['data']) >= 12 and c.get('type', '') != 'QR Code')
                                    for c in final_codes
                                )
                                if not _has_exp:
                                    self._upload_fail_image(img, weight, final_codes, diag)

                        except Exception as e:
                            diag["deep_error"] = str(e)
                            log(f"[队列] 解码异常: {e}")

                        try:
                            os.remove(hires_path)
                        except Exception:
                            pass
                    elif file_exists and file_size == 0:
                        diag["issue"] = "file_empty"
                    else:
                        diag["issue"] = "file_missing_after_wait"

                # 如果后台也没找到QR码，记录报警但仍然上传（带空单号）
                if not final_codes:
                    diag["issue"] = "no_barcode_found"
                    log(f"[队列] ⚠ 未识别到任何条码，仍上传（重量{weight}kg）")

                decode_info = {
                    "quick_codes": len(known),
                    "bg_qr": qr_found_by_bg,
                    "deep_codes": len(deep_decoded),
                    "total_codes": len(final_codes),
                    "deep_attempted": bool(hires_path),
                    "deep_success": deep_ok,
                    "all_codes": [{"data": c["data"], "type": c["type"]} for c in final_codes],
                    "diag": diag,
                }

                tickets_num, express_number = self._classify_barcodes(final_codes)
                ok, msg = self._upload_scan(tickets_num, express_number, weight, decode_info=decode_info)

                if not ok and msg and msg != "条码为空":
                    self._trigger_pause(10, msg)

            except Exception as e:
                log(f"[队列] 处理失败: {e}")
                self.upload_queue.add(task)
                time.sleep(5)

    @staticmethod
    def _classify_barcodes(codes):
        """Separate barcodes into (tickets_num, express_number).
        Internal QR labels: 9-digit, prefix 08/09, type QR Code.
        Express barcodes: 13-digit (prefix 82) or letter-prefixed, type Code 128 etc."""
        tickets_num = ""
        express_number = ""

        def _is_internal_label(d, bc_type):
            if not d.isdigit():
                return False
            if bc_type == "QR Code":
                return True
            if len(d) <= 10 and d[:2] in ("08", "09"):
                return True
            return False

        for bc in codes:
            d = bc['data'].strip()
            bc_type = bc.get('type', '')

            if _is_internal_label(d, bc_type):
                if not tickets_num:
                    tickets_num = d
            elif any(d.upper().startswith(p) for p in _EXPRESS_PREFIXES):
                if not express_number:
                    express_number = d
            elif d.isdigit() and len(d) >= 12:
                if not express_number:
                    express_number = d
            elif not tickets_num:
                tickets_num = d
            elif not express_number:
                express_number = d

        return tickets_num, express_number

    def _upload_fail_image(self, img, weight, codes, diag):
        """采样上传未识别快递码的图片到云端，供人工排查"""
        try:
            cfg = {}
            if os.path.exists(CONFIG_FILE):
                with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
                    cfg = json.load(f)
            server = cfg.get('backend_url', BACKEND_URL)
            machine = cfg.get('machine_number', MACHINE_NUMBER)
            small = _shrink(img, 800)
            ok_enc, buf = cv2.imencode('.jpg', small, [cv2.IMWRITE_JPEG_QUALITY, 75])
            if not ok_enc:
                return
            img_b64 = base64.b64encode(buf.tobytes()).decode()
            payload = {
                "machine_number": machine,
                "client_version": VERSION,
                "weight": weight,
                "codes": [{"data": c["data"], "type": c.get("type", "")} for c in codes],
                "diag": diag,
                "image_b64": img_b64,
            }
            requests.post(f"{server}/api/device/fail-image", json=payload, timeout=8)
        except Exception:
            pass

    def _upload_scan(self, tickets_num, express_number, weight_kg, decode_info=None):
        """Upload scan result. Returns (success: bool, error_msg: str or None)"""
        try:
            cfg = {}
            if os.path.exists(CONFIG_FILE):
                with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
                    cfg = json.load(f)
            machine = cfg.get('machine_number', MACHINE_NUMBER)
            server = cfg.get('backend_url', BACKEND_URL)

            payload = {
                "tickets_num": tickets_num,
                "express_number": express_number,
                "weight": weight_kg,
                "machine_number": machine,
                "client_version": VERSION,
            }
            if decode_info:
                payload["decode_info"] = decode_info
            resp = requests.post(
                f"{server}/api/device/scan-push",
                json=payload, timeout=5
            )
            result = resp.json()
            msg = result.get("message", "")
            if result.get("success"):
                data = result.get("data", {})
                sku = data.get("sku_name", "")
                info = f"SKU:{sku}" if sku else ""
                log(f"✓ 已上传: {msg} {info}")
                return True, None
            else:
                log(f"⚠ 上传异常: {msg}")
                return False, msg
        except Exception as e:
            log(f"⚠ 上传失败(不影响生产): {e}")
            return True, None  # 网络异常不触发暂停

    def start(self):
        log("\n" + "=" * 60)
        log("  第三阶段: 进入生产模式")
        log("=" * 60)

        if not self._init_devices():
            return

        self.tui.set_state("INIT")
        chain = []
        if ZXING_OK:
            chain.append("zxing-cpp")
        elif PYZBAR_OK:
            chain.append("pyzbar")
        if DYNAMSOFT_OK:
            chain.append("Dynamsoft")
        if ALIYUN_OCR_OK:
            chain.append("阿里云OCR")
        if chain:
            log(f"[解码器] 降级链: {' → '.join(chain)}")
        else:
            log("[解码器] 警告: 无解码库!")
        log(f"[生产] 重量范围: {WEIGHT_MIN_KG}~{WEIGHT_MAX_KG}kg")

        data_buf = (c_ubyte * self._payload_size)()
        frame_info = MV_FRAME_OUT_INFO_EX()
        waiting_printed = False
        cycle_count = 0
        frame_count = 0
        first_frame_logged = False
        save_counter = 0
        save_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "scan_frames")
        os.makedirs(save_dir, exist_ok=True)
        pending = self.upload_queue.pending_count()
        if pending > 0:
            log(f"[队列] 恢复 {pending} 个待上传任务")
        log(f"帧保存目录: {save_dir}")

        try:
            while True:
                # ── 检查后台暂停信号 ──
                if time.time() < self._pause_until:
                    remain = int(self._pause_until - time.time())
                    self.tui.set_state("ALARM", _alarm_reason=f"{self._pause_reason} (暂停{remain}s)")
                    time.sleep(1)
                    # 排空相机缓冲区
                    for _ in range(5):
                        if self.cam.MV_CC_GetOneFrameTimeout(byref(data_buf), self._payload_size, frame_info, 10) != 0:
                            break
                    continue
                elif self._pause_reason:
                    self._pause_reason = ""
                    self.tui.set_state("WAITING")
                    waiting_printed = True

                # ── 先检测秤：有重量才拍照 ──
                if not self._has_weight(0.15):
                    if not waiting_printed:
                        self.tui.set_state("WAITING")
                        waiting_printed = True
                    time.sleep(0.05)
                    for _ in range(5):
                        if self.cam.MV_CC_GetOneFrameTimeout(byref(data_buf), self._payload_size, frame_info, 10) != 0:
                            break
                    continue

                # ======== 有重量 → 立即称重 ========
                weight_kg = self._read_weight()

                # ======== 拍照（取最新帧）========
                got_frame = False
                for _ in range(5):
                    ret = self.cam.MV_CC_GetOneFrameTimeout(byref(data_buf), self._payload_size, frame_info, 15)
                    if ret == 0:
                        got_frame = True
                    else:
                        break

                if not got_frame:
                    time.sleep(0.05)
                    continue

                frame_count += 1
                img = convert_frame_to_image(data_buf, frame_info)

                if not first_frame_logged:
                    first_frame_logged = True
                    pt_hex = f"0x{frame_info.enPixelType:08X}" if hasattr(frame_info, 'enPixelType') else "?"
                    log(f"[帧] {frame_info.nWidth}x{frame_info.nHeight} 格式={pt_hex}")

                if img is None:
                    continue

                brightness = int(img.mean())
                self.tui.brightness = brightness
                if frame_count == 1:
                    log(f"[帧] 亮度={brightness} {img.shape[1]}x{img.shape[0]}")
                if frame_count % 10 == 0:
                    self._auto_adjust_exposure(brightness)

                # ======== 校验重量（不稳定时重试一次）========
                if not (WEIGHT_MIN_KG <= weight_kg <= WEIGHT_MAX_KG):
                    time.sleep(0.3)
                    weight_kg = self._read_weight()
                    if not (WEIGHT_MIN_KG <= weight_kg <= WEIGHT_MAX_KG):
                        self.stats['alarm_weight'] += 1
                        self.tui.stats = self.stats.copy()
                        reason = f"重量不符! {weight_kg:.3f}kg 超出{WEIGHT_MIN_KG}~{WEIGHT_MAX_KG}kg"
                        self._trigger_pause(10, reason)
                        self._last_display_set = set()
                        waiting_printed = False
                        continue

                # ======== 极速扫码：QR + Code128 并行识别(~100ms) ========
                self.tui.set_state("SCANNING")
                now_ts = time.time()
                new_codes = []
                quick_hits = {}

                tiny = _shrink(img, 640)
                # 1. QR码极速扫描
                quick_hits = _zxing_single(tiny, "QR640", False, formats=_FMT_QR)
                if not quick_hits:
                    quick_hits = _zxing_single(_apply_clahe(_shrink(img, 800)), "QR800C", False, formats=_FMT_QR)
                if not quick_hits:
                    quick_hits = _zxing_single(tiny, "Any640", False)

                # 2. 额外 Code128 快扫（找快递码，无论QR是否已扫到）
                c128_hits = _zxing_single(_shrink(img, 1000), "C128q", False, formats=_FMT_LINEAR)
                if c128_hits:
                    quick_hits.update(c128_hits)

                cooldown_filtered = False
                if quick_hits:
                    for data, fmt_str in quick_hits.items():
                        last = self.recent_codes.get(data)
                        if last is None or (now_ts - last) >= COOLDOWN_SECONDS:
                            new_codes.append({'data': data, 'type': fmt_str})
                        else:
                            cooldown_filtered = True

                # ======== 扫到码 → 保存+传送；没扫到 → 继续重试 ========
                if not new_codes:
                    if cooldown_filtered:
                        # 扫到码了但在冷却期内（刚传送过同一个码），跳过不重试
                        time.sleep(0.1)
                        continue
                    # 真的没扫到码：继续抓下一帧重试
                    if not hasattr(self, '_no_code_streak'):
                        self._no_code_streak = 0
                    self._no_code_streak += 1
                    if self._no_code_streak == 1:
                        self.tui.set_state("SCANNING")
                    if self._no_code_streak >= 15:
                        # 连续15帧(约2秒)都没扫到码，强制传送并上传无码记录
                        self._no_code_streak = 0
                        self.stats['total'] += 1
                        self.stats['alarm_code'] += 1
                        cycle_count += 1
                        self.tui.stats = self.stats.copy()
                        log(f"⚠ 连续未识别到码 #{cycle_count} | {weight_kg:.3f}kg | 强制传送")
                        self.tui.set_state("ALARM", _alarm_reason="未识别到条码")
                        self._beep_alarm()

                        save_counter += 1
                        thumb_name = f"{save_counter}_0c_nocode.jpg"
                        thumb_path = os.path.join(save_dir, thumb_name)
                        hires_name = f"{save_counter}_0c_nocode_hd.png"
                        hires_path = os.path.join(save_dir, hires_name)
                        _im = img.copy()
                        _tp, _hp = thumb_path, hires_path
                        def _save_nocode(im=_im, tp=_tp, hp=_hp):
                            try:
                                small = _shrink(im, 800)
                                ok, buf = cv2.imencode('.jpg', small, [cv2.IMWRITE_JPEG_QUALITY, 80])
                                if ok:
                                    with open(tp, 'wb') as f: f.write(buf.tobytes())
                                ok2, buf2 = cv2.imencode('.png', im)
                                if ok2:
                                    with open(hp, 'wb') as f: f.write(buf2.tobytes())
                            except Exception: pass
                        threading.Thread(target=_save_nocode, daemon=True).start()

                        self.upload_queue.add({
                            'id': f"{save_counter}_{int(now_ts)}",
                            'img_path': hires_path, 'thumb_path': thumb_path,
                            'known_codes': [], 'weight_kg': weight_kg, 'ts': now_ts,
                        })
                        self._activate_roller()
                        time.sleep(0.5)
                        _leave_start = time.time()
                        while (time.time() - _leave_start) < 3.0:
                            for _ in range(3):
                                if self.cam.MV_CC_GetOneFrameTimeout(byref(data_buf), self._payload_size, frame_info, 10) != 0: break
                            if not self._has_weight(0.15): break
                            time.sleep(0.08)
                        self._last_display_set = set()
                        waiting_printed = False
                    continue

                # ======== 扫到码 → 保存 + 立即传送 ========
                self._no_code_streak = 0
                waiting_printed = False
                self.stats['total'] += 1
                cycle_count += 1

                for bc in new_codes:
                    log(f"扫到: [{bc['type']}] {bc['data']}")
                    self.recent_codes[bc['data']] = now_ts
                self._last_display_set = set(bc['data'] for bc in new_codes)
                self.stats['success'] += 1
                self.tui.stats = self.stats.copy()
                self.tui.set_state("SUCCESS", last_codes=list(new_codes), last_weight=weight_kg)
                self._beep_success()
                log(f"✓ 出库 #{cycle_count} | {weight_kg:.3f}kg | 码={len(new_codes)}")

                save_counter += 1
                codes_tag = "_".join(c['data'][:10] for c in new_codes)
                thumb_name = f"{save_counter}_{len(new_codes)}c_{codes_tag}.jpg"
                thumb_path = os.path.join(save_dir, thumb_name)
                hires_name = f"{save_counter}_{len(new_codes)}c_{codes_tag}_hd.png"
                hires_path = os.path.join(save_dir, hires_name)

                _im = img.copy()
                _tp, _hp = thumb_path, hires_path
                def _save_both(im=_im, tp=_tp, hp=_hp):
                    try:
                        small = _shrink(im, 800)
                        ok, buf = cv2.imencode('.jpg', small, [cv2.IMWRITE_JPEG_QUALITY, 80])
                        if ok:
                            with open(tp, 'wb') as f: f.write(buf.tobytes())
                        ok2, buf2 = cv2.imencode('.png', im)
                        if ok2:
                            with open(hp, 'wb') as f: f.write(buf2.tobytes())
                    except Exception: pass
                threading.Thread(target=_save_both, daemon=True).start()

                self.upload_queue.add({
                    'id': f"{save_counter}_{int(now_ts)}",
                    'img_path': hires_path, 'thumb_path': thumb_path,
                    'known_codes': new_codes[:], 'weight_kg': weight_kg, 'ts': now_ts,
                })

                self._activate_roller()
                time.sleep(0.5)

                # 等待物品离开秤面（重量降到阈值以下），最多等3秒
                _leave_start = time.time()
                _left = False
                while (time.time() - _leave_start) < 3.0:
                    for _ in range(3):
                        if self.cam.MV_CC_GetOneFrameTimeout(byref(data_buf), self._payload_size, frame_info, 10) != 0:
                            break
                    if not self._has_weight(0.15):
                        _left = True
                        break
                    time.sleep(0.08)

                if not _left:
                    log(f"⚠ 物品未离开秤面(3s超时)，可能滚筒未转动")

                self._last_display_set = set()
                waiting_printed = False

                expired = [k for k, v in self.recent_codes.items() if (now_ts - v) > COOLDOWN_SECONDS * 2]
                for k in expired:
                    del self.recent_codes[k]

        except KeyboardInterrupt:
            pass

        self._cleanup()
        self.tui.set_state("IDLE")
        log(f"生产结束 | 总计{self.stats['total']} 成功{self.stats['success']} 码不全{self.stats['alarm_code']} 重量不符{self.stats['alarm_weight']}")

    def _init_devices(self):
        # 读码器
        if not self.hw.camera_ok or not SDK_OK:
            log("[生产] 读码器不可用，无法启动")
            return False

        self.cam = MvCamera()
        deviceList = MV_CC_DEVICE_INFO_LIST()
        MvCamera.MV_CC_EnumDevices(MV_GIGE_DEVICE | MV_USB_DEVICE, deviceList)

        if deviceList.nDeviceNum == 0:
            log("[生产] 未发现读码器设备")
            return False

        log(f"[生产] 发现 {deviceList.nDeviceNum} 个设备，逐个尝试连接...")
        opened = False
        # MV_ACCESS_Exclusive=1, MV_ACCESS_ExclusiveWithSwitch=3 (强制抢占)
        access_modes = [
            (1, "独占模式"),
            (3, "强制抢占模式"),
        ]
        for mode_val, mode_name in access_modes:
            if opened:
                break
            for idx in range(deviceList.nDeviceNum):
                stDev = cast(deviceList.pDeviceInfo[idx], POINTER(MV_CC_DEVICE_INFO)).contents
                self.cam = MvCamera()
                self.cam.MV_CC_CreateHandle(stDev)
                ret = self.cam.MV_CC_OpenDevice(mode_val, 0)
                if ret == 0:
                    log(f"[生产] 设备[{idx}] 以{mode_name}打开成功")
                    opened = True
                    break
                else:
                    self.cam.MV_CC_DestroyHandle()
            if not opened and mode_val == 1:
                log(f"[生产] 独占模式失败，尝试强制抢占...")

        if not opened:
            log("[生产] 所有设备均无法打开，请检查网线连接")
            return False

        if stDev.nTLayerType == MV_GIGE_DEVICE:
            pkt = self.cam.MV_CC_GetOptimalPacketSize()
            if pkt > 0:
                self.cam.MV_CC_SetIntValue("GevSCPSPacketSize", pkt)

        # 尝试设置为Mono8格式（灰度，最适合条码解码）
        ret_pf = self.cam.MV_CC_SetEnumValue("PixelFormat", 0x01080001)
        if ret_pf == 0:
            log("[生产] 已切换为Mono8像素格式")
        else:
            log(f"[生产] 像素格式保持默认 (切换Mono8返回: 0x{ret_pf:08X})")

        self.cam.MV_CC_SetEnumValue("TriggerMode", 0)

        # 开启补光灯 + 曝光/增益设置
        try:
            led_ok = False
            # 方式1: DeviceLightSource 节点（海康读码器常用）
            for i in range(2):
                r1 = self.cam.MV_CC_SetEnumValue("DeviceLightSourceSelector", i)
                if r1 == 0:
                    try:
                        r2 = self.cam.MV_CC_SetBoolValue("LightSourceEnable", True)
                        if r2 == 0:
                            led_ok = True
                            log(f"[生产] 补光灯{i} 已开启")
                    except (AttributeError, Exception) as e:
                        log(f"[生产] 补光灯{i} SetBool失败: {e}")

            # 方式2: IO线路控制（Strobe闪光灯）
            if not led_ok:
                for line in [0, 1, 2]:
                    r = self.cam.MV_CC_SetEnumValue("LineSelector", line)
                    if r == 0:
                        self.cam.MV_CC_SetEnumValue("LineMode", 8)  # Strobe
                        log(f"[生产] IO Line{line} 已设为Strobe模式")
                        led_ok = True
                        break

            if not led_ok:
                log("[生产] 补光灯节点未找到，提高曝光和增益补偿")
        except Exception as e:
            log(f"[生产] 补光灯设置异常: {e}")

        # 关闭自动曝光/增益，使用手动模式避免过曝反光
        try:
            self.cam.MV_CC_SetEnumValue("ExposureAuto", 0)  # Off
            self.cam.MV_CC_SetEnumValue("GainAuto", 0)      # Off
        except Exception:
            pass

        # 手动曝光: 从15ms开始（更亮），后续根据亮度自动调整
        self._exposure_time = 15000.0  # 15ms初始值（比10ms更亮）
        try:
            r = self.cam.MV_CC_SetFloatValue("ExposureTime", self._exposure_time)
            log(f"[生产] 手动曝光: {self._exposure_time/1000:.0f}ms (ret={r})")
        except AttributeError:
            log("[生产] SetFloatValue不可用")

        try:
            self.cam.MV_CC_SetFloatValue("Gain", 12.0)
            log("[生产] 手动增益: 12dB")
        except (AttributeError, Exception):
            pass

        # 锐度增强（如相机支持）
        try:
            self.cam.MV_CC_SetBoolValue("SharpnessEnable", True)
            self.cam.MV_CC_SetIntValue("Sharpness", 3)
            log("[生产] 硬件锐化: Level 3")
        except (AttributeError, Exception):
            pass

        stParam = MVCC_INTVALUE()
        self.cam.MV_CC_GetIntValue("PayloadSize", stParam)
        self._payload_size = stParam.nCurValue

        self.cam.MV_CC_StartGrabbing()

        # 自动调整曝光，目标亮度100-160（条码需要足够的对比度和亮度）
        warmup_buf = (c_ubyte * self._payload_size)()
        warmup_info = MV_FRAME_OUT_INFO_EX()
        TARGET_LOW, TARGET_HIGH = 100, 160
        for attempt in range(15):
            ret = self.cam.MV_CC_GetOneFrameTimeout(byref(warmup_buf), self._payload_size, warmup_info, 1000)
            if ret != 0:
                continue
            if attempt < 2:
                continue
            frame_data = bytes(warmup_buf[:warmup_info.nFrameLen])
            w_f, h_f = warmup_info.nWidth, warmup_info.nHeight
            if warmup_info.enPixelType == 0x01080001 and len(frame_data) == w_f * h_f:
                arr = np.frombuffer(frame_data, dtype=np.uint8)
                brightness = int(arr.mean())
                if TARGET_LOW <= brightness <= TARGET_HIGH:
                    log(f"[生产] 曝光校准完成: 亮度={brightness} 曝光={self._exposure_time/1000:.1f}ms")
                    break
                # 按比例调整曝光，目标中心值130
                ratio = 130.0 / max(brightness, 1)
                self._exposure_time = max(1000, min(100000, self._exposure_time * ratio))
                try:
                    self.cam.MV_CC_SetFloatValue("ExposureTime", self._exposure_time)
                except Exception:
                    break
                log(f"[生产] 亮度={brightness} → 调整曝光到 {self._exposure_time/1000:.1f}ms")
        else:
            log(f"[生产] 曝光校准未收敛，当前曝光={self._exposure_time/1000:.1f}ms")

        # 电子秤
        if self.hw.scale_ok:
            self.scale_ser = self._open_serial_with_retry(
                self.hw.scale_port, self.hw.scale_baudrate, "电子秤")
            if not self.scale_ser:
                log("[生产] 电子秤连接失败，使用虚拟称重")
        else:
            log("[生产] 电子秤未连接，使用虚拟称重")

        # 滚筒
        if self.hw.roller_ok:
            self.roller_ser = self._open_serial_with_retry(
                self.hw.roller_port, self.hw.roller_baudrate, "滚筒")
            if not self.roller_ser:
                log("[生产] 滚筒连接失败，使用虚拟滚筒")
        else:
            log("[生产] 滚筒未连接，使用虚拟滚筒")

        return True

    def _open_serial_with_retry(self, port, baudrate, label):
        """打开串口，失败则杀占用进程重试"""
        for attempt in range(2):
            try:
                ser = serial.Serial(
                    port=port, baudrate=baudrate,
                    bytesize=serial.EIGHTBITS,
                    parity=serial.PARITY_NONE,
                    stopbits=serial.STOPBITS_ONE,
                    timeout=1
                )
                log(f"[生产] {label}已连接: {port} @ {baudrate}bps")
                return ser
            except Exception as e:
                if attempt == 0:
                    log(f"[生产] {label} {port} 打开失败({e})，杀占用进程重试...")
                    _kill_port_holder(port)
                else:
                    log(f"[生产] {label} {port} 重试仍失败: {e}")
        return None

    def _read_weight(self):
        """读取电子秤重量，等待读数稳定后返回（避免物品刚放上时的抖动）"""
        if self.scale_ser:
            try:
                self.scale_ser.reset_input_buffer()
                readings = []
                for attempt in range(6):
                    time.sleep(0.08)
                    if self.scale_ser.in_waiting > 0:
                        data = self.scale_ser.read(self.scale_ser.in_waiting)
                        raw = data.decode('ascii', errors='replace')
                        val = self._extract_weight(raw)
                        if val is not None:
                            readings.append(val)
                            if len(readings) >= 3:
                                last3 = readings[-3:]
                                spread = max(last3) - min(last3)
                                if spread < 0.05:
                                    return round(sum(last3) / 3.0, 3)
                if readings:
                    return round(readings[-1], 3)
            except Exception as e:
                log(f"[秤错误] {e}")

        import random
        return round(random.uniform(0.5, 6.0), 2)

    def _has_weight(self, threshold=0.15):
        """快速检测秤上是否有物体（等待一次秤数据再判断）"""
        if not self.scale_ser:
            return True
        try:
            # 秤通常每 50-100ms 发送一次，等待最多 150ms 确保有新数据
            for _ in range(3):
                if self.scale_ser.in_waiting > 0:
                    break
                time.sleep(0.05)
            if self.scale_ser.in_waiting > 0:
                data = self.scale_ser.read(self.scale_ser.in_waiting)
                raw = data.decode('ascii', errors='replace')
                val = self._extract_weight(raw)
                if val is not None and val >= threshold:
                    return True
                if val is not None:
                    return False
            return False
        except Exception:
            return True

    def _extract_weight(self, raw):
        """从秤的原始数据中提取重量（取出现最多的数值=稳定读数）"""
        import re
        from collections import Counter
        matches = re.findall(r'=?\s*([+-]?\d+\.\d+)', raw)
        if not matches:
            matches = re.findall(r'([+-]?\d+\.?\d*)', raw)
        if not matches:
            return None

        values = []
        for m in matches:
            try:
                v = float(m)
                if v >= 0:
                    values.append(round(v, 4))
            except ValueError:
                continue

        if not values:
            return None

        counter = Counter(values)
        most_common = counter.most_common(1)[0][0]

        # 秤串口数字反序: 去掉小数点，整个数字串翻转，再放回4位小数
        # 76.0000 → "760000" → 翻转 "000067" → 插4位小数 "00.0067" → 0.0067? 不对
        # 实测: 76.0000→0.67, 所以规律是: 取格式化字符串翻转后重新解析
        raw_str = f"{most_common:.4f}"
        digits_only = raw_str.replace('.', '')
        reversed_digits = digits_only[::-1]
        # 在同样位置（倒数第4位）插入小数点
        dot_pos = raw_str.index('.')
        new_dot_pos = len(reversed_digits) - dot_pos
        result_str = reversed_digits[:new_dot_pos] + '.' + reversed_digits[new_dot_pos:]
        kg = float(result_str)
        log(f"[秤解析] '{raw_str}' → 翻转 → '{result_str}' → {kg:.4f}kg")
        return kg

    def _activate_roller(self):
        """控制滚筒: 发送启动 → 异步延时发送停止（不阻塞主线程）"""
        if self.roller_ser:
            sent = False
            for attempt in range(2):
                try:
                    self.roller_ser.write(ROLLER_START)
                    self.roller_ser.flush()
                    sent = True
                    log(f"滚筒启动")
                    break
                except Exception as e:
                    log(f"滚筒发送失败(尝试{attempt+1}): {e}")
                    try:
                        self.roller_ser.close()
                        self.roller_ser = serial.Serial(
                            port=self.hw.roller_port,
                            baudrate=self.hw.roller_baudrate,
                            bytesize=serial.EIGHTBITS,
                            parity=serial.PARITY_NONE,
                            stopbits=serial.STOPBITS_ONE,
                            timeout=1
                        )
                        log(f"滚筒串口已重连: {self.hw.roller_port}")
                    except Exception as e2:
                        log(f"滚筒重连失败: {e2}")

            if sent:
                roll_sec = max(ROLLER_DURATION_MS / 1000.0, 1.2)
                ser = self.roller_ser
                def _delayed_stop(s=ser, t=roll_sec):
                    time.sleep(t)
                    try:
                        s.write(ROLLER_STOP)
                        s.flush()
                    except Exception:
                        pass
                threading.Thread(target=_delayed_stop, daemon=True).start()
        else:
            log(f"[虚拟] 滚筒向前")

    def _alarm_loop(self, reason, data_buf, frame_info):
        """持续播报，最长 ALARM_MAX_SECONDS 秒。期间检测新码可提前退出"""
        start = time.time()
        self._beep_alarm()
        self._tts_speak(reason)
        last_speak = start

        while (time.time() - start) < ALARM_MAX_SECONDS:
            remain = ALARM_MAX_SECONDS - int(time.time() - start)
            self.tui._alarm_reason = f"{reason} ({remain}s)"
            self.tui.refresh()

            # 报警期间每0.5秒检测一次，看是否换了新包裹
            for _ in range(int(ALARM_REPEAT_INTERVAL / 0.5)):
                time.sleep(0.5)
                if (time.time() - start) >= ALARM_MAX_SECONDS:
                    break
                try:
                    ret = self.cam.MV_CC_GetOneFrameTimeout(byref(data_buf), self._payload_size, frame_info, 50)
                    if ret == 0:
                        test_img = convert_frame_to_image(data_buf, frame_info)
                        if test_img is not None:
                            test_codes = decode_barcodes(test_img)
                            if len(test_codes) >= REQUIRED_CODES:
                                new_set = set(c['data'] for c in test_codes)
                                old_set = set(c['data'] for c in (self.tui.last_codes or []))
                                if new_set != old_set:
                                    log(f"检测到新包裹({len(test_codes)}码)，提前结束报警")
                                    self._beep_success()
                                    # 清空缓冲
                                    for _ in range(10):
                                        self.cam.MV_CC_GetOneFrameTimeout(byref(data_buf), self._payload_size, frame_info, 50)
                                    return
                            elif not test_codes:
                                log("包裹已移走，提前结束报警")
                                for _ in range(10):
                                    self.cam.MV_CC_GetOneFrameTimeout(byref(data_buf), self._payload_size, frame_info, 50)
                                return
                except Exception:
                    pass

            if (time.time() - start) < ALARM_MAX_SECONDS:
                self._beep_alarm()
                self._tts_speak(reason)

        log("报警超时结束，恢复扫码")
        for _ in range(10):
            self.cam.MV_CC_GetOneFrameTimeout(byref(data_buf), self._payload_size, frame_info, 100)

    def _tts_speak(self, text):
        """跨平台TTS语音播报"""
        import subprocess, sys, threading
        def _do():
            try:
                if sys.platform == 'win32':
                    ps_cmd = f"Add-Type -AssemblyName System.Speech; $s=New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.Rate=3; $s.Volume=100; $s.Speak('{text}')"
                    subprocess.run(['powershell', '-NoProfile', '-NonInteractive', '-Command', ps_cmd],
                                   timeout=15, capture_output=True, creationflags=0x08000000)
                else:
                    subprocess.run(['espeak', '-v', 'zh', text], timeout=10, capture_output=True)
            except Exception:
                pass
        threading.Thread(target=_do, daemon=True).start()

    def _beep_success(self):
        """成功提示音：短促一声"""
        import threading
        def _do():
            try:
                import sys
                if sys.platform == 'win32':
                    import winsound
                    winsound.Beep(1000, 200)
                else:
                    print('\a', end='', flush=True)
            except Exception:
                pass
        threading.Thread(target=_do, daemon=True).start()

    def _beep_alarm(self):
        """报警提示音：三声急促"""
        import threading
        def _do():
            try:
                import sys, time as _t
                if sys.platform == 'win32':
                    import winsound
                    for _ in range(3):
                        winsound.Beep(2000, 300)
                        _t.sleep(0.1)
                else:
                    for _ in range(3):
                        print('\a', end='', flush=True)
                        _t.sleep(0.3)
            except Exception:
                pass
        threading.Thread(target=_do, daemon=True).start()

    def _cleanup(self):
        try:
            if self.cam:
                self.cam.MV_CC_StopGrabbing()
                self.cam.MV_CC_CloseDevice()
                self.cam.MV_CC_DestroyHandle()
        except Exception:
            pass
        try:
            if self.scale_ser:
                self.scale_ser.close()
        except Exception:
            pass
        try:
            if self.roller_ser:
                self.roller_ser.close()
        except Exception:
            pass


# ============================================================
# 报告生成
# ============================================================
class ReportGenerator:
    def __init__(self, ai: AIAssistant, hw: HardwareReport, test_results: list):
        self.ai = ai
        self.hw = hw
        self.test_results = test_results

    def generate(self):
        log("\n" + "=" * 60)
        log("  第四阶段: AI生成测试报告")
        log("=" * 60)

        report_data = {
            "hardware": {
                "camera": {"ok": self.hw.camera_ok, "model": self.hw.camera_model, "ip": self.hw.camera_ip, "sn": self.hw.camera_sn},
                "scale": {"ok": self.hw.scale_ok, "port": self.hw.scale_port, "baudrate": self.hw.scale_baudrate},
                "roller": {"ok": self.hw.roller_ok, "port": self.hw.roller_port, "baudrate": self.hw.roller_baudrate, "type": self.hw.roller_type},
                "errors": self.hw.errors,
            },
            "tests": self.test_results,
        }

        prompt = f"""你是工业自动化测试工程师。请根据以下测试数据生成一份中文Markdown格式的测试报告。

测试数据:
{json.dumps(report_data, ensure_ascii=False, indent=2)}

报告要求:
1. 标题: 全自动扫码称重滚筒系统 - 测试报告
2. 包含: 测试时间、硬件探测结果表格、功能测试结果表格、问题汇总、改进建议
3. 用表格展示结果，状态用 通过/未通过 标记
4. 最后给出总体评估（可以投入使用/需要调整/存在严重问题）
5. 直接输出Markdown内容，不要代码块包裹"""

        log("[AI] 正在生成测试报告...")
        report_md = self.ai.ask(prompt, max_tokens=2048)

        # 添加时间戳头
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        header = f"<!-- 自动生成于 {timestamp} -->\n\n"

        filename = f"test_report_{datetime.now().strftime('%Y%m%d_%H%M%S')}.md"
        with open(filename, 'w', encoding='utf-8') as f:
            f.write(header + report_md)

        log(f"[报告] 已保存: {filename}")
        print(f"\n{report_md}")
        return filename


# ============================================================
# TUI 全屏界面 + 日志
# ============================================================
_log_lines = []
_tui = None

def log(msg):
    ts = datetime.now().strftime("%H:%M:%S")
    line = f"[{ts}] {msg}"
    _log_lines.append(line)
    if len(_log_lines) > 200:
        _log_lines[:] = _log_lines[-100:]
    if _tui:
        _tui.request_refresh()
    else:
        print(f"  {line}")


class TUI:
    """DOS 风格全屏文字界面，固定区域刷新"""

    COLS = 62
    LOG_LINES = 12

    def __init__(self):
        self.state = "IDLE"
        self.stats = {'total': 0, 'success': 0, 'alarm_code': 0, 'alarm_weight': 0}
        self.last_codes = []
        self.last_weight = 0.0
        self.last_result = ""
        self.hw_cam = False
        self.hw_scale = False
        self.hw_roller = False
        self.brightness = 0
        self.fps = 0.0
        self.start_time = time.time()
        self._alarm_reason = ""
        self._lock = threading.Lock()
        # Windows: 启用 VT100 ANSI 转义序列支持
        if sys.platform == 'win32':
            try:
                import ctypes
                kernel32 = ctypes.windll.kernel32
                kernel32.SetConsoleMode(kernel32.GetStdHandle(-11), 7)
            except Exception:
                pass
        self._last_draw = 0
        self._dirty = False
        self._first_draw = True
        self._timer = threading.Thread(target=self._tick, daemon=True)
        self._timer.start()

    def _tick(self):
        while True:
            interval = 0.5 if self.state == "ALARM" else 1.0
            time.sleep(interval)
            if self._dirty or self.state not in ("IDLE",):
                self.refresh()

    def set_state(self, state, **kwargs):
        with self._lock:
            self.state = state
            for k, v in kwargs.items():
                setattr(self, k, v)
        self.request_refresh()

    def _bar(self, ratio, width=20):
        filled = int(ratio * width)
        return '█' * filled + '░' * (width - filled)

    def request_refresh(self):
        now = time.time()
        if now - self._last_draw < 0.3:
            self._dirty = True
            return
        self.refresh()

    def refresh(self):
        with self._lock:
            self._dirty = False
            self._last_draw = time.time()
            self._draw()

    def _c(self, text, code):
        """ANSI 颜色包裹"""
        return f"\033[{code}m{text}\033[0m"

    _ANSI_RE = __import__('re').compile(r'\033\[[0-9;]*m')

    def _line(self, content, C):
        visible = self._ANSI_RE.sub('', content)
        pad = C - len(visible)
        if pad > 0:
            return '║' + content + ' ' * pad + '║'
        return '║' + content[:C] + '║'

    def _draw(self):
        C = self.COLS
        lines = []
        is_alarm = self.state == "ALARM"
        is_success = self.state == "SUCCESS"
        # 报警时整行用红色背景交替闪烁效果（奇偶秒切换）
        blink = int(time.time()) % 2 == 0

        # ── 顶部 ──
        if is_alarm:
            lines.append(self._c('╔' + '═' * C + '╗', '31'))
            lines.append(self._c('║' + ' !! 报  警 !!  '.center(C) + '║', '41;97;1'))
            lines.append(self._c('╠' + '═' * C + '╣', '31'))
        elif is_success:
            lines.append(self._c('╔' + '═' * C + '╗', '32'))
            lines.append(self._c('║' + ' 出库成功 '.center(C) + '║', '42;97;1'))
            lines.append(self._c('╠' + '═' * C + '╣', '32'))
        else:
            lines.append('╔' + '═' * C + '╗')
            lines.append('║' + f'果管扫码称重系统 v{VERSION}'.center(C) + '║')
            lines.append('╠' + '═' * C + '╣')

        # ── 状态 + 运行时间 ──
        elapsed = int(time.time() - self.start_time)
        runtime = f"{elapsed // 3600:02d}:{(elapsed % 3600) // 60:02d}:{elapsed % 60:02d}"

        state_labels = {
            "IDLE":     (" IDLE   待机中    ", "37"),
            "WAITING":  (" WAIT   等待包裹  ", "33"),
            "SCANNING": (" SCAN   扫码中    ", "36"),
            "SUCCESS":  (" OK     出库成功  ", "32;1"),
            "ALARM":    (" ALARM  报警！    ", "31;1"),
            "INIT":     (" INIT   初始化    ", "33"),
        }
        st_text, st_code = state_labels.get(self.state, (" ???  ", "37"))
        lines.append(self._line(self._c(st_text, st_code) + f"       运行: {runtime}", C))

        # ── 硬件 ──
        cam = self._c("ON", "32") if self.hw_cam else self._c("--", "31")
        scl = self._c("ON", "32") if self.hw_scale else self._c("--", "31")
        rol = self._c("ON", "32") if self.hw_roller else self._c("--", "31")
        lines.append(self._line(f" 相机[{cam}] 秤[{scl}] 滚筒[{rol}]   亮度:{self.brightness:3d}", C))
        lines.append('╠' + '═' * C + '╣')

        # ── 统计 ──
        total = self.stats['total']
        succ = self.stats['success']
        ac = self.stats['alarm_code']
        aw = self.stats['alarm_weight']
        rate = (succ / total * 100) if total > 0 else 0

        succ_s = self._c(f"{succ}", "32;1")
        ac_s = self._c(f"{ac}", "31;1") if ac > 0 else f"{ac}"
        aw_s = self._c(f"{aw}", "31;1") if aw > 0 else f"{aw}"
        lines.append(self._line(f"  成功: {succ_s}    码不全: {ac_s}    重量不符: {aw_s}", C))
        bar = self._c(self._bar(rate / 100.0, 28), "32")
        lines.append(self._line(f"  总计: {total:<5d}  {bar} {rate:3.0f}%", C))
        lines.append('╠' + '═' * C + '╣')

        # ── 结果区（报警时大字红色，成功时绿色） ──
        if is_alarm:
            reason = self._alarm_reason
            if blink:
                lines.append(self._line(self._c("  ████  报 警  ████", "41;97;1"), C))
            else:
                lines.append(self._line(self._c("  ░░░░  报 警  ░░░░", "31;1"), C))
            lines.append(self._line(self._c(f"  {reason[:C-4]}", "31;1"), C))
            lines.append(self._line("", C))
            lines.append(self._line(self._c("  请立即检查包裹!", "33;1"), C))
            lines.append(self._line("", C))
        elif is_success and self.last_codes:
            lines.append(self._line(self._c("  ✔ 出库成功", "32;1"), C))
            for bc in self.last_codes[-2:]:
                lines.append(self._line(self._c(f"    {bc.get('type','')}: {bc.get('data','')}", "32"), C))
            lines.append(self._line(self._c(f"    重量: {self.last_weight:.3f} kg", "32"), C))
            lines.append(self._line("", C))
        elif self.state == "WAITING":
            lines.append(self._line(self._c("  等待包裹进入扫码区域...", "33"), C))
            for _ in range(4):
                lines.append(self._line("", C))
        elif self.state == "SCANNING":
            lines.append(self._line(self._c("  扫码识别中...", "36"), C))
            for _ in range(4):
                lines.append(self._line("", C))
        else:
            for _ in range(5):
                lines.append(self._line("", C))

        # ── 日志区 ──
        lines.append('╠' + '─' * C + '╣')
        recent_logs = _log_lines[-(self.LOG_LINES):]
        for l in recent_logs:
            lines.append(self._line(' ' + l[:C-1], C))
        for _ in range(self.LOG_LINES - len(recent_logs)):
            lines.append(self._line("", C))

        # ── 底部 ──
        lines.append('╠' + '═' * C + '╣')
        foot = f" Ctrl+C退出 | 机器:{MACHINE_NUMBER} | {BACKEND_URL}"
        lines.append(self._line(foot, C))
        lines.append('╚' + '═' * C + '╝')

        # 输出：首次清屏，之后光标回到左上角覆盖重绘（不闪）
        output = '\n'.join(lines) + '\n'
        if self._first_draw:
            self._first_draw = False
            if sys.platform == 'win32':
                os.system('cls')
            else:
                sys.stdout.write('\033[2J')
        if sys.platform == 'win32':
            # Windows: 用 ANSI 光标定位（Win10+ cmd 支持）
            sys.stdout.write('\033[H' + output)
        else:
            sys.stdout.write('\033[H' + output)
        sys.stdout.flush()


# ============================================================
# 主流程
# ============================================================
def main():
    if sys.platform == 'win32':
        os.system('chcp 65001 >nul 2>&1')
        os.system(f'title 果管扫码称重系统 v{VERSION}')
    print()
    print("  ╔══════════════════════════════════════════════════════════╗")
    print(f"  ║   果管扫码称重系统 v{VERSION}                                 ║")
    print("  ║   自动探测 · 扫码称重 · 语音播报 · 自动更新              ║")
    print("  ╚══════════════════════════════════════════════════════════╝")
    print()

    # 启动时检查更新（有新版本会自动下载替换并重启）
    _check_and_update()

    ai = AIAssistant()

    # 测试AI连通性
    log("测试AI连接...")
    test_resp = ai.ask("你好，请回复'AI就绪'两个字", max_tokens=20)
    log(f"AI响应: {test_resp}")

    # 第一阶段: 硬件探测
    detector = HardwareDetector(ai)
    hw = detector.detect_all()

    print(f"\n  {'=' * 56}")
    print(f"  硬件探测完成!")
    print(f"    读码器: {'✓' if hw.camera_ok else '×'}")
    print(f"    电子秤: {'✓ ' + hw.scale_port if hw.scale_ok else '×'}")
    print(f"    滚筒:   {'✓ ' + hw.roller_port + ' ' + hw.roller_type if hw.roller_ok else '×'}")
    print(f"  {'=' * 56}")

    if hw.camera_ok:
        log("  3秒后自动进入生产模式... (按 T 进入测试模式, 按 Q 退出)")
        import msvcrt
        deadline = time.time() + 3
        choice = '1'
        while time.time() < deadline:
            if msvcrt.kbhit() if sys.platform == 'win32' else False:
                k = msvcrt.getch().decode('utf-8', errors='ignore').upper()
                if k == 'T':
                    choice = '2'
                    break
                elif k == 'Q':
                    choice = '0'
                    break
            time.sleep(0.1)

        if choice == '2':
            tester = AutoTester(ai, hw)
            test_results = tester.run_all_tests()
            reporter = ReportGenerator(ai, hw, test_results)
            report_file = reporter.generate()
            log(f"报告已保存: {report_file}")
            production = ProductionMode(ai, hw)
            production.start()
        elif choice == '1':
            production = ProductionMode(ai, hw)
            production.start()
    else:
        log("读码器不可用，无法进入生产模式")

    log("\n系统退出。")
    input("\n  按回车退出...")


if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        print(f"\n  系统错误: {e}")
        traceback.print_exc()
        input("\n  按回车退出...")
