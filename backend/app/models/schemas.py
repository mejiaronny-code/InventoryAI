"""
app/models/schemas.py
Modelos Pydantic para validación de request/response
"""
from pydantic import BaseModel, EmailStr, Field
from typing import Optional, List, Any
from uuid import UUID
from datetime import datetime
from enum import Enum


# ============================================================
# ENUMS
# ============================================================

class UserRole(str, Enum):
    super_admin = "super_admin"
    admin = "admin"
    employee = "employee"

class BusinessType(str, Enum):
    general    = "general"
    alimentos  = "alimentos"
    farmacia   = "farmacia"
    ferreteria = "ferreteria"
    ropa       = "ropa"
    electronica = "electronica"
    custom     = "custom"

class ReservationStatus(str, Enum):
    pending = "pending"
    confirmed = "confirmed"
    completed = "completed"
    cancelled = "cancelled"
    expired = "expired"

class StockMovementType(str, Enum):
    entrada = "entrada"
    salida = "salida"
    transferencia = "transferencia"
    ajuste = "ajuste"

class NotificationType(str, Enum):
    new_reservation = "new_reservation"
    reservation_expired = "reservation_expired"
    low_stock = "low_stock"
    stock_out = "stock_out"
    system = "system"


# ============================================================
# COMPANIES
# ============================================================

DEFAULT_FEATURES = {
    "physical_location": True,
    "expiration_dates":  False,
    "batch_tracking":    False,
    "serial_numbers":    False,
    "variants":          False,
    "multi_unit":        False,
    "tags":              True,
    "barcodes_qr":       True,
    "auto_reorder":      False,
}

BUSINESS_PRESETS: dict[str, dict] = {
    "general":     {**DEFAULT_FEATURES},
    "alimentos":   {**DEFAULT_FEATURES, "expiration_dates": True, "batch_tracking": True},
    "farmacia":    {**DEFAULT_FEATURES, "expiration_dates": True, "batch_tracking": True, "serial_numbers": True},
    "ferreteria":  {**DEFAULT_FEATURES, "multi_unit": True},
    "ropa":        {**DEFAULT_FEATURES, "variants": True},
    "electronica": {**DEFAULT_FEATURES, "serial_numbers": True, "variants": True},
    "custom":      {**DEFAULT_FEATURES},
}

class CompanyCreate(BaseModel):
    name: str
    slug: Optional[str] = None
    logo_url: Optional[str] = None
    settings: Optional[dict] = {}
    business_type: Optional[str] = "general"

class CompanyUpdate(BaseModel):
    name: Optional[str] = None
    slug: Optional[str] = None
    logo_url: Optional[str] = None
    settings: Optional[dict] = None

class CompanyOut(BaseModel):
    id: UUID
    name: str
    slug: Optional[str]
    logo_url: Optional[str]
    settings: dict
    business_type: Optional[str] = "general"
    features: Optional[dict] = None
    is_active: bool
    created_at: datetime


# ============================================================
# COMPANY KNOWLEDGE BASE (documentos institucionales para el chat IA)
# ============================================================

class CompanyDocumentOut(BaseModel):
    id: UUID
    title: str
    filename: str
    file_type: str
    status: str  # 'processing' | 'ready' | 'error'
    error_message: Optional[str] = None
    chunk_count: int = 0
    created_at: datetime


# ============================================================
# CATEGORIES
# ============================================================

class CategoryCreate(BaseModel):
    name: str
    description: Optional[str] = None
    reservation_time_hours: int = 24
    max_reservation_qty: Optional[int] = None  # None = sin límite

class CategoryUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    reservation_time_hours: Optional[int] = None
    max_reservation_qty: Optional[int] = None

class CategoryOut(BaseModel):
    id: UUID
    company_id: UUID
    name: str
    description: Optional[str]
    reservation_time_hours: int
    max_reservation_qty: Optional[int] = None
    created_at: datetime


# ============================================================
# WAREHOUSES
# ============================================================

class WarehouseCreate(BaseModel):
    name: str
    location: Optional[str] = None
    description: Optional[str] = None

class WarehouseUpdate(BaseModel):
    name: Optional[str] = None
    location: Optional[str] = None
    description: Optional[str] = None
    is_active: Optional[bool] = None

class WarehouseOut(BaseModel):
    id: UUID
    company_id: UUID
    name: str
    location: Optional[str]
    description: Optional[str]
    is_active: bool
    created_at: datetime


# ============================================================
# PRODUCTS
# ============================================================

class ProductCreate(BaseModel):
    name: str
    description: Optional[str] = None
    use_cases: Optional[str] = None
    sku: Optional[str] = None
    barcode: Optional[str] = None
    price: float = 0
    cost_price: Optional[float] = None
    unit: str = "unidad"
    category_id: Optional[UUID] = None
    images: List[str] = []
    attributes: dict = {}
    reservation_time_hours: Optional[int] = None
    tags: List[str] = []
    units: List[dict] = []
    parent_product_id: Optional[UUID] = None
    variant_attributes: dict = {}
    product_options: List[dict] = []

class ProductUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    use_cases: Optional[str] = None
    sku: Optional[str] = None
    barcode: Optional[str] = None
    price: Optional[float] = None
    cost_price: Optional[float] = None
    unit: Optional[str] = None
    category_id: Optional[UUID] = None
    images: Optional[List[str]] = None
    attributes: Optional[dict] = None
    reservation_time_hours: Optional[int] = None
    is_active: Optional[bool] = None
    tags: Optional[List[str]] = None
    units: Optional[List[dict]] = None
    variant_attributes: Optional[dict] = None
    product_options: Optional[List[dict]] = None

class ProductOut(BaseModel):
    id: UUID
    company_id: UUID
    category_id: Optional[UUID]
    name: str
    description: Optional[str]
    use_cases: Optional[str]
    sku: Optional[str]
    barcode: Optional[str]
    price: float
    cost_price: Optional[float] = None
    unit: str
    images: List[str]
    attributes: dict
    reservation_time_hours: Optional[int]
    tags: List[str] = []
    units: List[dict] = []
    parent_product_id: Optional[UUID] = None
    variant_attributes: dict = {}
    product_options: List[dict] = []
    is_active: bool
    created_at: datetime
    updated_at: datetime


# ============================================================
# VARIANT STOCK
# ============================================================

class VariantStockUpsert(BaseModel):
    warehouse_id: UUID
    combination: dict   # e.g. {"Color": "Rojo", "Talla": "M"}
    quantity: int = Field(ge=0)

class VariantStockOut(BaseModel):
    id: UUID
    product_id: UUID
    warehouse_id: UUID
    combination: dict
    quantity: int

class StockByWarehouse(BaseModel):
    warehouse_id: str
    quantity: int
    aisle: Optional[str] = None
    shelf: Optional[str] = None
    bin:   Optional[str] = None
    store_location: Optional[str] = None   # Ubicación visible al cliente (ej: "Pasillo 3 - Estante B")
    nearest_expiry: Optional[datetime] = None

class ProductWithStock(ProductOut):
    total_stock: int = 0
    available_stock: int = 0
    stock_by_warehouse: List[StockByWarehouse] = []


# ============================================================
# BATCHES
# ============================================================

class BatchCreate(BaseModel):
    product_id: UUID
    warehouse_id: UUID
    batch_code: Optional[str] = None   # se genera automático si no se pasa
    quantity: int = Field(gt=0)
    expires_at: Optional[datetime] = None
    received_at: Optional[datetime] = None
    notes: Optional[str] = None

class BatchOut(BaseModel):
    id: UUID
    company_id: UUID
    product_id: UUID
    warehouse_id: UUID
    batch_code: str
    quantity: int
    initial_quantity: int
    expires_at: Optional[datetime]
    received_at: datetime
    notes: Optional[str]
    created_at: datetime

class BatchUpdate(BaseModel):
    quantity: Optional[int] = None
    expires_at: Optional[datetime] = None
    notes: Optional[str] = None


# ============================================================
# STOCK
# ============================================================

class StockUpdate(BaseModel):
    warehouse_id: UUID
    quantity: int
    min_stock_alert: int = 5

class LocationUpdate(BaseModel):
    product_id: str
    warehouse_id: str
    aisle: Optional[str] = None
    shelf: Optional[str] = None
    bin:   Optional[str] = None
    store_location: Optional[str] = None

class StockMovementCreate(BaseModel):
    product_id: UUID
    warehouse_id: UUID
    type: StockMovementType
    quantity: int
    notes: Optional[str] = None
    expires_at: Optional[datetime] = None
    batch_code: Optional[str] = None  # si la empresa usa batch_tracking

class StockMovementOut(BaseModel):
    id: UUID
    product_id: UUID
    warehouse_id: UUID
    type: StockMovementType
    quantity: int
    notes: Optional[str]
    created_by: Optional[UUID]
    created_at: datetime


# ============================================================
# RESERVATIONS
# ============================================================

class ReservationCreate(BaseModel):
    product_id: UUID
    warehouse_id: UUID
    quantity: int = Field(gt=0)
    client_name: str
    client_email: EmailStr
    client_phone: Optional[str] = None
    notes: Optional[str] = None

class ReservationUpdate(BaseModel):
    status: ReservationStatus
    notes: Optional[str] = None

class ReservationOut(BaseModel):
    id: UUID
    company_id: UUID
    product_id: UUID
    warehouse_id: UUID
    quantity: int
    client_name: str
    client_email: Optional[str]
    client_phone: Optional[str]
    status: ReservationStatus
    reservation_code: str
    expires_at: datetime
    notes: Optional[str]
    created_at: datetime
    updated_at: datetime


# ============================================================
# CHAT
# ============================================================

class ChatMessage(BaseModel):
    session_id: str
    message: str
    company_slug: str

class ChatImageMessage(BaseModel):
    session_id: str
    company_slug: str
    # image viene como base64 en el request multipart

class ChatResponse(BaseModel):
    response: str
    session_id: str
    used_tools: List[str] = []
    transcribed_text: Optional[str] = None  # solo presente en /chat/audio


# ============================================================
# AUTH / USER PROFILES
# ============================================================

class UserProfileCreate(BaseModel):
    email: EmailStr
    password: str
    full_name: str
    role: UserRole = UserRole.employee

class UserProfileOut(BaseModel):
    id: UUID
    company_id: Optional[UUID]
    full_name: Optional[str]
    role: UserRole
    is_active: bool
    created_at: datetime


# ============================================================
# NOTIFICATIONS
# ============================================================

class NotificationOut(BaseModel):
    id: UUID
    company_id: UUID
    type: NotificationType
    message: str
    read: bool
    target_role: Optional[str]
    metadata: dict
    created_at: datetime


# ============================================================
# METRICS / DASHBOARD
# ============================================================

class DashboardMetrics(BaseModel):
    total_products: int
    total_stock: int
    active_reservations: int
    low_stock_products: int
    monthly_ai_cost: float
    monthly_reservations: int
    recent_reservations: List[dict]
    recent_notifications: List[dict]
