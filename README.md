# NT548 Lab 2 - Microservices + Jenkins + EKS (Ứng dụng quản lý kho hàng)

Repo này là ví dụ microservices có GUI và dùng PostgreSQL để quản lý kho hàng:

- Đăng ký/đăng nhập nhiều user (nhiều account)
- Xem tồn kho
- Nhập kho (thêm hàng)
- Xuất kho (trừ hàng, kiểm tra đủ tồn)

Hệ thống gồm 3 service:

- `service-a` (GUI): web UI tối giản (login/register + bảng tồn kho + form nhập/xuất)
- `service-c` (API/Auth): cấp JWT và gọi xuống data service
- `service-b` (Data): đọc/ghi PostgreSQL (users/items/transactions)

Mục tiêu CI/CD:

```
GitHub (push) -> Jenkins Pipeline -> build Docker image -> push ECR -> kubectl deploy lên EKS
```

Pipeline đã có sẵn trong `Jenkinsfile` (build & push lên ECR, sau đó `kubectl apply` + `kubectl set image`).

## SonarQube / Trivy / Snyk (cài đặt & tích hợp Jenkins)

### Tổng quan (quan trọng)

- **SonarQube Server**: là web/app chạy nền lâu dài (UI + DB + Elasticsearch). Repo này cung cấp file Docker Compose để bạn tự dựng.
- **Sonar Scanner**: chạy trong Jenkins pipeline để phân tích source và đẩy kết quả lên SonarQube Server.

Pipeline trong `Jenkinsfile` đã có các stage:

- **SonarQube Scan (bắt buộc)**
- **Trivy Scan (tuỳ chọn)**: bật bằng `TRIVY_ENABLED=true`
- **Snyk Scan (tuỳ chọn)**: bật bằng `SNYK_ENABLED=true`

### 1) Cài SonarQube Server bằng Docker Compose (trên host Jenkins/EC2)

Repo đã kèm file: [docker-compose.sonarqube.yml](docker-compose.sonarqube.yml).

1) Bắt buộc tăng kernel setting cho Elasticsearch (nếu không sẽ crash và UI không vào được):

```bash
sudo sysctl -w vm.max_map_count=262144
echo 'vm.max_map_count=262144' | sudo tee /etc/sysctl.d/99-sonarqube.conf
sudo sysctl --system
```

2) Start SonarQube + PostgreSQL:

```bash
docker compose -f docker-compose.sonarqube.yml up -d
docker compose -f docker-compose.sonarqube.yml ps
```

3) Đợi SonarQube sẵn sàng:

```bash
curl -sS http://localhost:9000/api/system/status
```

Khi OK sẽ thấy JSON có `"status":"UP"`. Lần đầu có thể mất vài phút.

4) Mở UI:

- Nếu bạn đang ngồi trên chính host: `http://localhost:9000`
- Nếu bạn truy cập từ máy khác: `http://<JENKINS_HOST_PUBLIC_IP>:9000`

Gợi ý an toàn: không mở port 9000 public; dùng SSH tunnel:

```bash
ssh -L 9000:localhost:9000 ubuntu@<JENKINS_HOST_PUBLIC_IP>
```

Rồi mở `http://localhost:9000` trên máy bạn.

### 2) Tạo project để lấy `SONAR_PROJECT_KEY`

1) Đăng nhập SonarQube (lần đầu: `admin` / `admin`, sẽ bắt đổi password).
2) **Projects → Create project → Manually**.
3) Nhập:

- **Project display name**: tuỳ bạn
- **Project key**: dạng không dấu/không space, ví dụ `nt548-lab2`

Giá trị **Project key** chính là biến `SONAR_PROJECT_KEY` bạn sẽ cấu hình trong Jenkins.

### 3) Tạo token để Jenkins scan (`sonar-token`)

Trong SonarQube: avatar góc phải → **My Account → Security → Generate Tokens** → generate token (ví dụ đặt tên `jenkins`) → copy token.

Trong Jenkins:

1) **Manage Jenkins → Credentials** → tạo **Secret text**.
2) **Secret**: dán token vừa generate.
3) **ID**: đặt đúng `sonar-token` (pipeline đang dùng id này).

### 4) Cấu hình Jenkins job (Environment variables)

Trong Jenkins job → **Configure** → thêm các biến:

- `SONAR_HOST_URL`
  - Nếu Jenkins agent chạy **cùng host** với SonarQube: `http://localhost:9000`
  - Nếu Jenkins agent chạy **máy khác**: dùng URL/IP mà agent truy cập được (vd `http://<JENKINS_HOST_PRIVATE_OR_PUBLIC_IP>:9000`)
- `SONAR_PROJECT_KEY` = project key bạn đặt ở bước (2)

Các biến AWS/EKS/ECR (bắt buộc để build/push/deploy):

- `AWS_REGION`, `AWS_ACCOUNT_ID`, `EKS_CLUSTER_NAME`
- `ECR_REPO_SERVICE_A`, `ECR_REPO_SERVICE_B`, `ECR_REPO_SERVICE_C`

Tuỳ chọn security scan:

- `TRIVY_ENABLED=true` (để chạy Trivy scan)
- `SNYK_ENABLED=true` + credential id `snyk-token` (để chạy Snyk scan)

### 5) Chạy Jenkins pipeline và xem kết quả

Chạy job Jenkins → vào SonarQube project → sẽ thấy analysis mới.

Ghi chú: Pipeline sẽ "wait" SonarQube lên `UP` trước khi chạy sonar-scanner; nếu `SONAR_HOST_URL` là localhost thì scanner container sẽ dùng `--network host`.

### 6) Troubleshooting nhanh

- **UI không vào được / `curl localhost:9000` bị reset/refused**: gần như chắc chắn thiếu `vm.max_map_count`.
  - Kiểm tra: `sysctl vm.max_map_count`
  - Log: `docker logs --tail=200 sonarqube`
- **Vào được bằng localhost nhưng không vào được bằng Public IP**: kiểm tra Security Group/firewall port 9000, hoặc dùng SSH tunnel.
- **Scan fail vì branch/PR**: SonarQube Community có thể giới hạn tính năng branch/PR. Nếu gặp lỗi, có thể chỉnh pipeline để không truyền `sonar.branch.name` (tuỳ yêu cầu).

## 1) Yêu cầu môi trường

### Jenkins agent cần có
- Docker (build & push image)
- AWS CLI v2
- `kubectl`

Kiểm tra nhanh trên Jenkins agent:

```bash
docker --version
aws --version
kubectl version --client
```

### AWS/EKS/ECR
- Bạn đã có EKS cluster
- Có quyền IAM để:
  - `ecr:*` (ít nhất push image)
  - `eks:DescribeCluster`
  - quyền lấy token cluster (thường thông qua IAM Authenticator tích hợp trong AWS CLI)

Khuyến nghị “tốt nhất” (an toàn + ổn định):
- Chạy Jenkins **ngoài** cụm EKS (VM/EC2/On-prem), rồi Jenkins chỉ deploy vào EKS.
- Nếu Jenkins chạy trong cluster, bạn sẽ vướng phần build image (`docker build`) và thường phải dùng DinD/privileged.

Repo này mặc định theo hướng Jenkins agent có Docker sẵn (phù hợp Jenkins ngoài cluster).

## Kiến trúc & luồng request

Luồng khi truy cập từ ngoài (Ingress) vào GUI/API:

```
Browser -> Ingress NGINX -> service-a -> service-c -> service-b -> PostgreSQL
```

- `service-a` expose ra ngoài (Ingress), đồng thời là điểm vào chính.
- `service-b` và `service-c` để nội bộ cluster (ClusterIP).
- PostgreSQL chạy trong cluster (StatefulSet) cho mục đích lab/demo.

## 2) Chuẩn bị AWS/ECR/EKS (1 lần)

### 2.1 Tạo ECR repositories

> Chỉ cần chạy 1 lần cho mỗi tài khoản/region.

```bash
export AWS_REGION=<AWS_REGION>

aws ecr create-repository --region "$AWS_REGION" --repository-name micro-demo/service-a
aws ecr create-repository --region "$AWS_REGION" --repository-name micro-demo/service-b
aws ecr create-repository --region "$AWS_REGION" --repository-name micro-demo/service-c
```

Kiểm tra:

```bash
aws ecr describe-repositories --region "$AWS_REGION" \
  --repository-names micro-demo/service-a micro-demo/service-b micro-demo/service-c
```

### 2.2 IAM cho Jenkins (gợi ý tối thiểu)

Có 2 cách cấp quyền AWS cho Jenkins:

1) **Jenkins chạy trên EC2**: dùng **IAM Role (Instance Profile)** (khuyến nghị).
2) **Jenkins chạy nơi khác**: dùng **IAM User Access Key** (đơn giản cho lab).

Tối thiểu Jenkins cần:
- Push ECR
- `eks:DescribeCluster` để `aws eks update-kubeconfig`

Ví dụ policy (tham khảo, bạn có thể siết chặt thêm theo repo/cluster cụ thể):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ECRPush",
      "Effect": "Allow",
      "Action": [
        "ecr:GetAuthorizationToken",
        "ecr:BatchCheckLayerAvailability",
        "ecr:CompleteLayerUpload",
        "ecr:InitiateLayerUpload",
        "ecr:PutImage",
        "ecr:UploadLayerPart",
        "ecr:BatchGetImage"
      ],
      "Resource": "*"
    },
    {
      "Sid": "EKSDescribe",
      "Effect": "Allow",
      "Action": [
        "eks:DescribeCluster"
      ],
      "Resource": "*"
    }
  ]
}
```

### 2.3 Cho Jenkins IAM access vào Kubernetes (EKS)

Bạn cần map IAM principal của Jenkins vào quyền Kubernetes (RBAC). Có 2 hướng:

- **Nhanh cho lab**: map vào `system:masters` (quyền admin) — chạy được ngay nhưng không “least privilege”.
- **Chuẩn hơn**: tạo `Role`/`RoleBinding` trong namespace `micro-demo` chỉ cho các thao tác cần thiết.

Nếu bạn dùng cách nhanh cho lab (aws-auth), lệnh/manifest phụ thuộc EKS version & cách bạn tạo cluster,
nên phần này bạn có thể làm theo hướng dẫn EKS của bạn (mục tiêu cuối: `kubectl` từ Jenkins chạy được).

Kiểm tra Jenkins có deploy được bằng cách chạy từ chính Jenkins agent:

```bash
aws eks update-kubeconfig --region <AWS_REGION> --name <EKS_CLUSTER_NAME>
kubectl get ns
```

## 3) Chạy local (tuỳ chọn)

Chạy local với PostgreSQL (gợi ý nhanh):

- Cách đơn giản nhất là dùng Docker để chạy Postgres:

```bash
docker run --rm -d --name pg-inventory \
  -e POSTGRES_DB=inventory \
  -e POSTGRES_USER=inventory \
  -e POSTGRES_PASSWORD=inventorypass \
  -p 5432:5432 \
  postgres:16-alpine
```

Mở 3 terminal (B -> C -> A):

```bash
cd services/service-b
npm install
DATABASE_URL=postgres://inventory:inventorypass@localhost:5432/inventory PORT=3001 node src/index.js
```

```bash
cd services/service-c
npm install
SERVICE_B_URL=http://localhost:3001 JWT_SECRET=dev-secret-change-me PORT=3002 node src/index.js
```

```bash
cd services/service-a
npm install
SERVICE_C_URL=http://localhost:3002 PORT=3000 node src/index.js
```

Mở GUI: http://localhost:3000/

Mở 2 terminal:

```bash
cd services/service-b
npm install
npm run dev
```

```bash
cd services/service-a
npm install
SERVICE_B_URL=http://localhost:3001 npm run dev
```

Test:
- `service-b`: http://localhost:3001/healthz
- `service-a`: http://localhost:3000/api

## 4) Deploy thủ công lên EKS (để thử trước)

Cập nhật kubeconfig:

```bash
aws eks update-kubeconfig --region <AWS_REGION> --name <EKS_CLUSTER_NAME>
```

Apply manifests:

```bash
kubectl apply -f k8s/
kubectl -n micro-demo get all
```

Lưu ý: manifest để image mặc định `*:local` (để Jenkins dễ thay tag). Nếu deploy thủ công, bạn cần set image sang ECR:

```bash
kubectl -n micro-demo set image deployment/service-b service-b=<ECR_REGISTRY>/<ECR_REPO_SERVICE_B>:<TAG>
kubectl -n micro-demo set image deployment/service-a service-a=<ECR_REGISTRY>/<ECR_REPO_SERVICE_A>:<TAG>

kubectl -n micro-demo rollout status deployment/service-b --timeout=180s
kubectl -n micro-demo rollout status deployment/service-a --timeout=180s
```

Port-forward để test nhanh:

```bash
kubectl -n micro-demo port-forward svc/service-a 8080:80
curl http://localhost:8080/api

## 5) Tích hợp Jenkins + GitHub -> EKS (chi tiết từng bước)

### 5.1 Chuẩn bị Jenkins

1) Cài Jenkins (server) và có ít nhất 1 agent chạy job.
2) Trên máy chạy agent, cài đủ:
- Docker
- AWS CLI v2
- kubectl

> Lưu ý: Jenkinsfile dùng `docker build`, nên agent phải có quyền chạy docker (vd user thuộc group `docker`).

### 5.2 Tạo Credentials trong Jenkins

Vào: **Manage Jenkins -> Credentials -> (global) -> Add Credentials**

- Kind: `Secret text`
  - ID: `aws-access-key-id`
  - Secret: `<AWS_ACCESS_KEY_ID>`

- Kind: `Secret text`
  - ID: `aws-secret-access-key`
  - Secret: `<AWS_SECRET_ACCESS_KEY>`

> Nếu Jenkins chạy trên EC2 dùng IAM role đúng quyền, bạn có thể bỏ 2 secrets này và chỉnh Jenkinsfile.

### 5.3 Tạo Pipeline job trỏ tới GitHub repo

1) Jenkins -> **New Item** -> đặt tên (vd `micro-demo-ci`) -> chọn **Pipeline**.
2) Trong job config:
- **Pipeline -> Definition**: `Pipeline script from SCM`
- SCM: `Git`
- Repository URL: URL GitHub repo của bạn
- Credentials (nếu repo private): dùng GitHub PAT
- **Script Path**: `Jenkinsfile`

### 5.4 Khai báo Environment variables cho job

Jenkinsfile đọc các biến môi trường sau (bắt buộc):

- `AWS_REGION` (vd `ap-southeast-1`)
- `AWS_ACCOUNT_ID` (12 chữ số)
- `EKS_CLUSTER_NAME`
- `ECR_REPO_SERVICE_A` (vd `micro-demo/service-a`)
- `ECR_REPO_SERVICE_B` (vd `micro-demo/service-b`)
- `ECR_REPO_SERVICE_C` (vd `micro-demo/service-c`)

Bạn có thể set ở:
- Job config (Environment variables) hoặc
- Manage Jenkins -> Configure System (Global properties)

### 5.5 Bật trigger GitHub -> Jenkins (Webhook)

1) Trong Jenkins job:
- Build Triggers: bật `GitHub hook trigger for GITScm polling`

2) Trong GitHub repo:
- Settings -> Webhooks -> Add webhook
  - Payload URL: `http(s)://<JENKINS_HOST>/github-webhook/`
  - Content type: `application/json`
  - Events: `Just the push event`

3) Test webhook:
- GitHub sẽ hiển thị trạng thái gửi webhook (thường là HTTP 200 nếu Jenkins nhận).

> Nếu bạn không mở inbound được webhook (mạng lab), có thể dùng Poll SCM thay thế.

### 5.6 Chạy pipeline và verify deploy

1) Trong Jenkins job, bấm **Build Now**.
2) Pipeline sẽ:
- Build `services/service-a`, `services/service-b`, `services/service-c`
- Push image lên ECR với tag = `GIT_COMMIT` (7 ký tự) hoặc `BUILD_NUMBER`
- Deploy manifests trong `k8s/` và `kubectl set image` để rollout

3) Verify trên máy có kubeconfig:

```bash
aws eks update-kubeconfig --region <AWS_REGION> --name <EKS_CLUSTER_NAME>
kubectl -n micro-demo get all
kubectl -n micro-demo get pods -o wide
```

Test nhanh (port-forward):

```bash
kubectl -n micro-demo port-forward svc/service-a 8080:80
curl http://localhost:8080/api

Mở GUI:

```bash
xdg-open http://localhost:8080/
```
```
```

## 6) Troubleshooting nhanh (lỗi hay gặp)

- `docker: permission denied` trên agent
  - Đảm bảo user chạy agent thuộc group `docker` hoặc agent có quyền chạy Docker.

- `aws: command not found` / `kubectl: command not found`
  - Cài AWS CLI v2 / kubectl trên Jenkins agent.

- `Error: Cannot perform an interactive login from a non TTY device` khi login ECR
  - Jenkinsfile đã dùng `aws ecr get-login-password | docker login ...` (non-interactive). Nếu bạn tự sửa, hãy giữ đúng kiểu này.

- `kubectl ... Forbidden` (không có quyền)
  - IAM của Jenkins chưa được map vào quyền K8s (aws-auth / access entry) hoặc thiếu RBAC trong namespace `micro-demo`.

- `kubectl apply` OK nhưng pod `ImagePullBackOff`
  - Nếu bạn thấy image vẫn là `service-a:local` hoặc `service-b:local` thì đây là **image placeholder**. K8s sẽ cố pull từ DockerHub (`docker.io/library/service-a:local`) và fail.
  - Cách fix nhanh: set image sang ECR (thay đúng account/repo/tag):

    ```bash
    export AWS_REGION=<AWS_REGION>
    export AWS_ACCOUNT_ID=<AWS_ACCOUNT_ID>
    export ECR_REGISTRY="$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com"

    kubectl -n micro-demo set image deployment/service-b service-b="$ECR_REGISTRY/<ECR_REPO_SERVICE_B>:<TAG>"
    kubectl -n micro-demo set image deployment/service-a service-a="$ECR_REGISTRY/<ECR_REPO_SERVICE_A>:<TAG>"

    kubectl -n micro-demo rollout status deployment/service-b --timeout=180s
    kubectl -n micro-demo rollout status deployment/service-a --timeout=180s
    ```

  - Nếu chạy qua Jenkins pipeline thì Jenkins sẽ tự build/push và `kubectl set image` giúp bạn.
  - Nếu image/tag đúng mà vẫn fail: có thể EKS node chưa có quyền pull ECR; kiểm tra IAM role của node group.

- `kubectl rollout status ... timeout`
  - Xem log pod: `kubectl -n micro-demo logs deploy/service-a` (hoặc pod cụ thể)
  - Xem describe: `kubectl -n micro-demo describe pod <pod>`

## 7) Expose ra ngoài bằng Ingress NGINX

Repo đã có sẵn Ingress manifest cho `service-a` tại `k8s/service-a-ingress.yaml`.

### 7.1 Cài ingress-nginx controller (EKS)

Cách khuyến nghị là cài bằng Helm (tạo Service type `LoadBalancer` để AWS cấp ELB):

```bash
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm repo update

helm install ingress-nginx ingress-nginx/ingress-nginx \
  --namespace ingress-nginx --create-namespace
```

Chờ controller lên và lấy địa chỉ public (ELB):

```bash
kubectl -n ingress-nginx get pods
kubectl -n ingress-nginx get svc ingress-nginx-controller
```

Trường `EXTERNAL-IP` (hoặc hostname) chính là endpoint để truy cập từ ngoài.

### 7.2 Apply Ingress cho ứng dụng

```bash
kubectl apply -f k8s/namespace.yaml
kubectl -n micro-demo apply -f k8s/service-a-service.yaml
kubectl -n micro-demo apply -f k8s/service-a-deployment.yaml
kubectl -n micro-demo apply -f k8s/service-a-ingress.yaml
```

Kiểm tra Ingress:

```bash
kubectl -n micro-demo get ingress
kubectl -n micro-demo describe ingress service-a
```

Test từ ngoài (thay `<LB_HOST>` bằng EXTERNAL-IP/hostname của ingress-nginx):

```bash
curl http://<LB_HOST>/healthz
```

Mở GUI trên trình duyệt:

```bash
xdg-open http://<LB_HOST>/
```

> Lưu ý: `service-b` để nội bộ cluster (ClusterIP) và được `service-a` gọi qua DNS `http://service-b:3000`.

Trong phiên bản quản lý kho:
- `service-a` gọi `service-c` qua DNS `http://service-c:3000`
- `service-c` gọi `service-b` qua DNS `http://service-b:3000`
- `service-b` kết nối Postgres qua `DATABASE_URL` (được set bằng Secret)

## 8) PostgreSQL trong cluster (lab)

Các manifest Postgres:

- `k8s/postgres-secret.yaml` (chứa `POSTGRES_PASSWORD`, `DATABASE_URL`, `JWT_SECRET`)
- `k8s/postgres-service.yaml`
- `k8s/postgres-statefulset.yaml`

### 8.1 Chạy Postgres với PVC (khuyến nghị)

`k8s/postgres-statefulset.yaml` dùng PVC và yêu cầu EBS CSI hoạt động để provision volume.

- StorageClass CSI (apply 1 lần): `k8s/storageclass-gp2-csi.yaml`
- Nếu pod `postgres-0` bị `Pending` với lỗi `unbound immediate PersistentVolumeClaims`:
  - Kiểm tra CSI driver có chạy:

    ```bash
    kubectl get csidrivers
    kubectl -n kube-system get pods | grep -E 'ebs-csi|aws-ebs-csi'
    ```

  - Nếu chưa có EBS CSI driver addon (EKS):

    ```bash
    aws eks list-addons --cluster-name <EKS_CLUSTER_NAME> --region <AWS_REGION>
    aws eks create-addon --cluster-name <EKS_CLUSTER_NAME> --addon-name aws-ebs-csi-driver --region <AWS_REGION>
    ```

  - Apply StorageClass CSI và tạo lại PVC (nếu PVC đang Pending từ đầu):

    ```bash
    kubectl apply -f k8s/storageclass-gp2-csi.yaml
    kubectl -n micro-demo delete pvc data-postgres-0 --ignore-not-found
    kubectl -n micro-demo delete pod postgres-0 --ignore-not-found
    ```

### 8.2 Chạy Postgres không dùng PVC (ephemeral, chạy nhanh)

Nếu chỉ cần demo nhanh và chấp nhận mất dữ liệu khi pod restart, dùng manifest:

- `k8s/postgres-statefulset-ephemeral.yaml`

Bạn nên đổi password/secret trước khi dùng thật. Hiện tại file Secret dùng giá trị demo (base64) để chạy nhanh.

## 9) Mapping “Câu 3”

- Ứng dụng microservices: `services/service-a` và `services/service-b`
- Docker hoá: mỗi service có `Dockerfile`
- Deploy EKS: YAML trong `k8s/`
- CI/CD Jenkins: `Jenkinsfile`

Nếu PDF của bạn yêu cầu thêm Ingress/ALB hoặc Helm chart, nói mình biết để mình chỉnh đúng theo rubric.
