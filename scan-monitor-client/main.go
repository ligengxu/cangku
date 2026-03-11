package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
	"unsafe"
)

func init() { runtime.LockOSThread() }

var (
	u32 = syscall.NewLazyDLL("user32.dll")
	k32 = syscall.NewLazyDLL("kernel32.dll")
	g32 = syscall.NewLazyDLL("gdi32.dll")

	wRegisterClassEx    = u32.NewProc("RegisterClassExW")
	wCreateWindowEx     = u32.NewProc("CreateWindowExW")
	wShowWindow         = u32.NewProc("ShowWindow")
	wUpdateWindow       = u32.NewProc("UpdateWindow")
	wGetMessage         = u32.NewProc("GetMessageW")
	wTranslateMessage   = u32.NewProc("TranslateMessage")
	wDispatchMessage    = u32.NewProc("DispatchMessageW")
	wDefWindowProc      = u32.NewProc("DefWindowProcW")
	wPostQuitMessage    = u32.NewProc("PostQuitMessage")
	wPostMessage        = u32.NewProc("PostMessageW")
	wSetWindowPos       = u32.NewProc("SetWindowPos")
	wInvalidateRect     = u32.NewProc("InvalidateRect")
	wBeginPaint         = u32.NewProc("BeginPaint")
	wEndPaint           = u32.NewProc("EndPaint")
	wFillRect           = u32.NewProc("FillRect")
	wSetBkMode          = g32.NewProc("SetBkMode")
	wSetTextColor       = g32.NewProc("SetTextColor")
	wCreateFont         = g32.NewProc("CreateFontW")
	wSelectObject       = g32.NewProc("SelectObject")
	wDeleteObject       = g32.NewProc("DeleteObject")
	wDrawText           = u32.NewProc("DrawTextW")
	wCreateSolidBrush   = g32.NewProc("CreateSolidBrush")
	wSetTimer           = u32.NewProc("SetTimer")
	wGetSystemMetrics   = u32.NewProc("GetSystemMetrics")
	wGetModuleHandle    = k32.NewProc("GetModuleHandleW")
	wSetWindowText      = u32.NewProc("SetWindowTextW")
	wGetWindowText      = u32.NewProc("GetWindowTextW")
	wSendMessage        = u32.NewProc("SendMessageW")
	wSetFocus           = u32.NewProc("SetFocus")
	wDestroyWindow      = u32.NewProc("DestroyWindow")
	wLoadCursor         = u32.NewProc("LoadCursorW")
	wLoadIcon           = u32.NewProc("LoadIconW")
	wCreateCompatibleDC = g32.NewProc("CreateCompatibleDC")
	wCreateCompatBmp    = g32.NewProc("CreateCompatibleBitmap")
	wDeleteDC           = g32.NewProc("DeleteDC")
	wBitBlt             = g32.NewProc("BitBlt")
	wGetClientRect      = u32.NewProc("GetClientRect")
	wIsDialogMessage    = u32.NewProc("IsDialogMessageW")
	wRoundRect          = g32.NewProc("RoundRect")
	wCreatePen          = g32.NewProc("CreatePen")
	wSetClassLongPtr    = u32.NewProc("SetClassLongPtrW")
)

const (
	_TOPMOST   = 0x00000008
	_TOOLWIN   = 0x00000080
	_POPUP     = 0x80000000
	_VISIBLE   = 0x10000000
	_SYSMENU   = 0x00080000
	_CAPTION   = 0x00C00000
	_CHILD     = 0x40000000
	_BORDER    = 0x00800000
	_TABSTOP   = 0x00010000
	_ESCENTER  = 0x0001
	_ESAUTOH   = 0x0080
	_BSDEFPUSH = 0x0001
	_DESTROY   = 0x0002
	_PAINT     = 0x000F
	_TIMER     = 0x0113
	_CLOSE     = 0x0010
	_COMMAND   = 0x0111
	_SETFONT   = 0x0030
	_ERASEBG   = 0x0014
	_USER      = 0x0400
	_SWSHOW    = 5
	_TOPV      = ^uintptr(0)
	_NOMOVE    = 0x0002
	_NOSIZE    = 0x0001
	_SHOWWIN   = 0x0040
	_SMCX      = 0
	_SMCY      = 1
	_TRANS     = 1
	_DTC       = 0x01
	_DTV       = 0x04
	_DTS       = 0x20
	_DTW       = 0x10
	_DTL       = 0x00
	_CSHR      = 0x0002
	_CSVR      = 0x0001
	_SRCCOPY   = 0x00CC0020
	_CHARSET   = 1
	_CTQUAL    = 5
	_FFSW      = 0x20
	_IDCARROW  = 32512
	_BNC       = 0
	_COLORWIN  = 5
	_WMDATA    = _USER + 99
	_GCLHICON  = -14
	_GCLHICONSM = -34
)

type wndcls struct {
	Sz uint32; Sty uint32; Proc uintptr; CE, WE int32
	Inst, Ico, Cur, Bg, Mn, Cls, IcoS uintptr
}
type ps struct{ DC uintptr; Er int32; Rc RECT; _ [40]byte }
type RECT struct{ L, T, R, B int32 }
type wmsg struct {
	H uintptr; M uint32; W, L uintptr; Ti uint32; Pt struct{ X, Y int32 }
}

func s16(s string) uintptr { p, _ := syscall.UTF16PtrFromString(s); return uintptr(unsafe.Pointer(p)) }
func rgb(r, g, b uint8) uintptr { return uintptr(uint32(r) | uint32(g)<<8 | uint32(b)<<16) }

func mkf(sz, wt int, nm string) uintptr {
	f, _, _ := wCreateFont.Call(uintptr(uint32(-sz)), 0, 0, 0, uintptr(wt), 0, 0, 0, _CHARSET, 0, 0, _CTQUAL, _FFSW, s16(nm))
	return f
}
func box(dc uintptr, l, t, r, b int32, c uintptr) {
	br, _, _ := wCreateSolidBrush.Call(c)
	rc := RECT{l, t, r, b}
	wFillRect.Call(dc, uintptr(unsafe.Pointer(&rc)), br)
	wDeleteObject.Call(br)
}
func rbox(dc uintptr, l, t, r, b int32, rad int, bg, bd uintptr) {
	pn, _, _ := wCreatePen.Call(0, 1, bd)
	br, _, _ := wCreateSolidBrush.Call(bg)
	op, _, _ := wSelectObject.Call(dc, pn)
	ob, _, _ := wSelectObject.Call(dc, br)
	wRoundRect.Call(dc, uintptr(l), uintptr(t), uintptr(r), uintptr(b), uintptr(rad), uintptr(rad))
	wSelectObject.Call(dc, op); wSelectObject.Call(dc, ob)
	wDeleteObject.Call(pn); wDeleteObject.Call(br)
}
func txt(dc uintptr, s string, l, t, r, b int32, fl, col, fnt uintptr) {
	o, _, _ := wSelectObject.Call(dc, fnt)
	wSetTextColor.Call(dc, col)
	rc := RECT{l, t, r, b}
	p, _ := syscall.UTF16PtrFromString(s)
	wDrawText.Call(dc, uintptr(unsafe.Pointer(p)), uintptr(len([]rune(s))), uintptr(unsafe.Pointer(&rc)), fl)
	wSelectObject.Call(dc, o)
}

// ── TTS via PowerShell (non-blocking) ──
var speakMu sync.Mutex

func speak(text string) {
	go func() {
		speakMu.Lock()
		defer speakMu.Unlock()
		ps := fmt.Sprintf(`Add-Type -AssemblyName System.Speech; $s=New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.Rate=3; $s.Volume=100; $s.Speak('%s')`, strings.ReplaceAll(text, "'", ""))
		cmd := exec.Command("powershell", "-NoProfile", "-NonInteractive", "-Command", ps)
		cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000}
		cmd.Run()
	}()
}

// ── State ──
type State struct {
	mu       sync.RWMutex
	ok, fail int
	bc, wt   string
	ss, mg   string
	tm       string
	conn     bool
	lid      int
	dirty    bool
	prevOk   int
	prevFail int
	en, ec   string
}

var (
	st        State
	serverURL = "http://36.134.229.82:8000"
	machNum   string
	hMain     uintptr
)

func (s *State) get() (int, int, string, string, string, string, string, bool, string, string) {
	s.mu.RLock(); defer s.mu.RUnlock()
	return s.ok, s.fail, s.bc, s.wt, s.ss, s.mg, s.tm, s.conn, s.en, s.ec
}
func (s *State) getLid() int { s.mu.RLock(); defer s.mu.RUnlock(); return s.lid }
func (s *State) isDirty() bool { s.mu.RLock(); defer s.mu.RUnlock(); return s.dirty }
func (s *State) clean() { s.mu.Lock(); s.dirty = false; s.mu.Unlock() }
func (s *State) setConn(v bool) { s.mu.Lock(); if s.conn != v { s.conn = v; s.dirty = true }; s.mu.Unlock() }

// ── Network ──
type apiR struct{ Data struct{ SC int `json:"scan_count"`; FC int `json:"fail_count"`; Rs []rec `json:"records"` } `json:"data"` }
type rec struct {
	ID int     `json:"id"`
	Co string  `json:"tickets_num"`
	Wt float64 `json:"weight"`
	SK string  `json:"sku_name"`
	OK bool    `json:"is_success"`
	Ms string  `json:"message"`
	Tm string  `json:"upload_time"`
	EN string  `json:"express_number"`
	EC string  `json:"express_carrier"`
}

func poller() {
	cl := &http.Client{Timeout: 2 * time.Second}
	errs := 0
	for {
		time.Sleep(700 * time.Millisecond)
		lid := st.getLid()
		resp, err := cl.Get(fmt.Sprintf("%s/api/device/latest-records/%s/%d", serverURL, machNum, lid))
		if err != nil { errs++; if errs > 4 { st.setConn(false) }; continue }
		body, _ := io.ReadAll(resp.Body); resp.Body.Close()
		var r apiR
		if json.Unmarshal(body, &r) != nil { continue }
		errs = 0
		st.mu.Lock()
		st.conn = true
		newOk, newFail := r.Data.SC, r.Data.FC
		st.ok = newOk; st.fail = newFail
		for _, rc := range r.Data.Rs {
			if rc.ID > st.lid { st.lid = rc.ID }
			st.bc = rc.Co; st.wt = fmt.Sprintf("%.2f", rc.Wt)
			st.en = rc.EN; st.ec = rc.EC
			if rc.OK { st.ss = "OK"; st.mg = rc.SK } else { st.ss = "FAIL"; st.mg = rc.Ms }
			t := rc.Tm; if i := strings.Index(t, "T"); i > 0 { t = t[i+1:] }; if len(t) > 8 { t = t[:8] }
			st.tm = t
			if rc.OK {
				msg := strconv.Itoa(newOk)
				if rc.EC != "" { msg += "。" + rc.EC }
				speak(msg)
			} else {
				m := rc.Ms; if len([]rune(m)) > 20 { m = string([]rune(m)[:20]) }
				speak("\u5931\u8d25\u3002" + m)
			}
		}
		st.dirty = true
		st.mu.Unlock()
		if hMain != 0 { wPostMessage.Call(hMain, _WMDATA, 0, 0) }
	}
}

func heartbeater() {
	cl := &http.Client{Timeout: 2 * time.Second}
	for { time.Sleep(25 * time.Second); req, _ := http.NewRequest("POST", fmt.Sprintf("%s/api/device/heartbeat/%s", serverURL, machNum), nil); cl.Do(req) }
}

// ── Paint ──
const WW, WH = 360, 270

func paint(hwnd uintptr) {
	var p ps
	hs, _, _ := wBeginPaint.Call(hwnd, uintptr(unsafe.Pointer(&p)))
	var cr RECT; wGetClientRect.Call(hwnd, uintptr(unsafe.Pointer(&cr)))
	w, h := cr.R, cr.B
	dc, _, _ := wCreateCompatibleDC.Call(hs)
	bm, _, _ := wCreateCompatBmp.Call(hs, uintptr(w), uintptr(h))
	wSelectObject.Call(dc, bm); wSetBkMode.Call(dc, _TRANS)

	ok, fail, bc, wt, ss, mg, tm, conn, en, ec := st.get()

	fT := mkf(15, 700, "Microsoft YaHei UI"); fS := mkf(11, 400, "Microsoft YaHei UI")
	fN := mkf(42, 900, "Segoe UI"); fM := mkf(13, 600, "Microsoft YaHei UI")
	fX := mkf(10, 400, "Segoe UI")
	defer func() { wDeleteObject.Call(fT); wDeleteObject.Call(fS); wDeleteObject.Call(fN); wDeleteObject.Call(fM); wDeleteObject.Call(fX) }()

	box(dc, 0, 0, w, h, rgb(10, 12, 30))

	// Title
	box(dc, 0, 0, w, 34, rgb(16, 20, 45))
	txt(dc, fmt.Sprintf("  \U0001F34A #%s \u53f7\u673a", machNum), 0, 0, 260, 34, _DTL|_DTV|_DTS, rgb(170, 175, 220), fT)
	if conn {
		rbox(dc, w-72, 7, w-8, 27, 10, rgb(10, 60, 40), rgb(16, 185, 129))
		txt(dc, "\u2714 \u5728\u7ebf", w-70, 7, w-10, 27, _DTC|_DTV|_DTS, rgb(52, 211, 153), fS)
	} else {
		rbox(dc, w-72, 7, w-8, 27, 10, rgb(60, 15, 15), rgb(200, 60, 60))
		txt(dc, "\u2716 \u79bb\u7ebf", w-70, 7, w-10, 27, _DTC|_DTV|_DTS, rgb(248, 113, 113), fS)
	}

	mid := w / 2
	rbox(dc, 8, 40, mid-4, 126, 14, rgb(6, 38, 24), rgb(16, 100, 60))
	rbox(dc, mid+4, 40, w-8, 126, 14, rgb(42, 10, 10), rgb(100, 30, 30))
	txt(dc, "\u2714 \u6210\u529f\u51fa\u5e93", 8, 42, mid-4, 58, _DTC|_DTS, rgb(80, 160, 120), fS)
	txt(dc, "\u2716 \u5931\u8d25", mid+4, 42, w-8, 58, _DTC|_DTS, rgb(160, 80, 80), fS)
	txt(dc, strconv.Itoa(ok), 8, 58, mid-4, 124, _DTC|_DTV|_DTS, rgb(52, 211, 153), fN)
	txt(dc, strconv.Itoa(fail), mid+4, 58, w-8, 124, _DTC|_DTV|_DTS, rgb(248, 113, 113), fN)

	var rbg, rbd uintptr
	switch ss {
	case "OK":   rbg = rgb(6, 38, 24); rbd = rgb(16, 100, 60)
	case "FAIL": rbg = rgb(42, 10, 10); rbd = rgb(100, 30, 30)
	default:     rbg = rgb(18, 22, 48); rbd = rgb(40, 45, 80)
	}
	rbox(dc, 8, 134, w-8, 218, 14, rbg, rbd)

	if bc != "" {
		var tc uintptr
		if ss == "OK" { tc = rgb(52, 211, 153) } else { tc = rgb(248, 113, 113) }
		txt(dc, fmt.Sprintf("  %s   %s   %skg", tm, bc, wt), 12, 138, w-12, 156, _DTL|_DTS, tc, fM)
		expressLine := ""
		if en != "" {
			expressLine = fmt.Sprintf("  \U0001F4E6 %s", en)
			if ec != "" { expressLine += fmt.Sprintf(" [%s]", ec) }
		}
		if expressLine != "" {
			txt(dc, expressLine, 12, 158, w-12, 178, _DTL|_DTS, rgb(120, 180, 255), fS)
			txt(dc, "  "+mg, 12, 180, w-12, 214, _DTL|_DTW, rgb(160, 165, 195), fS)
		} else {
			txt(dc, "  "+mg, 12, 162, w-12, 214, _DTL|_DTW, rgb(160, 165, 195), fS)
		}
	} else {
		txt(dc, "\u7b49\u5f85\u626b\u7801\u6570\u636e...", 8, 134, w-8, 218, _DTC|_DTV|_DTS, rgb(70, 78, 110), fM)
	}

	txt(dc, serverURL, 10, h-24, w-10, h-4, _DTL|_DTS, rgb(40, 44, 65), fX)

	wBitBlt.Call(hs, 0, 0, uintptr(w), uintptr(h), dc, 0, 0, _SRCCOPY)
	wDeleteObject.Call(bm); wDeleteDC.Call(dc)
	wEndPaint.Call(hwnd, uintptr(unsafe.Pointer(&p)))
}

func mainProc(hwnd uintptr, m uint32, wp, lp uintptr) uintptr {
	switch m {
	case _PAINT: paint(hwnd); return 0
	case _ERASEBG: return 1
	case _WMDATA:
		if st.isDirty() {
			st.clean()
			wInvalidateRect.Call(hwnd, 0, 0)
			ok, fail, _, _, _, _, _, _, _, _ := st.get()
			wSetWindowText.Call(hwnd, s16(fmt.Sprintf("#%s  \u2713%d \u2717%d", machNum, ok, fail)))
		}
		return 0
	case _TIMER:
		wSetWindowPos.Call(hwnd, _TOPV, 0, 0, 0, 0, _NOMOVE|_NOSIZE|_SHOWWIN)
		return 0
	case _CLOSE, _DESTROY:
		wPostQuitMessage.Call(0); return 0
	}
	r, _, _ := wDefWindowProc.Call(hwnd, uintptr(m), wp, lp); return r
}

// ── Setup ──
var (
	hEdit     uintptr
	setupDone = make(chan string, 1)
)

func setupProc(hwnd uintptr, m uint32, wp, lp uintptr) uintptr {
	switch m {
	case _COMMAND:
		if int(wp&0xFFFF) == 102 && int((wp>>16)&0xFFFF) == _BNC {
			buf := make([]uint16, 32)
			wGetWindowText.Call(hEdit, uintptr(unsafe.Pointer(&buf[0])), 32)
			s := strings.TrimSpace(syscall.UTF16ToString(buf))
			if s == "" { s = "1" }
			setupDone <- s; wDestroyWindow.Call(hwnd); return 0
		}
	case _CLOSE: setupDone <- "1"; wDestroyWindow.Call(hwnd); return 0
	case _DESTROY: wPostQuitMessage.Call(0); return 0
	}
	r, _, _ := wDefWindowProc.Call(hwnd, uintptr(m), wp, lp); return r
}

func setup(inst uintptr) string {
	cn, _ := syscall.UTF16PtrFromString("SC")
	cur, _, _ := wLoadCursor.Call(0, _IDCARROW)
	ico, _, _ := wLoadIcon.Call(inst, 1) // IDI_ICON1 = 1
	wc := wndcls{Sz: uint32(unsafe.Sizeof(wndcls{})), Sty: _CSHR | _CSVR, Proc: syscall.NewCallback(setupProc), Inst: inst, Cur: cur, Ico: ico, IcoS: ico, Bg: _COLORWIN + 1, Cls: uintptr(unsafe.Pointer(cn))}
	wRegisterClassEx.Call(uintptr(unsafe.Pointer(&wc)))
	sw, _, _ := wGetSystemMetrics.Call(_SMCX); sh, _, _ := wGetSystemMetrics.Call(_SMCY)
	hw, _, _ := wCreateWindowEx.Call(0, uintptr(unsafe.Pointer(cn)), s16("\U0001F34A \u626b\u7801\u76d1\u63a7 - \u8bbe\u7f6e"), _POPUP|_VISIBLE|_CAPTION|_SYSMENU, (sw-320)/2, (sh-180)/2, 320, 180, 0, 0, inst, 0)
	f14 := mkf(14, 400, "Microsoft YaHei UI"); f22 := mkf(24, 700, "Consolas")
	lbl, _, _ := wCreateWindowEx.Call(0, s16("STATIC"), s16("\u8bf7\u8f93\u5165\u673a\u5668\u7f16\u53f7\uff1a"), _CHILD|_VISIBLE, 24, 16, 270, 24, hw, 0, inst, 0)
	wSendMessage.Call(lbl, _SETFONT, f14, 1)
	hEdit, _, _ = wCreateWindowEx.Call(0, s16("EDIT"), s16("1"), _CHILD|_VISIBLE|_BORDER|_TABSTOP|_ESAUTOH|_ESCENTER, 24, 46, 270, 38, hw, 101, inst, 0)
	wSendMessage.Call(hEdit, _SETFONT, f22, 1); wSendMessage.Call(hEdit, 0x00B1, 0, 0xFFFF); wSetFocus.Call(hEdit)
	btn, _, _ := wCreateWindowEx.Call(0, s16("BUTTON"), s16("\u786e\u5b9a"), _CHILD|_VISIBLE|_TABSTOP|_BSDEFPUSH, 90, 98, 140, 38, hw, 102, inst, 0)
	wSendMessage.Call(btn, _SETFONT, f14, 1)
	wShowWindow.Call(hw, _SWSHOW)
	var m wmsg
	for { r, _, _ := wGetMessage.Call(uintptr(unsafe.Pointer(&m)), 0, 0, 0); if r == 0 { break }; d, _, _ := wIsDialogMessage.Call(hw, uintptr(unsafe.Pointer(&m))); if d == 0 { wTranslateMessage.Call(uintptr(unsafe.Pointer(&m))); wDispatchMessage.Call(uintptr(unsafe.Pointer(&m))) } }
	select { case v := <-setupDone: return v; default: return "1" }
}

func main() {
	for i, a := range os.Args[1:] {
		if (a == "-s" || a == "--server") && i+1 < len(os.Args[1:]) { serverURL = os.Args[i+2] }
		if (a == "-m" || a == "--machine") && i+1 < len(os.Args[1:]) { machNum = os.Args[i+2] }
	}
	if d, e := os.ReadFile("scan-monitor.conf"); e == nil {
		for _, l := range strings.Split(string(d), "\n") {
			l = strings.TrimSpace(l)
			if strings.HasPrefix(l, "server=") { serverURL = strings.TrimPrefix(l, "server=") }
			if strings.HasPrefix(l, "machine=") { machNum = strings.TrimPrefix(l, "machine=") }
		}
	}
	inst, _, _ := wGetModuleHandle.Call(0)
	if machNum == "" {
		machNum = setup(inst)
		os.WriteFile("scan-monitor.conf", []byte(fmt.Sprintf("server=%s\nmachine=%s\n", serverURL, machNum)), 0644)
	}
	serverURL = strings.TrimRight(serverURL, "/")

	cn, _ := syscall.UTF16PtrFromString("SM")
	cur, _, _ := wLoadCursor.Call(0, _IDCARROW)
	ico, _, _ := wLoadIcon.Call(inst, 1)
	wc := wndcls{Sz: uint32(unsafe.Sizeof(wndcls{})), Sty: _CSHR | _CSVR, Proc: syscall.NewCallback(mainProc), Inst: inst, Cur: cur, Ico: ico, IcoS: ico, Cls: uintptr(unsafe.Pointer(cn))}
	wRegisterClassEx.Call(uintptr(unsafe.Pointer(&wc)))
	sw, _, _ := wGetSystemMetrics.Call(_SMCX); sh, _, _ := wGetSystemMetrics.Call(_SMCY)

	hMain, _, _ = wCreateWindowEx.Call(_TOPMOST|_TOOLWIN, uintptr(unsafe.Pointer(cn)),
		s16(fmt.Sprintf("#%s", machNum)), _POPUP|_VISIBLE|_CAPTION|_SYSMENU,
		sw-uintptr(WW)-16, sh-uintptr(WH)-50, uintptr(WW), uintptr(WH), 0, 0, inst, 0)

	wShowWindow.Call(hMain, _SWSHOW); wUpdateWindow.Call(hMain)
	wSetWindowPos.Call(hMain, _TOPV, 0, 0, 0, 0, _NOMOVE|_NOSIZE|_SHOWWIN)
	wSetTimer.Call(hMain, 1, 10000, 0)

	go poller()
	go heartbeater()

	var m wmsg
	for { r, _, _ := wGetMessage.Call(uintptr(unsafe.Pointer(&m)), 0, 0, 0); if r == 0 { break }; wTranslateMessage.Call(uintptr(unsafe.Pointer(&m))); wDispatchMessage.Call(uintptr(unsafe.Pointer(&m))) }
}
