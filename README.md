# NT548 Lab 2 - Câu 3 (Microservices + Jenkins + EKS)

Repo này là ví dụ microservices tối giản (2 service) để bạn deploy lên EKS bằng Jenkins:
- `service-b`: trả về JSON + health
- `service-a`: gọi `service-b` qua DNS nội bộ K8s (`http://service-b:3000`) và trả về kết quả tổng hợp

## 1) Yêu cầu môi trường

### Jenkins agent cần có
- Docker (build & push image)
- AWS CLI v2
- `kubectl`

### AWS/EKS/ECR
- Bạn đã có EKS cluster
- Có quyền IAM để:
  - `ecr:*` (ít nhất push image)
  - `eks:DescribeCluster`
  - quyền lấy token cluster (thường thông qua IAM Authenticator tích hợp trong AWS CLI)

## 2) Chạy local (tuỳ chọn)

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

## 3) Deploy thủ công lên EKS (để thử trước)

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
```

## 4) Jenkins deploy tự động

### Credentials cần tạo trong Jenkins
- `aws-access-key-id` (Secret text)
- `aws-secret-access-key` (Secret text)

> Nếu Jenkins chạy trong AWS và dùng IAM role (IRSA/instance role) thì có thể bỏ bước credentials này.

### Environment variables (Jenkins job / pipeline)
- `AWS_REGION` (vd: `ap-southeast-1`)
- `AWS_ACCOUNT_ID` (12 chữ số)
- `EKS_CLUSTER_NAME`
- `ECR_REPO_SERVICE_A` (vd: `micro-demo/service-a`)
- `ECR_REPO_SERVICE_B` (vd: `micro-demo/service-b`)

Tạo ECR repos (1 lần):

```bash
aws ecr create-repository --repository-name micro-demo/service-a
aws ecr create-repository --repository-name micro-demo/service-b
```

Sau đó chạy pipeline Jenkins: nó sẽ build 2 image, push lên ECR, rồi `kubectl set image` để rollout.

## 5) Mapping “Câu 3”

- Ứng dụng microservices: `services/service-a` và `services/service-b`
- Docker hoá: mỗi service có `Dockerfile`
- Deploy EKS: YAML trong `k8s/`
- CI/CD Jenkins: `Jenkinsfile`

Nếu PDF của bạn yêu cầu thêm Ingress/ALB hoặc Helm chart, nói mình biết để mình chỉnh đúng theo rubric.
