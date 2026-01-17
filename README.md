# NT548 Lab 2 - Câu 3 (Microservices + Jenkins + EKS)

Repo này là ví dụ microservices tối giản (2 service) để bạn deploy lên EKS bằng Jenkins:
- `service-b`: trả về JSON + health
- `service-a`: gọi `service-b` qua DNS nội bộ K8s (`http://service-b:3000`) và trả về kết quả tổng hợp

Mục tiêu CI/CD:

```
GitHub (push) -> Jenkins Pipeline -> build Docker image -> push ECR -> kubectl deploy lên EKS
```

Pipeline đã có sẵn trong `Jenkinsfile` (build & push lên ECR, sau đó `kubectl apply` + `kubectl set image`).

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

## 2) Chuẩn bị AWS/ECR/EKS (1 lần)

### 2.1 Tạo ECR repositories

> Chỉ cần chạy 1 lần cho mỗi tài khoản/region.

```bash
export AWS_REGION=<AWS_REGION>

aws ecr create-repository --region "$AWS_REGION" --repository-name micro-demo/service-a
aws ecr create-repository --region "$AWS_REGION" --repository-name micro-demo/service-b
```

Kiểm tra:

```bash
aws ecr describe-repositories --region "$AWS_REGION" \
  --repository-names micro-demo/service-a micro-demo/service-b
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
- Build `services/service-a` và `services/service-b`
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
  - Image tag/repo sai hoặc EKS node chưa có quyền pull ECR.
  - Đảm bảo node group role có quyền ECR read (thường có sẵn nếu dùng managed node group chuẩn).

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
curl http://<LB_HOST>/api
```

> Lưu ý: `service-b` để nội bộ cluster (ClusterIP) và được `service-a` gọi qua DNS `http://service-b:3000`.

## 8) Mapping “Câu 3”

- Ứng dụng microservices: `services/service-a` và `services/service-b`
- Docker hoá: mỗi service có `Dockerfile`
- Deploy EKS: YAML trong `k8s/`
- CI/CD Jenkins: `Jenkinsfile`

Nếu PDF của bạn yêu cầu thêm Ingress/ALB hoặc Helm chart, nói mình biết để mình chỉnh đúng theo rubric.
