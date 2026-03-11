package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"html/template"
	"log"
	"math"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	_ "github.com/go-sql-driver/mysql"
)

// ─── 配置 ───

type Config struct {
	UDPHost string `json:"udp_host"`
	UDPPort int    `json:"udp_port"`
	WebPort int    `json:"web_port"`

	DBHost string `json:"db_host"`
	DBPort int    `json:"db_port"`
	DBUser string `json:"db_user"`
	DBPass string `json:"db_pass"`
	DBName string `json:"db_name"`

	MaxWorkers    int `json:"max_workers"`
	RecvBufferKB  int `json:"recv_buffer_kb"`
	DBMaxOpen     int `json:"db_max_open"`
	DBMaxIdle     int `json:"db_max_idle"`
	DBMaxLifeMin  int `json:"db_max_life_min"`
}

func defaultConfig() Config {
	return Config{
		UDPHost:      "0.0.0.0",
		UDPPort:      5001,
		WebPort:      9090,
		DBHost:       "36.134.229.82",
		DBPort:       3306,
		DBUser:       "root",
		DBPass:       "Amz24639.",
		DBName:       "my_sk9",
		MaxWorkers:   32,
		RecvBufferKB: 1024,
		DBMaxOpen:    50,
		DBMaxIdle:    10,
		DBMaxLifeMin: 5,
	}
}

// ─── 数据结构 ───

type ScanResult struct {
	Success         bool    `json:"success"`
	Message         string  `json:"message"`
	Barcode         string  `json:"barcode"`
	LabelID         int64   `json:"label_id"`
	Weight          float64 `json:"weight"`
	EstimatedWeight float64 `json:"estimated_weight"`
	WeightDiff      float64 `json:"weight_diff"`
	WorkerName      string  `json:"worker_name"`
	SKUName         string  `json:"sku_name"`
	MachineNumber   string  `json:"machine_number"`
	Timestamp       string  `json:"timestamp"`
	ProcessTimeMs   int64   `json:"process_time_ms"`
}

type MachineStats struct {
	MachineNumber string `json:"machine_number"`
	TotalScans    int64  `json:"total_scans"`
	SuccessScans  int64  `json:"success_scans"`
	FailedScans   int64  `json:"failed_scans"`
	LastScanTime  string `json:"last_scan_time"`
	LastResult    string `json:"last_result"`
}

type WeightSetting struct {
	MaxDiff           float64
	ToleranceType     string
	TolerancePct      float64
}

// ─── 全局状态 ───

var (
	db          *sql.DB
	cfg         Config
	recentScans []ScanResult
	scansMu     sync.RWMutex
	machineMap  sync.Map

	totalRequests  atomic.Int64
	totalSuccess   atomic.Int64
	totalFailed    atomic.Int64
	startTime      time.Time
)

// ─── 主入口 ───

func main() {
	cfg = defaultConfig()
	if f, err := os.Open("config.json"); err == nil {
		json.NewDecoder(f).Decode(&cfg)
		f.Close()
	}

	startTime = time.Now()

	initDB()
	defer db.Close()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

	go startUDPServer(ctx)
	go startWebServer(ctx)

	printBanner()

	<-sigCh
	log.Println("🛑 收到关闭信号，正在优雅退出...")
	cancel()
	time.Sleep(500 * time.Millisecond)
	log.Println("✅ 扫码服务已停止")
}

func printBanner() {
	fmt.Println()
	fmt.Println("╔══════════════════════════════════════════════════════╗")
	fmt.Println("║          🍊 果管系统 · 出库扫码服务 v3.0           ║")
	fmt.Println("║          Go High-Performance Scanner                ║")
	fmt.Println("╠══════════════════════════════════════════════════════╣")
	fmt.Printf("║  UDP 监听:  %s:%-5d                          ║\n", cfg.UDPHost, cfg.UDPPort)
	fmt.Printf("║  Web 面板:  http://0.0.0.0:%-5d                   ║\n", cfg.WebPort)
	fmt.Printf("║  数据库:    %s:%-5d                     ║\n", cfg.DBHost, cfg.DBPort)
	fmt.Printf("║  工作线程:  %-3d                                      ║\n", cfg.MaxWorkers)
	fmt.Println("╚══════════════════════════════════════════════════════╝")
	fmt.Println()
}

// ─── 数据库 ───

func initDB() {
	dsn := fmt.Sprintf("%s:%s@tcp(%s:%d)/%s?charset=utf8mb4&parseTime=true&loc=Local&timeout=10s&readTimeout=10s&writeTimeout=10s",
		cfg.DBUser, cfg.DBPass, cfg.DBHost, cfg.DBPort, cfg.DBName)

	var err error
	db, err = sql.Open("mysql", dsn)
	if err != nil {
		log.Fatalf("❌ 数据库连接失败: %v", err)
	}
	db.SetMaxOpenConns(cfg.DBMaxOpen)
	db.SetMaxIdleConns(cfg.DBMaxIdle)
	db.SetConnMaxLifetime(time.Duration(cfg.DBMaxLifeMin) * time.Minute)

	if err = db.Ping(); err != nil {
		log.Fatalf("❌ 数据库 Ping 失败: %v", err)
	}
	log.Println("✅ 数据库连接成功")
}

// ─── UDP 服务器 ───

func startUDPServer(ctx context.Context) {
	addr, err := net.ResolveUDPAddr("udp", fmt.Sprintf("%s:%d", cfg.UDPHost, cfg.UDPPort))
	if err != nil {
		log.Fatalf("❌ UDP 地址解析失败: %v", err)
	}
	conn, err := net.ListenUDP("udp", addr)
	if err != nil {
		log.Fatalf("❌ UDP 监听失败: %v", err)
	}
	defer conn.Close()

	conn.SetReadBuffer(cfg.RecvBufferKB * 1024)
	conn.SetWriteBuffer(cfg.RecvBufferKB * 1024)

	log.Printf("✅ UDP 服务器启动: %s:%d", cfg.UDPHost, cfg.UDPPort)

	sem := make(chan struct{}, cfg.MaxWorkers)
	buf := make([]byte, 8192)

	for {
		select {
		case <-ctx.Done():
			return
		default:
		}

		conn.SetReadDeadline(time.Now().Add(1 * time.Second))
		n, remoteAddr, err := conn.ReadFromUDP(buf)
		if err != nil {
			if netErr, ok := err.(net.Error); ok && netErr.Timeout() {
				continue
			}
			log.Printf("⚠️ UDP 读取错误: %v", err)
			continue
		}

		data := make([]byte, n)
		copy(data, buf[:n])

		sem <- struct{}{}
		go func(d []byte, addr *net.UDPAddr) {
			defer func() { <-sem }()
			handlePacket(conn, d, addr)
		}(data, remoteAddr)
	}
}

func handlePacket(conn *net.UDPConn, data []byte, addr *net.UDPAddr) {
	start := time.Now()
	totalRequests.Add(1)

	raw := strings.TrimSpace(string(data))
	if raw == "" {
		reply(conn, addr, "false", "空数据")
		return
	}

	barcode, weight, machineNum, err := parseInput(raw)
	if err != nil {
		totalFailed.Add(1)
		reply(conn, addr, "false", err.Error())
		logUploadRecord(raw, 0, false, err.Error(), "未知工人", 0, machineNum)
		return
	}

	result := processScan(barcode, weight, addr.IP.String(), machineNum)
	result.ProcessTimeMs = time.Since(start).Milliseconds()

	if result.Success {
		totalSuccess.Add(1)
		reply(conn, addr, "true", result.Message)
	} else {
		totalFailed.Add(1)
		reply(conn, addr, "false", result.Message)
	}

	addRecentScan(result)
	updateMachineStats(machineNum, result)

	elapsed := time.Since(start)
	status := "✅"
	if !result.Success {
		status = "❌"
	}
	log.Printf("%s [%s] %s | %.1fkg | %s | %dms",
		status, machineNum, barcode, weight, result.WorkerName, elapsed.Milliseconds())
}

func parseInput(data string) (barcode string, weight float64, machine string, err error) {
	parts := strings.Split(data, "/")
	if len(parts) != 3 {
		return "", 0, "", fmt.Errorf("格式错误，应为: 编码/重量/机器号")
	}
	barcode = strings.TrimSpace(parts[0])
	if barcode == "" {
		return "", 0, "", fmt.Errorf("编码不能为空")
	}
	weight, err = strconv.ParseFloat(strings.TrimSpace(parts[1]), 64)
	if err != nil || weight <= 0 {
		return "", 0, "", fmt.Errorf("重量无效: %s", parts[1])
	}
	machine = strings.TrimSpace(parts[2])
	if machine == "" {
		return "", 0, "", fmt.Errorf("机器号不能为空")
	}
	return
}

func reply(conn *net.UDPConn, addr *net.UDPAddr, result, message string) {
	payload := []byte(result + message)
	for i := 0; i < 3; i++ {
		_, err := conn.WriteToUDP(payload, addr)
		if err == nil {
			return
		}
		if i < 2 {
			time.Sleep(50 * time.Millisecond)
		}
	}
}

// ─── 核心扫码逻辑 ───

func processScan(barcode string, weight float64, ipAddr, machineNum string) ScanResult {
	result := ScanResult{
		Barcode:       barcode,
		Weight:        weight,
		MachineNumber: machineNum,
		Timestamp:     time.Now().Format("2006-01-02 15:04:05"),
	}

	if len(barcode) <= 2 {
		result.Message = "条码长度无效"
		logUploadRecord(barcode, weight, false, result.Message, "未知工人", 0, machineNum)
		return result
	}

	qrDate := barcode[:2]
	labelID, err := strconv.ParseInt(barcode[2:], 10, 64)
	if err != nil {
		result.Message = fmt.Sprintf("条码解析失败: %s", barcode)
		logUploadRecord(barcode, weight, false, result.Message, "未知工人", 0, machineNum)
		return result
	}
	result.LabelID = labelID

	ws := getWeightSettings()

	tx, err := db.Begin()
	if err != nil {
		result.Message = "数据库事务启动失败"
		return result
	}
	defer tx.Rollback()

	var (
		actualWeight    float64
		estimatedWeight float64
		scannedOutbound int
		workerID        int64
		batchID         int64
		skuID           int64
		scannedTime     sql.NullTime
		createdAt       time.Time
	)

	err = tx.QueryRow(`SELECT id, actual_weight, estimated_weight, scanned_outbound,
		u, b, s, scanned_time, created_at FROM printed_labels WHERE id=?`, labelID).
		Scan(&labelID, &actualWeight, &estimatedWeight, &scannedOutbound,
			&workerID, &batchID, &skuID, &scannedTime, &createdAt)
	if err != nil {
		result.Message = "未找到匹配的记录"
		logUploadRecord(barcode, weight, false, result.Message, "未知工人", 0, machineNum)
		return result
	}
	result.EstimatedWeight = estimatedWeight

	if qrDate != createdAt.Format("02") {
		result.Message = "二维码日期与记录不符"
		logUploadRecord(barcode, weight, false, result.Message, "未知工人", 0, machineNum)
		return result
	}

	var workerName string
	err = tx.QueryRow("SELECT COALESCE(real_name, username) FROM users WHERE id=?", workerID).Scan(&workerName)
	if err != nil {
		workerName = fmt.Sprintf("工人#%d", workerID)
	}
	result.WorkerName = workerName

	if scannedOutbound > 0 {
		timeStr := ""
		if scannedTime.Valid {
			timeStr = scannedTime.Time.Format("2006-01-02 15:04:05")
		}
		result.Message = fmt.Sprintf("重复扫码！上次: %s", timeStr)
		logFailure(barcode, workerID, workerID, skuID, batchID, result.Message)
		logUploadRecord(barcode, weight, false, result.Message, workerName, 0, machineNum)
		return result
	}

	diff := math.Abs(weight - estimatedWeight)
	result.WeightDiff = weight - estimatedWeight

	exceeded := false
	var errMsg string
	if ws.ToleranceType == "percentage" && ws.TolerancePct > 0 {
		if estimatedWeight > 0 {
			pctDiff := (diff / estimatedWeight) * 100
			if pctDiff > ws.TolerancePct {
				exceeded = true
				errMsg = fmt.Sprintf("重量差值过大(允许%.1f%%, 实际%.2f%%)", ws.TolerancePct, pctDiff)
			}
		}
	} else {
		if diff > ws.MaxDiff {
			exceeded = true
			errMsg = fmt.Sprintf("重量差值过大(允许%.2fkg, 实际%.2fkg)", ws.MaxDiff, diff)
		}
	}

	if exceeded {
		result.Message = errMsg
		logFailure(barcode, workerID, workerID, skuID, batchID, errMsg)
		logUploadRecord(barcode, weight, false, errMsg, workerName, diff, machineNum)
		return result
	}

	_, err = tx.Exec(`UPDATE printed_labels SET actual_weight=?, scanned_outbound=scanned_outbound+1,
		scanned_time=NOW() WHERE id=?`, weight, labelID)
	if err != nil {
		result.Message = "更新标签失败"
		return result
	}

	var cartonBoxID sql.NullInt64
	tx.QueryRow("SELECT carton_box_id FROM sku WHERE id=?", skuID).Scan(&cartonBoxID)
	if cartonBoxID.Valid && cartonBoxID.Int64 > 0 {
		tx.Exec(`UPDATE carton_boxes SET stock_quantity=stock_quantity-1 WHERE id=? AND stock_quantity>0`, cartonBoxID.Int64)
		var origStock int
		tx.QueryRow("SELECT stock_quantity FROM carton_boxes WHERE id=?", cartonBoxID.Int64).Scan(&origStock)
		tx.Exec(`INSERT INTO carton_box_inventory_log (carton_box_id, original_stock, change_quantity, reason)
			VALUES (?,?,?,?)`, cartonBoxID.Int64, origStock+1, -1, fmt.Sprintf("SKU出库扣减,ticket:%s", barcode))
	}

	tx.Exec(`INSERT INTO scan_counts (machine_number, scan_count) VALUES (?,1)
		ON DUPLICATE KEY UPDATE scan_count=scan_count+1`, machineNum)

	if err = tx.Commit(); err != nil {
		result.Message = "事务提交失败"
		return result
	}

	var skuName string
	db.QueryRow("SELECT sku_name FROM sku WHERE id=?", skuID).Scan(&skuName)
	result.SKUName = skuName

	if ws.ToleranceType == "percentage" && ws.TolerancePct > 0 && estimatedWeight > 0 {
		pctDiff := (diff / estimatedWeight) * 100
		result.Message = fmt.Sprintf("扫码成功: %s %.2fkg (差值: %.2f%%, 限制: %.1f%%)",
			barcode, weight, pctDiff, ws.TolerancePct)
	} else {
		result.Message = fmt.Sprintf("扫码成功: %s %.2fkg (差值: %.2fkg, 限制: %.2fkg)",
			barcode, weight, diff, ws.MaxDiff)
	}
	result.Success = true

	logUploadRecord(barcode, weight, true, result.Message, workerName, diff, machineNum)

	return result
}

func getWeightSettings() WeightSetting {
	ws := WeightSetting{MaxDiff: 1.5, ToleranceType: "weight"}
	var tolerancePct sql.NullFloat64
	var toleranceType sql.NullString
	err := db.QueryRow(`SELECT max_weight_difference, tolerance_type, tolerance_percentage
		FROM weight_settings ORDER BY created_at DESC LIMIT 1`).
		Scan(&ws.MaxDiff, &toleranceType, &tolerancePct)
	if err == nil {
		if toleranceType.Valid {
			ws.ToleranceType = toleranceType.String
		}
		if tolerancePct.Valid {
			ws.TolerancePct = tolerancePct.Float64
		}
	}
	return ws
}

// ─── 日志写入 ───

func logFailure(ticketsNum string, userID, workerID, skuID, batchID int64, reason string) {
	go func() {
		for i := 0; i < 3; i++ {
			_, err := db.Exec(`INSERT INTO failure_logs (tickets_num, user_id, worker_id, sku_id, batch_id, failure_reason)
				VALUES (?,?,?,?,?,?)`, ticketsNum, userID, workerID, skuID, batchID, reason)
			if err == nil {
				return
			}
			time.Sleep(100 * time.Millisecond)
		}
	}()
}

func logUploadRecord(ticketsNum string, weight float64, success bool, message, workerName string, weightDiff float64, machineNum string) {
	go func() {
		isSuccess := 0
		if success {
			isSuccess = 1
		}
		for i := 0; i < 3; i++ {
			_, err := db.Exec(`INSERT INTO upload_records
				(tickets_num, weight, is_success, message, upload_time, weight_difference, worker_name, machine_number)
				VALUES (?,?,?,?,NOW(),?,?,?)`,
				ticketsNum, weight, isSuccess, message, weightDiff, workerName, machineNum)
			if err == nil {
				return
			}
			time.Sleep(100 * time.Millisecond)
		}
	}()
}

// ─── 状态管理 ───

func addRecentScan(r ScanResult) {
	scansMu.Lock()
	defer scansMu.Unlock()
	recentScans = append([]ScanResult{r}, recentScans...)
	if len(recentScans) > 200 {
		recentScans = recentScans[:200]
	}
}

func updateMachineStats(machine string, r ScanResult) {
	val, _ := machineMap.LoadOrStore(machine, &MachineStats{MachineNumber: machine})
	stats := val.(*MachineStats)
	atomic.AddInt64(&stats.TotalScans, 1)
	if r.Success {
		atomic.AddInt64(&stats.SuccessScans, 1)
	} else {
		atomic.AddInt64(&stats.FailedScans, 1)
	}
	stats.LastScanTime = r.Timestamp
	stats.LastResult = r.Message
}

// ─── Web 监控面板 ───

func startWebServer(ctx context.Context) {
	mux := http.NewServeMux()
	mux.HandleFunc("/", handleDashboard)
	mux.HandleFunc("/api/stats", handleAPIStats)
	mux.HandleFunc("/api/recent", handleAPIRecent)
	mux.HandleFunc("/api/machines", handleAPIMachines)
	mux.HandleFunc("/api/latest_record/", handleAPILatestRecord)

	srv := &http.Server{Addr: fmt.Sprintf(":%d", cfg.WebPort), Handler: mux}
	go func() {
		<-ctx.Done()
		srv.Shutdown(context.Background())
	}()

	log.Printf("✅ Web 监控面板: http://0.0.0.0:%d", cfg.WebPort)
	if err := srv.ListenAndServe(); err != http.ErrServerClosed {
		log.Printf("⚠️ Web 服务器错误: %v", err)
	}
}

func handleAPIStats(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	uptime := time.Since(startTime)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"total":       totalRequests.Load(),
		"success":     totalSuccess.Load(),
		"failed":      totalFailed.Load(),
		"uptime":      fmt.Sprintf("%dd %dh %dm", int(uptime.Hours())/24, int(uptime.Hours())%24, int(uptime.Minutes())%60),
		"db_open":     db.Stats().OpenConnections,
		"db_in_use":   db.Stats().InUse,
		"start_time":  startTime.Format("2006-01-02 15:04:05"),
	})
}

func handleAPIRecent(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	scansMu.RLock()
	defer scansMu.RUnlock()
	limit := 50
	data := recentScans
	if len(data) > limit {
		data = data[:limit]
	}
	json.NewEncoder(w).Encode(data)
}

func handleAPIMachines(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	var machines []MachineStats
	machineMap.Range(func(key, value interface{}) bool {
		s := value.(*MachineStats)
		machines = append(machines, MachineStats{
			MachineNumber: s.MachineNumber,
			TotalScans:    atomic.LoadInt64(&s.TotalScans),
			SuccessScans:  atomic.LoadInt64(&s.SuccessScans),
			FailedScans:   atomic.LoadInt64(&s.FailedScans),
			LastScanTime:  s.LastScanTime,
			LastResult:    s.LastResult,
		})
		return true
	})
	json.NewEncoder(w).Encode(machines)
}

func handleAPILatestRecord(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	parts := strings.Split(strings.TrimPrefix(r.URL.Path, "/api/latest_record/"), "/")
	if len(parts) < 2 {
		http.Error(w, "need /machine/last_id", 400)
		return
	}
	machineNum := parts[0]
	lastID, _ := strconv.ParseInt(parts[1], 10, 64)

	rows, err := db.Query(`SELECT id, tickets_num, weight, is_success, message, upload_time,
		weight_difference, worker_name, machine_number
		FROM upload_records WHERE machine_number=? AND id>? ORDER BY id DESC LIMIT 20`, machineNum, lastID)
	if err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{"records": []interface{}{}, "error": err.Error()})
		return
	}
	defer rows.Close()

	var records []map[string]interface{}
	for rows.Next() {
		var id int64
		var ticketsNum, message, workerName, mn string
		var wt float64
		var isSuccess bool
		var uploadTime time.Time
		var weightDiff sql.NullFloat64
		rows.Scan(&id, &ticketsNum, &wt, &isSuccess, &message, &uploadTime, &weightDiff, &workerName, &mn)
		records = append(records, map[string]interface{}{
			"id": id, "tickets_num": ticketsNum, "weight": wt,
			"is_success": isSuccess, "message": message,
			"upload_time": uploadTime.Format("2006-01-02 15:04:05"),
			"weight_difference": weightDiff.Float64, "worker_name": workerName,
			"machine_number": mn,
		})
	}
	if records == nil {
		records = []map[string]interface{}{}
	}
	json.NewEncoder(w).Encode(map[string]interface{}{"records": records})
}

// ─── Web 面板 HTML ───

func handleDashboard(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" {
		http.NotFound(w, r)
		return
	}
	tmpl, err := template.New("dashboard").Parse(dashboardHTML)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	tmpl.Execute(w, nil)
}

const dashboardHTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>果管系统 · 出库扫码监控</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{--bg:#0a0e27;--card:#111638;--brand:#6366f1;--green:#10b981;--red:#ef4444;--orange:#f59e0b;--text:#e2e8f0;--text2:#94a3b8;--glass:rgba(255,255,255,0.03);--border:rgba(255,255,255,0.06)}
body{font-family:'SF Pro Display',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:var(--bg);color:var(--text);min-height:100vh;overflow-x:hidden}
.bg-grid{position:fixed;inset:0;background-image:radial-gradient(rgba(99,102,241,0.08) 1px,transparent 1px);background-size:40px 40px;pointer-events:none;z-index:0}
.container{max-width:1400px;margin:0 auto;padding:20px;position:relative;z-index:1}
header{text-align:center;padding:30px 0 20px}
header h1{font-size:2rem;font-weight:800;background:linear-gradient(135deg,#6366f1,#8b5cf6,#a78bfa);-webkit-background-clip:text;-webkit-text-fill-color:transparent;letter-spacing:1px}
header p{color:var(--text2);margin-top:6px;font-size:.9rem}
.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin:24px 0}
.stat{background:var(--card);border:1px solid var(--border);border-radius:16px;padding:20px 24px;position:relative;overflow:hidden}
.stat::before{content:'';position:absolute;top:0;left:0;right:0;height:3px}
.stat.total::before{background:linear-gradient(90deg,#6366f1,#8b5cf6)}
.stat.ok::before{background:linear-gradient(90deg,#10b981,#34d399)}
.stat.fail::before{background:linear-gradient(90deg,#ef4444,#f87171)}
.stat.time::before{background:linear-gradient(90deg,#f59e0b,#fbbf24)}
.stat-label{font-size:.8rem;color:var(--text2);text-transform:uppercase;letter-spacing:1px;margin-bottom:8px}
.stat-value{font-size:2.2rem;font-weight:800;font-variant-numeric:tabular-nums}
.stat.ok .stat-value{color:var(--green)}
.stat.fail .stat-value{color:var(--red)}
.stat.time .stat-value{color:var(--orange);font-size:1.2rem}
.panels{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px}
.panel{background:var(--card);border:1px solid var(--border);border-radius:16px;padding:20px;max-height:600px;overflow:auto}
.panel h2{font-size:1rem;font-weight:700;margin-bottom:16px;display:flex;align-items:center;gap:8px}
.panel h2 .dot{width:8px;height:8px;border-radius:50%;background:var(--green);animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
table{width:100%;border-collapse:collapse;font-size:.82rem}
th{text-align:left;padding:8px 10px;color:var(--text2);font-weight:600;border-bottom:1px solid var(--border);font-size:.75rem;text-transform:uppercase;letter-spacing:.5px}
td{padding:8px 10px;border-bottom:1px solid var(--border)}
tr:hover td{background:rgba(99,102,241,0.04)}
.badge{display:inline-block;padding:2px 10px;border-radius:20px;font-size:.72rem;font-weight:700}
.badge.ok{background:rgba(16,185,129,0.15);color:#34d399}
.badge.fail{background:rgba(239,68,68,0.15);color:#f87171}
.mono{font-family:'SF Mono',Monaco,monospace;font-size:.8rem}
.alert-row{animation:alertFlash 1s ease-in-out 3}
@keyframes alertFlash{0%,100%{background:transparent}50%{background:rgba(239,68,68,0.12)}}
.machine-card{background:var(--glass);border:1px solid var(--border);border-radius:12px;padding:14px;margin-bottom:10px}
.machine-name{font-weight:700;font-size:.95rem;color:var(--brand)}
.machine-stats{display:flex;gap:16px;margin-top:8px;font-size:.8rem;color:var(--text2)}
.machine-stats span{display:flex;align-items:center;gap:4px}
#audioCtx{display:none}
@media(max-width:900px){.stats{grid-template-columns:repeat(2,1fr)}.panels{grid-template-columns:1fr}}
</style>
</head>
<body>
<div class="bg-grid"></div>
<div class="container">
<header>
<h1>🍊 出库扫码监控中心</h1>
<p>实时监控 · 无延时报警 · 高性能 Go 引擎</p>
</header>
<div class="stats">
<div class="stat total"><div class="stat-label">总扫码</div><div class="stat-value" id="sTotal">0</div></div>
<div class="stat ok"><div class="stat-label">成功</div><div class="stat-value" id="sOk">0</div></div>
<div class="stat fail"><div class="stat-label">失败</div><div class="stat-value" id="sFail">0</div></div>
<div class="stat time"><div class="stat-label">运行时间</div><div class="stat-value" id="sUp">-</div></div>
</div>
<div class="panels">
<div class="panel">
<h2><span class="dot"></span>实时扫码流水</h2>
<table><thead><tr><th>时间</th><th>条码</th><th>重量</th><th>工人</th><th>状态</th><th>耗时</th></tr></thead>
<tbody id="scanBody"></tbody></table>
</div>
<div class="panel">
<h2>📡 称重机状态</h2>
<div id="machineList"></div>
</div>
</div>
</div>
<script>
const audioCtx=new(window.AudioContext||window.webkitAudioContext)();
function beepOk(){const o=audioCtx.createOscillator(),g=audioCtx.createGain();o.connect(g);g.connect(audioCtx.destination);o.frequency.value=880;g.gain.value=0.3;o.start();o.stop(audioCtx.currentTime+0.12)}
function beepFail(){const o=audioCtx.createOscillator(),g=audioCtx.createGain();o.connect(g);g.connect(audioCtx.destination);o.type='square';o.frequency.value=300;g.gain.value=0.5;o.start();o.stop(audioCtx.currentTime+0.6)}
function speakCN(text){if('speechSynthesis' in window){const u=new SpeechSynthesisUtterance(text);u.lang='zh-CN';u.rate=1.3;u.volume=1;u.pitch=1;speechSynthesis.speak(u)}}
let lastScanCount=0;
async function refresh(){
try{
const[stats,recent,machines]=await Promise.all([
fetch('/api/stats').then(r=>r.json()),
fetch('/api/recent').then(r=>r.json()),
fetch('/api/machines').then(r=>r.json())
]);
document.getElementById('sTotal').textContent=stats.total.toLocaleString();
document.getElementById('sOk').textContent=stats.success.toLocaleString();
document.getElementById('sFail').textContent=stats.failed.toLocaleString();
document.getElementById('sUp').textContent=stats.uptime;
if(recent&&recent.length>0&&stats.total>lastScanCount&&lastScanCount>0){
const latest=recent[0];
if(latest.success){beepOk();speakCN('成功')}
else{beepFail();speakCN(latest.message.substring(0,30))}
}
lastScanCount=stats.total;
const body=document.getElementById('scanBody');
body.innerHTML='';
(recent||[]).slice(0,30).forEach(s=>{
const tr=document.createElement('tr');
if(!s.success)tr.classList.add('alert-row');
const t=s.timestamp?s.timestamp.split(' ')[1]:'';
tr.innerHTML='<td class="mono">'+t+'</td><td class="mono">'+s.barcode+'</td><td>'+(s.weight||0).toFixed(2)+'kg</td><td>'+
(s.worker_name||'-')+'</td><td><span class="badge '+(s.success?'ok':'fail')+'">'+(s.success?'成功':'失败')+'</span></td><td class="mono">'+
(s.process_time_ms||0)+'ms</td>';
body.appendChild(tr)});
const ml=document.getElementById('machineList');
ml.innerHTML='';
(machines||[]).forEach(m=>{
const rate=m.total_scans>0?((m.success_scans/m.total_scans)*100).toFixed(1):'0';
ml.innerHTML+='<div class="machine-card"><div class="machine-name">📡 '+m.machine_number+'</div>'+
'<div class="machine-stats"><span>总计: <b>'+m.total_scans+'</b></span><span style="color:var(--green)">成功: '+m.success_scans+'</span>'+
'<span style="color:var(--red)">失败: '+m.failed_scans+'</span><span>成功率: '+rate+'%</span></div>'+
'<div style="margin-top:6px;font-size:.75rem;color:var(--text2)">最后: '+m.last_scan_time+'</div></div>'});
}catch(e){console.error(e)}
}
setInterval(refresh,1000);
refresh();
document.addEventListener('click',()=>{if(audioCtx.state==='suspended')audioCtx.resume()},{ once:true });
</script>
</body>
</html>`
