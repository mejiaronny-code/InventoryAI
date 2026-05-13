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

class CompanyCreate(BaseModel):
    name: str
    slug: Optional[str] = None
    logo_url: Optional[str] = None
    settings: Optional[dict] = {}

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
    is_active: bool
    created_at: datetime


# ============================================================
# CATEGORIES
# ============================================================

class CategoryCreate(BaseModel):
    name: str
    description: Optional[str] = None
    reservation_time_hours: int = 24

class CategoryUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    reservation_time_hours: Optional[int] = None

class CategoryOut(BaseModel):
    id: UUID
    company_id: UUID
    name: str
    description: Optional[str]
    reservation_time_hours: int
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
    unit: str = "unidad"
    category_id: Optional[UUID] = None
    images: List[str] = []
    attributes: dict = {}
    reservation_time_hours: Optional[int] = None

class ProductUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    use_cases: Optional[str] = None
    sku: Optional[str] = None
    barcode: Optional[str] = None
    price: Optional[float] = None
    unit: Optional[str] = None
    category_id: Optional[UUID] = None
    images: Optional[List[str]] = None
    attributes: Optional[dict] = None
    reservation_time_hours: Optional[int] = None
    is_active: Optional[bool] = None

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
    unit: str
    images: List[str]
    attributes: dict
    reservation_time_hours: Optional[int]
    is_active: bool
    created_at: datetime
    updated_at: datetime

class StockByWarehouse(BaseModel):
    warehouse_id: str
    quantity: int

class ProductWithStock(ProductOut):
    total_stock: int = 0
    available_stock: int = 0
    stock_by_warehouse: List[StockByWarehouse] = []


# ============================================================
# STOCK
# ============================================================

class StockUpdate(BaseModel):
    warehouse_id: UUID
    quantity: int
    min_stock_alert: int = 5

class StockMovementCreate(BaseModel):
    product_id: UUID
    warehouse_id: UUID
    type: StockMovementType
    quantity: int
    notes: Optional[str] = None

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
    client_email: Optional[EmailStr] = None
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
