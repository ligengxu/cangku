export interface UserInfo {
  user_id: number;
  username: string;
  role: 'admin' | 'worker';
  real_name?: string;
}

export interface ApiResponse<T = any> {
  success: boolean;
  message: string;
  data?: T;
}

export interface PaginatedResponse<T = any> {
  success: boolean;
  data: T[];
  total: number;
  page: number;
  page_size: number;
}

export interface FruitPurchase {
  id: number;
  supplier_id: number;
  fruit_id: number;
  supplier_name: string;
  fruit_name: string;
  purchase_date: string;
  purchase_price: number;
  purchase_weight: number;
  payment_status?: string;
}

export interface MaterialPurchase {
  id: number;
  supplier_id: number;
  supplier_name?: string;
  material_type?: string;
  material_name?: string;
  purchase_amount?: number;
  purchase_date?: string;
  status?: string;
  payment_status?: string;
  notes?: string;
  created_at?: string;
}

export interface CartonPurchase {
  id: number;
  supplier_id: number;
  carton_box_id: number;
  purchase_price: number;
  purchase_quantity: number;
  status?: string;
  payment_status?: string;
  created_at?: string;
  supplier_name?: string;
  box_type?: string;
  stock_quantity?: number;
}

export interface Sku {
  id: number;
  fruit_id: number;
  fruit_name: string;
  sku_name: string;
  sku_description?: string;
  fruit_weight: number;
  material_weight: number;
  total_weight: number;
  production_performance: number;
  carton_box_id?: number;
}

export interface SkuTransaction {
  id: number;
  fruit_purchase_id: number;
  sku_id: number;
  worker_id: number;
  worker_name: string;
  sku_name: string;
  sku_description?: string;
  fruit_name: string;
  quantity: number;
  transaction_date?: string;
  is_printed: boolean;
}

export interface WorkerInfo {
  id: number;
  username: string;
  role: string;
  real_name?: string;
  phone?: string;
  alipay_account?: string;
}

export interface AttendanceRecord {
  id: number;
  worker_id: number;
  work_date: string;
  clock_in?: string;
  clock_out?: string;
  work_hours?: number;
  status?: string;
  note?: string;
}

export interface LeaveRecord {
  id: number;
  worker_id: number;
  worker_name?: string;
  leave_date: string;
  leave_type?: string;
  reason?: string;
  status?: string;
  created_at?: string;
  reviewed_by?: number;
  reviewed_at?: string;
  review_note?: string;
}

export interface WorkerProduction {
  id: number;
  worker_id: number;
  sku_id: number;
  production_date: string;
  printed_quantity: number;
  actual_packaging_quantity: number;
  audit_status?: string;
  created_at?: string;
}

export interface Notice {
  id: number;
  title?: string;
  content: string;
  type?: string;
  target_role?: string;
  is_active?: boolean;
  created_by?: number;
  creator_name?: string;
  is_expired?: boolean;
  created_at?: string;
  expires_at?: string;
}

export interface ActionLog {
  id: number;
  user_id: number;
  username: string;
  action: string;
  data_before?: string;
  data_after?: string;
  ip_address?: string;
  timestamp?: string;
}

export interface SearchResult {
  type: string;
  id: number;
  label: string;
  description?: string;
}

export interface Supplier {
  id: number;
  name: string;
  type: string;
  contact?: string;
  contact_person?: string;
  phone?: string;
  alipay_account?: string;
  bank_card?: string;
  notes?: string;
  created_at?: string;
}

export interface Fruit {
  id: number;
  name: string;
}

export interface CartonBox {
  id: number;
  box_type: string;
  purchase_price: number;
  stock_quantity: number;
  low_stock_threshold?: number;
}

export interface DashboardStats {
  purchases?: number;
  assignments?: number;
  pending_print?: number;
  pending_audit?: number;
  active_workers?: number;
  today_outbound?: number;
  today_printed?: number;
  printed?: number;
  recorded?: number;
  printed_qty?: number;
  produced_qty?: number;
  pending_qty?: number;
  worker_count?: number;
  date: string;
}

export interface ProductionAssignment {
  purchase_id: number;
  worker_ids: number[];
  assigned_workers?: { id: number; real_name?: string; username: string }[];
}

export interface ProductionAuditRecord {
  id: number;
  worker_id: number;
  sku_id: number;
  worker_name?: string;
  sku_name?: string;
  production_date?: string;
  printed_quantity?: number;
  actual_packaging_quantity?: number;
  audit_status?: 'pending' | 'approved' | 'rejected';
  created_at?: string;
}

export interface PrintQueueInfo {
  count?: number;
  pending?: number;
}

// Report types
export interface DailyOutboundRecord {
  date: string;
  count: number;
  weight: number;
}

export interface FruitLossRecord {
  fruit_name: string;
  purchased_weight: number;
  outbound_weight: number;
  loss: number;
  loss_rate: number;
}

export interface FruitPricingSummary {
  factory_price: number;
  weighted_avg: number;
  suggested_selling_price: number;
}

export interface FruitPriceHistory {
  date?: string;
  price?: number;
  purchase_price?: number;
  [key: string]: unknown;
}

export interface SupplierPriceBreakdown {
  supplier_name: string;
  batch_count: number;
  avg_price: number;
  min_price: number;
  max_price: number;
  total_cost: number;
  total_weight: number;
}

export interface PriceIntelFruit {
  fruit_name: string;
  batch_count: number;
  avg_price: number;
  min_price: number;
  max_price: number;
  latest_price: number;
  volatility: number;
  trend: 'rising' | 'falling' | 'stable';
  change_rate: number;
  total_cost: number;
  total_weight: number;
  supplier_count: number;
  supplier_breakdown: SupplierPriceBreakdown[];
  price_history: { date: string; price: number; weight: number }[];
}

export interface PriceIntelAlert {
  fruit: string;
  type: 'high_volatility' | 'price_rising' | 'price_falling';
  message: string;
  value: number;
}

export interface SupplierRanking {
  supplier_name: string;
  total_cost: number;
  total_weight: number;
  avg_price: number;
  batch_count: number;
  fruit_count: number;
  fruits: string[];
}

export interface CostDistribution {
  name: string;
  value: number;
  percentage: number;
}

export interface PriceIntelData {
  fruits: PriceIntelFruit[];
  timeline: Record<string, number | string>[];
  fruit_names: string[];
  summary: {
    total_cost: number;
    total_weight: number;
    avg_price_per_kg: number;
    fruit_count: number;
    batch_count: number;
    alert_count: number;
    supplier_count: number;
  };
  alerts: PriceIntelAlert[];
  cost_distribution: CostDistribution[];
  supplier_ranking: SupplierRanking[];
}

export interface WeightDifferenceRecord {
  label_id: number;
  sku_id: number;
  sku_name: string;
  fruit_name: string;
  worker_id: number;
  worker_name: string;
  estimated_weight: number;
  actual_weight: number;
  diff: number;
  scanned_time: string | null;
  count?: number;
  avg_diff?: number;
  under_count?: number;
}

export interface SkuDailyRecord {
  sku_name: string;
  fruit_name: string;
  label_count: number;
  estimated_weight: number;
  actual_weight: number;
}

export interface SystemHealth {
  status: string;
  database?: { status: string };
  version?: string;
}

export interface InventoryCheckItem {
  id: number;
  check_date: string;
  check_user_id?: number;
  check_user_name?: string;
  check_note?: string;
  status: 'draft' | 'confirmed' | 'cancelled';
  detail_count: number;
  total_difference: number;
  created_at?: string;
  updated_at?: string;
}

export interface InventoryCheckDetail {
  id: number;
  check_id: number;
  carton_box_id: number;
  box_type?: string;
  system_quantity?: number;
  actual_quantity?: number;
  difference?: number;
  created_at?: string;
}

export interface InventoryCheckFull extends InventoryCheckItem {
  details: InventoryCheckDetail[];
}
