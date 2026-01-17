# Kiến trúc hệ thống (NT548 Lab 2 – Ứng dụng quản lý kho)

## 1) Tổng quan
Hệ thống là một ứng dụng microservices quản lý kho hàng gồm 3 service Node.js + PostgreSQL.

- **service-a (GUI/Web)**: render HTML (login/register + trang tồn kho + form nhập/xuất). Lưu JWT vào cookie.
- **service-c (API/Auth)**: cấp JWT, xác thực JWT cho các API, đóng vai trò **API gateway** gọi xuống service-b.
- **service-b (Data)**: truy cập PostgreSQL, xử lý nghiệp vụ tồn kho (items) + lịch sử giao dịch (transactions).
- **PostgreSQL**: lưu dữ liệu users/items/transactions.

## 2) Sơ đồ kiến trúc (Runtime)

### 2.1 Sơ đồ luồng request (Kubernetes)

```text
Browser
  |
  | HTTP
  v
Ingress (nginx)
  |
  v
service-a (ClusterIP:80 -> Pod:3000)
  |
  | HTTP (in-cluster)  SERVICE_C_URL=http://service-c:3000
  v
service-c (ClusterIP:3000)
  |
  | HTTP (in-cluster)  SERVICE_B_URL=http://service-b:3000
  v
service-b (ClusterIP:3000)
  |
  | TCP 5432 (in-cluster)
  v
PostgreSQL (StatefulSet + PVC)
```

### 2.2 Vai trò từng service

- **service-a**
  - Endpoint HTML: `/login`, `/register`, `/`, `/logout`.
  - Action HTML form:
    - `POST /login` → gọi `service-c /auth/login`
    - `POST /register` → gọi `service-c /auth/register`
    - `POST /items` → gọi `service-c /items`
    - `POST /items/:id/issue` → gọi `service-c /items/:id/issue`
  - Lưu JWT ở cookie `token` (HttpOnly, SameSite=Lax) và gửi qua header `Authorization: Bearer <token>` khi gọi service-c.

- **service-c**
  - Endpoint public cho service-a:
    - `POST /auth/register` → forward xuống `service-b /internal/register` → ký JWT
    - `POST /auth/login` → forward xuống `service-b /internal/login` → ký JWT
    - `GET /items` (requireAuth) → forward `service-b /internal/items`
    - `POST /items` (requireAuth) → forward `service-b /internal/items`
    - `POST /items/:id/issue` (requireAuth) → forward `service-b /internal/items/:id/issue` (đính `userId`)
    - `GET /transactions` (requireAuth) → forward `service-b /internal/transactions`
  - Xác thực JWT bằng `JWT_SECRET`.

- **service-b**
  - Endpoint nội bộ (được gọi bởi service-c):
    - `POST /internal/register`
    - `POST /internal/login`
    - `GET /internal/items`
    - `POST /internal/items` (upsert SKU + tăng quantity + tạo transaction IN)
    - `POST /internal/items/:id/issue` (lock row + trừ quantity + tạo transaction OUT)
    - `GET /internal/transactions?limit=...`
  - Kết nối Postgres qua `DATABASE_URL`.
  - Tự chạy migrate khi start, có retry để tránh CrashLoop khi Postgres chưa sẵn sàng.

## 3) Mô hình dữ liệu (PostgreSQL)
service-b tạo 3 bảng:

- `users`
  - `id` (serial, PK)
  - `username` (unique)
  - `password_hash`
  - `created_at`

- `items`
  - `id` (serial, PK)
  - `sku` (unique)
  - `name`
  - `quantity` (integer)
  - `created_at`

- `transactions`
  - `id` (serial, PK)
  - `user_id` (FK → users.id, nullable)
  - `item_id` (FK → items.id)
  - `type` in {`IN`, `OUT`}
  - `qty` (>0)
  - `created_at`

Ghi chú:
- `POST /internal/items` tạo transaction `IN` với `user_id=null`.
- `POST /internal/items/:id/issue` tạo transaction `OUT` với `user_id` từ JWT (được service-c gắn vào request body).

## 4) Flow hoạt động (Business flows)

### 4.1 Đăng ký

```text
Browser -> service-a: GET /register
Browser -> service-a: POST /register (username, password)
service-a -> service-c: POST /auth/register
service-c -> service-b: POST /internal/register
service-b -> service-c: 201 {user}
service-c: sign JWT (8h) -> {token}
service-a: set-cookie token=... (HttpOnly) -> redirect /
```

### 4.2 Đăng nhập

```text
Browser -> service-a: GET /login
Browser -> service-a: POST /login
service-a -> service-c: POST /auth/login
service-c -> service-b: POST /internal/login
service-b -> service-c: 200 {user}
service-c: sign JWT (8h) -> {token}
service-a: set-cookie token=... -> redirect /
```

### 4.3 Xem tồn kho

```text
Browser -> service-a: GET /
service-a: đọc cookie token
service-a -> service-c: GET /items (Authorization: Bearer token)
service-c: verify JWT
service-c -> service-b: GET /internal/items
service-b -> service-c: {items}
service-a: render HTML table tồn kho
```

Nếu JWT hết hạn/không hợp lệ:
- service-c trả 401 → service-a xoá cookie và đưa người dùng về login.

### 4.4 Nhập kho (IN)

```text
Browser -> service-a: POST /items (sku, name, qty)
service-a -> service-c: POST /items (Bearer token)
service-c: verify JWT
service-c -> service-b: POST /internal/items
service-b:
  - BEGIN
  - UPSERT items by sku (tăng quantity)
  - INSERT transactions(type=IN, qty, user_id=null)
  - COMMIT
service-a: redirect /
```

### 4.5 Xuất kho (OUT)

```text
Browser -> service-a: POST /items/:id/issue (qty)
service-a -> service-c: POST /items/:id/issue (Bearer token)
service-c: verify JWT, lấy userId từ token
service-c -> service-b: POST /internal/items/:id/issue (qty, userId)
service-b:
  - BEGIN
  - SELECT ... FOR UPDATE
  - check quantity đủ
  - UPDATE quantity = quantity - qty
  - INSERT transactions(type=OUT, qty, user_id=userId)
  - COMMIT
service-a: redirect /
```

### 4.6 Xem lịch sử giao dịch (API)
Hiện tại UI (service-a) chưa có trang hiển thị transactions, nhưng hệ thống có API:

- `GET /transactions` trên service-c (requireAuth)
- `GET /internal/transactions` trên service-b

## 5) Triển khai trên Kubernetes (EKS)

### 5.1 Namespace
- Tất cả tài nguyên nằm trong namespace: `micro-demo`.

### 5.2 Networking
- `service-a` được expose qua **Ingress** (nginx) đường dẫn `/`.
- `service-b` và `service-c` là **ClusterIP** (chỉ nội bộ cluster).

### 5.3 Biến môi trường / Secret
- `postgres-secret` chứa:
  - `POSTGRES_PASSWORD`
  - `DATABASE_URL` (dạng `postgres://inventory:<pass>@postgres:5432/inventory`)
  - `JWT_SECRET`

### 5.4 PostgreSQL
- Chạy dạng `StatefulSet` (1 replica).
- Có `volumeClaimTemplates` dùng StorageClass `gp2-csi`, request `1Gi`.
- Có thêm manifest `postgres-statefulset-ephemeral.yaml` (tuỳ chọn) cho môi trường demo không cần PVC.

### 5.5 Healthcheck
- `service-a`, `service-b`, `service-c` đều có `/healthz`.
- Deployment cấu hình readiness/liveness probe gọi `/healthz`.

## 6) CI/CD Flow (Jenkins → ECR → EKS)

### 6.1 Pipeline tổng quát

```text
GitHub push
  -> Jenkins Pipeline
     -> docker build (3 images)
     -> docker push lên ECR
     -> aws eks update-kubeconfig
     -> kubectl apply manifests (namespace, postgres, services, deployments, ingress)
     -> kubectl set image (rollout theo tag mới)
     -> kubectl rollout status
```

### 6.2 Tag image
- Tag mặc định là `GIT_COMMIT.take(7)` (7 ký tự đầu của commit), fallback `BUILD_NUMBER`.

### 6.3 Biến môi trường Jenkins cần cung cấp
- `AWS_REGION`
- `AWS_ACCOUNT_ID`
- `EKS_CLUSTER_NAME`
- `ECR_REPO_SERVICE_A`
- `ECR_REPO_SERVICE_B`
- `ECR_REPO_SERVICE_C`

Credentials Jenkins sử dụng:
- `aws-access-key-id`
- `aws-secret-access-key`

## 7) Chạy local (dev)
- Chạy Postgres (Docker), rồi chạy lần lượt: service-b → service-c → service-a.
- service-a gọi service-c qua `SERVICE_C_URL`.
- service-c gọi service-b qua `SERVICE_B_URL`.

---

Nếu bạn muốn, mình có thể tạo thêm 1 sơ đồ **sequence diagram** dạng Mermaid để nhìn trực quan hơn (không thay đổi code, chỉ thêm vào file này).